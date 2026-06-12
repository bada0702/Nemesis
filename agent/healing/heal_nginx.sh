#!/bin/sh
# =============================================================================
# Nemesis heal_nginx.sh — Web(Nginx) 레이어 자동 복구 (Phase D-2)
# 진단 → 복구 → 검증. 멱등 보장.
#
# 복구 액션(Roadmap Phase 4 Web 레이어):
#   1) nginx -t 설정 문법 검사 → 오류 시 직전 정상 백업(.nemesis-bak)으로 롤백
#   2) 마스터 프로세스 부재 시 start, 존재 시 reload(무중단)
#   3) 포트 바인딩 오류(EADDRINUSE) 감지 시 점유 프로세스 안내
#   4) 인증서 만료 임박(30일 이내) 경고
#   5) 검증: 포트 LISTEN + nginx -t OK
#
# 환경변수(미설정 시 추정):
#   NGINX_BIN, NGINX_CONF, NGINX_PORT(기본 80)
#
# 종료코드: 0 정상/복구성공 / 1 복구실패 / 2 수동조치 필요
# =============================================================================
export LC_ALL=C LANG=C

PORT=${NGINX_PORT:-80}
log() { echo "[heal_nginx] $*" >&2; }
has() { command -v "$1" >/dev/null 2>&1; }

NGINX_BIN=${NGINX_BIN:-$(command -v nginx 2>/dev/null)}
[ -x "$NGINX_BIN" ] || { log "nginx 바이너리 미발견 — 수동 조치 필요"; exit 2; }

# 활성 설정 파일 경로 추정
if [ -z "$NGINX_CONF" ]; then
  NGINX_CONF=$("$NGINX_BIN" -t 2>&1 | grep -o '/[^ ]*nginx.conf' | head -1)
  NGINX_CONF=${NGINX_CONF:-/etc/nginx/nginx.conf}
fi
BAK="${NGINX_CONF}.nemesis-bak"

master_pid() { ps -ef 2>/dev/null | grep 'nginx: master' | grep -v grep | awk '{print $2}' | head -1; }

port_up() {
  if has ss; then ss -ltn 2>/dev/null | grep -q ":${PORT} " && return 0; fi
  if has netstat; then netstat -ltn 2>/dev/null | grep -q ":${PORT} " && return 0; fi
  if has curl; then curl -s -o /dev/null -m 3 "http://127.0.0.1:${PORT}/" && return 0; fi
  return 1
}

config_ok() { "$NGINX_BIN" -t -c "$NGINX_CONF" >/dev/null 2>&1; }

# -----------------------------------------------------------------------------
log "Nginx 진단 시작 (conf=$NGINX_CONF, port=$PORT)"

# 1) 설정 검사 + 롤백 --------------------------------------------------------
if config_ok; then
  # 정상 설정을 안전 백업(다음 장애 시 롤백 기준)
  cp -p "$NGINX_CONF" "$BAK" 2>/dev/null || true
  log "설정 문법 정상 — 백업 갱신"
else
  log "설정 문법 오류 감지"
  if [ -r "$BAK" ]; then
    log "직전 정상 백업으로 롤백 시도"
    cp -p "$BAK" "$NGINX_CONF" 2>/dev/null || { log "롤백 복사 실패"; exit 1; }
    if config_ok; then log "롤백 후 설정 정상"; else log "롤백 후에도 설정 오류 — 수동 조치 필요"; exit 2; fi
  else
    log "롤백 백업 없음 — 수동 조치 필요"; exit 2
  fi
fi

# 2) 인증서 만료 임박 경고 ----------------------------------------------------
if has openssl; then
  for crt in $(grep -rhoE 'ssl_certificate[[:space:]]+[^;]+' /etc/nginx 2>/dev/null | awk '{print $2}' | sort -u); do
    [ -r "$crt" ] || continue
    if ! openssl x509 -checkend 2592000 -noout -in "$crt" >/dev/null 2>&1; then
      log "경고: 인증서 30일 내 만료 임박 — $crt"
    fi
  done
fi

# 3) 기동 / 리로드 -----------------------------------------------------------
PID=$(master_pid)
if [ -n "$PID" ]; then
  log "마스터 생존(pid=$PID) → 무중단 reload"
  "$NGINX_BIN" -s reload -c "$NGINX_CONF" >/dev/null 2>&1 || { log "reload 실패 → 재기동"; "$NGINX_BIN" -s stop >/dev/null 2>&1; sleep 1; "$NGINX_BIN" -c "$NGINX_CONF" >/dev/null 2>&1; }
else
  log "마스터 부재 → start"
  if ! "$NGINX_BIN" -c "$NGINX_CONF" >/dev/null 2>&1; then
    # 포트 점유 충돌 진단
    if has ss && ss -ltnp 2>/dev/null | grep -q ":${PORT} "; then
      OWNER=$(ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -o 'users:.*' | head -1)
      log "포트 ${PORT} 바인딩 충돌 — 점유: $OWNER (수동 조치 필요)"; exit 2
    fi
    log "nginx 기동 실패"; exit 1
  fi
fi

# 4) 검증 --------------------------------------------------------------------
i=0; while [ $i -lt 10 ]; do port_up && break; sleep 1; i=$((i+1)); done
if port_up && config_ok; then
  log "복구 검증 성공 (port ${PORT} LISTEN, config OK)"; exit 0
else
  log "복구 검증 실패"; exit 1
fi
