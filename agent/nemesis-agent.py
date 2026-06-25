#!/usr/bin/env python3
"""Nemesis Agent — 메트릭 수집 및 관리 서버 Push 데몬"""

import argparse
import json
import logging
import os
import shlex
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('nemesis-agent')

SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
COLLECT_LINUX = os.path.join(SCRIPT_DIR, 'collect.sh')
COLLECT_AIX   = os.path.join(SCRIPT_DIR, 'collect_aix.sh')
HEALING_DIR   = os.path.join(SCRIPT_DIR, 'healing')
METADATA_FILE = '/etc/nemesis/metadata.json'
PUSH_INTERVAL = 3    # seconds
PULL_INTERVAL = 30   # seconds — 클러스터 메타(피어/VIP) 동기화 주기
CONTROL_PORT  = int(os.environ.get('NEMESIS_CONTROL_PORT', '17001'))
CMD_TIMEOUT   = 120  # seconds — VIP 이동/복구 스크립트 실행 상한

# Phase D-3: 노드 간 직접 하트비트(관리 서버 SPOF 제거)
HEARTBEAT_PORT      = int(os.environ.get('NEMESIS_HEARTBEAT_PORT', '17000'))
HEARTBEAT_INTERVAL  = 1   # seconds — 피어 하트비트 주기
MGMT_FAIL_THRESHOLD = 3   # 관리 서버 Push 연속 실패 임계(이후 자율 모드)
PEER_FAIL_THRESHOLD = 3   # active 피어 하트비트 연속 실패 임계(이후 VIP 인수)
CONTROL_SCRIPT      = os.path.join(SCRIPT_DIR, 'control.sh')

# 명령 수신 채널 화이트리스트: 첫 토큰이 아래 스크립트여야만 실행한다(Phase D-1).
# 임의 명령 실행을 막아 Self-Healing/VIP 이동 같은 정의된 액션만 허용한다.
ALLOWED_SCRIPTS = {
    'control.sh':              os.path.join(SCRIPT_DIR, 'control.sh'),
    'healing/heal_oracle.sh':  os.path.join(HEALING_DIR, 'heal_oracle.sh'),
    'healing/heal_tomcat.sh':  os.path.join(HEALING_DIR, 'heal_tomcat.sh'),
    'healing/heal_nginx.sh':   os.path.join(HEALING_DIR, 'heal_nginx.sh'),
    # 베이스네임 단축 호출도 허용
    'heal_oracle.sh':          os.path.join(HEALING_DIR, 'heal_oracle.sh'),
    'heal_tomcat.sh':          os.path.join(HEALING_DIR, 'heal_tomcat.sh'),
    'heal_nginx.sh':           os.path.join(HEALING_DIR, 'heal_nginx.sh'),
}

# 자체 서명 인증서 환경 대응
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode    = ssl.CERT_NONE


def _collect_script() -> str:
    return COLLECT_AIX if sys.platform == 'aix' else COLLECT_LINUX


def collect_metrics() -> dict:
    result = subprocess.run(
        ['sh', _collect_script()],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"collect.sh failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def _request(url: str, data: bytes = None, headers: dict = None) -> dict | None:
    req = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json', **(headers or {})},
        method='POST' if data else 'GET',
    )
    with urllib.request.urlopen(req, context=_ssl_ctx, timeout=15) as resp:
        body = resp.read()
        return json.loads(body) if body else None


def push_metrics(server_url: str, api_key: str, metrics: dict):
    _request(
        f"{server_url}/api/agent/metrics",
        data=json.dumps(metrics).encode(),
        headers={'Authorization': f'Bearer {api_key}'},
    )


def detect_own_ip(server_url: str) -> str:
    """관리 서버 방향 라우팅에 쓰이는 자기 IP를 감지(UDP connect 트릭, 패킷 미전송).

    서버를 localhost로 접속하는 환경에서는 getsockname()이 127.0.0.1을 반환하는데,
    이 값을 serviceIp로 보고하면 관리 서버가 노드의 control 포트(17001)에 도달할 수 없다
    (자기 자신 loopback으로 접속). loopback이 감지되면 라우팅 가능한 인터페이스 IP로 폴백한다.
    """
    def probe(dst: str):
        """dst로 향하는 라우팅의 source IP를 구한다(UDP connect, 실제 패킷 미전송)."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((dst, 9))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return None

    # 1) 관리 서버 방향 source IP. 서버가 localhost면 loopback이 나오므로 그 경우는 배제.
    host = server_url.split('://', 1)[-1].split('/', 1)[0].split(':', 1)[0]
    candidate = probe(host)
    if candidate and not candidate.startswith('127.'):
        return candidate

    # 2) 공인 IP 방향 라우팅으로 기본 인터페이스의 라우팅 가능한 IP를 찾는다
    #    (서버를 localhost로 접속하는 환경에서도 동작).
    routable = probe('8.8.8.8')
    if routable and not routable.startswith('127.'):
        return routable

    # 3) 호스트명 해석 중 비-loopback 주소
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.'):
                return ip
    except Exception:
        pass

    log.warning("라우팅 가능한 IP를 찾지 못해 loopback을 사용한다. NEMESIS_SERVICE_IP 설정을 권장한다.")
    return candidate or '127.0.0.1'


def register(server_url: str, api_key: str, version: str) -> dict:
    own_ip = detect_own_ip(server_url)
    payload = {
        'apiKey':      api_key,
        'hostname':    socket.gethostname(),
        'os':          'AIX' if sys.platform == 'aix' else 'LINUX',
        'version':     version,
        # 명령 채널(17001)·피어 하트비트(17000) 대상 IP — 미전송 시 서버가 노드에 도달 불가
        'serviceIp':   os.environ.get('NEMESIS_SERVICE_IP', own_ip),
        'heartbeatIp': os.environ.get('NEMESIS_HEARTBEAT_IP', own_ip),
    }
    result = _request(
        f"{server_url}/api/agent/register",
        data=json.dumps(payload).encode(),
    )
    log.info(f"등록 완료: cluster={result['clusterName']}, role={result['role']}")
    return result


def save_metadata(meta: dict):
    """metadata.json 원자적 갱신(D-4): 임시파일 기록 후 교체."""
    os.makedirs(os.path.dirname(METADATA_FILE), exist_ok=True)
    tmp = METADATA_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(meta, f, indent=2)
    os.replace(tmp, METADATA_FILE)


# ---------------------------------------------------------------------------
# Phase D-3: 노드 간 직접 하트비트 + 자율 페일오버
# 관리 서버가 단절돼도 노드끼리 17000 하트비트로 active 생존을 확인하고,
# active가 죽었다고 판단되면 standby가 자율적으로 VIP를 인수한다(SPOF 제거).
# ---------------------------------------------------------------------------

class ClusterState:
    def __init__(self):
        self.lock       = threading.Lock()
        self.meta       = {}     # /api/agent/meta 또는 metadata.json
        self.mgmt_fails = 0      # 관리 서버 Push 연속 실패 횟수
        self.took_over  = False  # 자율 인수로 VIP를 이미 올렸는지

    def set_meta(self, meta: dict):
        with self.lock:
            self.meta = meta or {}

    def snapshot(self):
        with self.lock:
            return dict(self.meta), self.mgmt_fails, self.took_over

    def note_push(self, ok: bool):
        with self.lock:
            self.mgmt_fails = 0 if ok else self.mgmt_fails + 1

    def mark_took_over(self, val: bool):
        with self.lock:
            self.took_over = val


STATE = ClusterState()


def make_heartbeat_handler():
    class HbHandler(BaseHTTPRequestHandler):
        server_version = 'NemesisHB/1.0'
        def log_message(self, fmt, *a): pass  # 하트비트 로그 억제

        def do_GET(self):
            if self.path != '/hb':
                self.send_response(404); self.end_headers(); return
            meta, _, _ = STATE.snapshot()
            payload = json.dumps({
                'alive': True,
                'hostname': meta.get('hostname', socket.gethostname()),
                'role': meta.get('role', 'unknown'),
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
    return HbHandler


def start_heartbeat_server():
    server = ThreadingHTTPServer(('0.0.0.0', HEARTBEAT_PORT), make_heartbeat_handler())
    threading.Thread(target=server.serve_forever, name='hb-server', daemon=True).start()
    log.info(f"피어 하트비트 서버 시작 (포트 {HEARTBEAT_PORT})")
    return server


def ping_peer(ip: str) -> bool:
    if not ip:
        return False
    try:
        req = urllib.request.Request(f"http://{ip}:{HEARTBEAT_PORT}/hb", method='GET')
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def measure_peer(ip: str) -> tuple[str, int | None]:
    """피어 하트비트 상태와 왕복 지연(ms)을 측정한다. (status, latencyMs)."""
    if not ip:
        return 'DEAD', None
    start = time.monotonic()
    try:
        req = urllib.request.Request(f"http://{ip}:{HEARTBEAT_PORT}/hb", method='GET')
        with urllib.request.urlopen(req, timeout=2) as resp:
            ok = resp.status == 200
    except Exception:
        return 'DEAD', None
    latency = int((time.monotonic() - start) * 1000)
    if not ok:
        return 'DEAD', latency
    return ('SLOW' if latency > 500 else 'ALIVE'), latency


def report_heartbeat(server_url: str, api_key: str):
    """STATE의 피어 목록을 모두 측정해 관리 서버에 보고(하트비트 매트릭스용)."""
    meta, _, _ = STATE.snapshot()
    peers = meta.get('peers') or []
    if not peers:
        return
    results = []
    for p in peers:
        node_id = p.get('nodeId')
        if not node_id:
            continue
        status, latency = measure_peer(p.get('heartbeatIp'))
        results.append({'toNodeId': node_id, 'status': status, 'latencyMs': latency})
    if not results:
        return
    try:
        _request(
            f"{server_url}/api/agent/heartbeat",
            data=json.dumps({'peers': results}).encode(),
            headers={'Authorization': f'Bearer {api_key}'},
        )
    except Exception as e:
        log.debug(f"하트비트 보고 실패: {e}")


def _run_control(args) -> bool:
    try:
        p = subprocess.run(['sh', CONTROL_SCRIPT, *args],
                           capture_output=True, text=True, timeout=CMD_TIMEOUT)
        if p.returncode != 0:
            log.warning(f"control.sh {args} 실패: {p.stderr.strip()}")
        return p.returncode == 0
    except Exception as e:
        log.error(f"control.sh 실행 오류: {e}")
        return False


def autonomous_takeover(meta: dict):
    """관리 서버 단절 + active 피어 사망 판단 시 VIP 자율 인수."""
    vip   = meta.get('vip')
    cidr  = meta.get('vipCidr', 24)
    iface = meta.get('netIface') or 'eth0'
    if not vip:
        log.error("자율 인수 실패: VIP 미설정(metadata)")
        return
    log.warning(f"자율 페일오버 개시: 관리 서버 단절 + active 피어 사망 → VIP {vip} 인수")
    if _run_control(['vip-up', iface, vip, str(cidr)]):
        STATE.mark_took_over(True)
        log.warning(f"자율 VIP 인수 완료: {vip} (dev {iface})")
    else:
        log.error("자율 VIP 인수 실패")


def peer_heartbeat_loop():
    """active 피어를 주기적으로 확인하고, 관리 서버 단절 시 자율 페일오버를 판단한다."""
    peer_fails = {}
    while True:
        try:
            meta, mgmt_fails, took_over = STATE.snapshot()
            my_role = (meta.get('role') or '').lower()
            peers   = meta.get('peers') or []

            # 관리 서버가 살아 있으면 자율 모드 비활성(페일오버는 관리 서버가 주관)
            mgmt_down = mgmt_fails >= MGMT_FAIL_THRESHOLD

            if mgmt_down and my_role in ('standby',) and not took_over:
                actives = [p for p in peers
                           if (p.get('role') or '').lower() in ('active', 'primary')]
                all_dead = bool(actives)
                for ap in actives:
                    key = ap.get('nodeId') or ap.get('hostname')
                    if ping_peer(ap.get('heartbeatIp')):
                        peer_fails[key] = 0
                        all_dead = False
                    else:
                        peer_fails[key] = peer_fails.get(key, 0) + 1
                        if peer_fails[key] < PEER_FAIL_THRESHOLD:
                            all_dead = False
                if all_dead:
                    autonomous_takeover(meta)
            else:
                peer_fails.clear()
        except Exception as e:
            log.error(f"피어 하트비트 루프 오류: {e}")
        time.sleep(HEARTBEAT_INTERVAL)


def start_peer_heartbeat():
    threading.Thread(target=peer_heartbeat_loop, name='peer-hb', daemon=True).start()
    log.info("피어 하트비트 감시 시작 (자율 페일오버 대비)")


# ---------------------------------------------------------------------------
# Phase D-1: 명령 수신 채널 (관리 서버 → 에이전트, 포트 17001)
# 관리 서버의 AgentCommandController가 보낸 화이트리스트 명령만 실행하고
# {stdout, stderr, exitCode} 를 반환한다.
# ---------------------------------------------------------------------------

def resolve_command(command: str):
    """명령 문자열을 (스크립트 경로, 인자목록)으로 안전 해석. 비허용 시 ValueError."""
    try:
        tokens = shlex.split(command)
    except ValueError as e:
        raise ValueError(f"명령 파싱 실패: {e}")
    if not tokens:
        raise ValueError("빈 명령")

    first = tokens[0].lstrip('./')
    script = ALLOWED_SCRIPTS.get(first)
    if script is None:
        # 문제 + 원인 + 해결: 허용된 스크립트 목록을 함께 안내한다.
        allowed = ', '.join(sorted(ALLOWED_SCRIPTS.keys()))
        raise ValueError(
            f"허용되지 않은 명령: '{first}'. 보안상 화이트리스트 스크립트만 실행 가능합니다. "
            f"허용 목록: {allowed}. (예: 'control.sh health', 'control.sh svc-restart <서비스명>')")
    if not os.path.isfile(script):
        raise ValueError(f"스크립트 없음: {script}")

    # 인자에 개행/널 차단(스크립트 인젝션 방어). 인자는 shell 없이 직접 전달된다.
    for arg in tokens[1:]:
        if '\n' in arg or '\0' in arg:
            raise ValueError("인자에 허용되지 않은 문자")
    return script, tokens[1:]


def execute_command(command: str) -> dict:
    script, args = resolve_command(command)
    log.info(f"명령 실행: {os.path.basename(script)} {' '.join(args)}")
    proc = subprocess.run(
        ['sh', script, *args],
        capture_output=True, text=True, timeout=CMD_TIMEOUT,
    )
    return {
        'stdout':   proc.stdout,
        'stderr':   proc.stderr,
        'exitCode': proc.returncode,
    }


def make_command_handler(api_key: str):
    class CommandHandler(BaseHTTPRequestHandler):
        server_version = 'NemesisAgent/1.0'

        def log_message(self, fmt, *a):  # 기본 stderr 액세스로그 억제
            log.debug("cmd-srv " + fmt % a)

        def _send(self, code: int, payload: dict):
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != '/api/command':
                self._send(404, {'error': 'not found'}); return

            auth = self.headers.get('Authorization', '')
            if not auth.startswith('Bearer ') or auth[7:] != api_key:
                self._send(401, {'error': 'unauthorized'}); return

            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length) or b'{}')
                command = (body.get('command') or '').strip()
                if not command:
                    self._send(400, {'error': 'command is required'}); return
            except Exception as e:
                self._send(400, {'error': f'잘못된 요청: {e}'}); return

            try:
                self._send(200, execute_command(command))
            except ValueError as e:
                log.warning(f"명령 거부: {e}")
                self._send(403, {'error': str(e)})
            except subprocess.TimeoutExpired:
                self._send(504, {'error': '명령 실행 타임아웃'})
            except Exception as e:
                log.error(f"명령 실행 오류: {e}")
                self._send(500, {'error': str(e)})

    return CommandHandler


def start_command_server(api_key: str):
    server = ThreadingHTTPServer(('0.0.0.0', CONTROL_PORT), make_command_handler(api_key))
    t = threading.Thread(target=server.serve_forever, name='cmd-server', daemon=True)
    t.start()
    log.info(f"명령 수신 서버 시작 (포트 {CONTROL_PORT}, 화이트리스트 {len(set(ALLOWED_SCRIPTS.values()))}종)")
    return server


def run_loop(server_url: str, api_key: str):
    last_pull = 0

    while True:
        try:
            metrics = collect_metrics()
            push_metrics(server_url, api_key, metrics)
            STATE.note_push(True)   # 관리 서버 도달 가능
            log.debug("Push OK")
        except urllib.error.URLError as e:
            STATE.note_push(False)  # 관리 서버 단절 → 자율 모드 카운트 증가
            log.warning(f"Push 실패 (연결 불가): {e.reason}")
        except Exception as e:
            STATE.note_push(False)
            log.error(f"Push 오류: {e}")

        # 노드 간 피어 하트비트 측정 결과 보고(관리 UI 하트비트 매트릭스용)
        report_heartbeat(server_url, api_key)

        # 클러스터 메타(피어/VIP) 동기화 → metadata.json 원자적 갱신(D-4)
        if time.time() - last_pull > PULL_INTERVAL:
            try:
                meta = _request(f"{server_url}/api/agent/meta",
                                headers={'Authorization': f'Bearer {api_key}'})
                if meta:
                    STATE.set_meta(meta)
                    save_metadata(meta)
                last_pull = time.time()
            except Exception:
                pass  # 단절 시 마지막으로 받은 메타로 자율 동작

        time.sleep(PUSH_INTERVAL)


def main():
    parser = argparse.ArgumentParser(
        description='Nemesis Agent v1.0 — AIX/Linux HA 노드 에이전트(메트릭 수집·하트비트·명령 수신).')
    sub    = parser.add_subparsers(dest='cmd', metavar='start')

    start = sub.add_parser('start', help='에이전트를 시작해 관리 서버에 등록하고 주기적으로 보고합니다.')
    start.add_argument('--server',  required=True,
                       metavar='URL', help='관리 서버 주소 (예: https://10.0.0.5:18080)')
    start.add_argument('--key',     required=True,
                       metavar='API_KEY', help='노드 등록용 API 키 (UI 설정>에이전트 설치에서 발급)')
    start.add_argument('--version', default='1.0.0',
                       metavar='VER', help='에이전트 버전 태그 (기본: 1.0.0)')

    args = parser.parse_args()

    if args.cmd == 'start':
        log.info(f"Nemesis Agent 시작 → {args.server}")
        try:
            reg = register(args.server, args.key, args.version)
            save_metadata(reg)
        except Exception as e:
            log.error(f"등록 실패: {e}")
            sys.exit(1)
        # 초기 클러스터 메타(피어/VIP) 시드 — 자율 페일오버 대비
        try:
            meta = _request(f"{args.server}/api/agent/meta",
                            headers={'Authorization': f'Bearer {args.key}'})
            if meta:
                STATE.set_meta(meta)
                save_metadata(meta)
        except Exception as e:
            log.warning(f"초기 메타 동기화 실패(계속 진행): {e}")
        try:
            start_command_server(args.key)
            start_heartbeat_server()
            start_peer_heartbeat()
        except Exception as e:
            log.error(f"보조 서버 시작 실패: {e}")
        log.info(f"메트릭 Push 루프 시작 (주기: {PUSH_INTERVAL}초)")
        run_loop(args.server, args.key)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
