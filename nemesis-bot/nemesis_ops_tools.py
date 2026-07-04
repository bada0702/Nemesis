"""Nemesis 운영 도구: 원격 SSH(읽기/실행) + Nemesis 상태 조회."""
import logging
import os
import json
import paramiko
import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

NEMESIS_API_URL = os.getenv("NEMESIS_API_URL", "http://localhost:18080")
SSH_KEY = os.getenv("NEMESIS_OPS_SSH_KEY", "/root/aibot/.ssh/nemesis_ops")
SSH_USER_DEFAULT = os.getenv("NEMESIS_OPS_SSH_USER", "root")

# 호스트 키 정책: 기본 reject(미등록 호스트 거부). warn=경고 후 진행, auto=무조건 수용.
SSH_HOSTKEY_POLICY = os.getenv("NEMESIS_OPS_SSH_HOSTKEY_POLICY", "reject").lower()


def _host_key_policy():
    if SSH_HOSTKEY_POLICY == "auto":
        return paramiko.AutoAddPolicy()
    if SSH_HOSTKEY_POLICY == "warn":
        return paramiko.WarningPolicy()
    return paramiko.RejectPolicy()


# 조사/실행이 공유하는 SSH 컨텍스트(서비스가 요청별로 설정).
_ctx = {"host": None, "port": 22, "user": SSH_USER_DEFAULT}


def set_ssh_context(host, port=22, user=None):
    _ctx["host"] = host
    _ctx["port"] = port or 22
    _ctx["user"] = user or SSH_USER_DEFAULT


def remote_exec(host, port, user, command, timeout=30):
    cli = paramiko.SSHClient()
    try:
        cli.load_system_host_keys()
    except Exception:
        pass
    cli.set_missing_host_key_policy(_host_key_policy())
    logger.warning("AUDIT remote_exec %s@%s:%s :: %r", user, host, port, command)
    try:
        cli.connect(hostname=host, port=port, username=user,
                    key_filename=SSH_KEY, timeout=timeout)
        _, stdout, stderr = cli.exec_command(command)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        return {"exitCode": code, "output": (out + err)[:8000]}
    finally:
        cli.close()


def _read(command):
    c = _ctx
    if not c["host"]:
        return "❌ SSH 컨텍스트 미설정"
    r = remote_exec(c["host"], c["port"], c["user"], command)
    return r["output"] if r["exitCode"] == 0 else f"❌ (exit {r['exitCode']}) {r['output']}"


@tool
def remote_tail_log(path: str, lines: int = 100) -> str:
    """대상 노드의 로그 파일 마지막 N줄을 읽는다(읽기 전용)."""
    return _read(f"tail -n {int(lines)} {path}")


@tool
def remote_read_file(path: str) -> str:
    """대상 노드의 텍스트 파일 내용을 읽는다(읽기 전용, 최대 8KB)."""
    return _read(f"cat {path}")


@tool
def remote_diagnose() -> str:
    """대상 노드의 프로세스/디스크/메모리 개요를 수집한다(읽기 전용)."""
    return _read("echo '== ps =='; ps aux --sort=-%cpu | head -15; "
                 "echo '== disk =='; df -h; echo '== mem =='; free -m")


# 채팅 요청자(operator)의 토큰을 도구가 Nemesis 제어 API 호출 시 그대로 사용한다(RBAC 유지).
_auth = {"token": None}


def set_nemesis_auth(token):
    _auth["token"] = token


def _auth_headers():
    t = _auth.get("token")
    return {"Authorization": f"Bearer {t}"} if t else {}


@tool
def nemesis_state(path: str = "/api/clusters") -> str:
    """Nemesis 백엔드의 읽기 API를 조회한다(예: /api/clusters)."""
    try:
        r = httpx.get(NEMESIS_API_URL + path, headers=_auth_headers(), timeout=10)
        return r.text[:8000]
    except Exception as e:
        return f"❌ Nemesis 조회 실패: {e}"


@tool
def nemesis_failover(cluster: str = "") -> str:
    """Nemesis 클러스터에 수동 페일오버(역할 전환: 현재 PRIMARY→STANDBY 승격)를 즉시 실행한다.
    cluster=클러스터명 또는 ID(생략 시 클러스터가 하나뿐이면 그것). 강등/승격 노드는 백엔드가 자동 선택한다.
    operator 이상 권한이 필요하며, 사용자가 채팅에서 명시적으로 페일오버를 지시했을 때만 호출하라."""
    try:
        clusters = httpx.get(NEMESIS_API_URL + "/api/clusters",
                             headers=_auth_headers(), timeout=10).json()
    except Exception as e:
        return f"❌ 클러스터 조회 실패: {e}"
    if not clusters:
        return "❌ 등록된 클러스터가 없습니다."

    key = (cluster or "").strip().lower()
    target = None
    if key:
        for c in clusters:
            cid = str(c.get("id", "")).lower()
            name = str(c.get("name", "")).lower()
            if key == cid or key == name or (key in name):
                target = c
                break
    elif len(clusters) == 1:
        target = clusters[0]

    if target is None:
        names = ", ".join(str(c.get("name") or c.get("id")) for c in clusters)
        return f"❌ 클러스터 '{cluster}'를 찾지 못했습니다. 사용 가능: {names}"

    cid, cname = target.get("id"), target.get("name")
    try:
        r = httpx.post(f"{NEMESIS_API_URL}/api/clusters/{cid}/failover",
                       json={}, headers=_auth_headers(), timeout=60)
    except Exception as e:
        return f"❌ 페일오버 호출 실패: {e}"
    if r.status_code == 401:
        return "❌ 인증 실패(토큰 없음/만료). 페일오버는 operator 이상 권한이 필요합니다."
    if r.status_code == 403:
        return "❌ 권한 부족: 페일오버는 operator 이상만 실행할 수 있습니다."
    if r.status_code >= 400:
        return f"❌ 페일오버 실패(HTTP {r.status_code}): {r.text[:300]}"
    d = r.json() if r.text else {}
    if d.get("success") is False:
        return f"⚠️ 페일오버 보류/불가 ({d.get('status')}): {d.get('message')}"
    return f"✅ '{cname}' 수동 페일오버 완료. 새 Primary = {d.get('newPrimary')} ({d.get('status')})"


READ_TOOLS = [remote_tail_log, remote_read_file, remote_diagnose, nemesis_state]
