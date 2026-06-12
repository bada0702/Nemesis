#!/bin/sh
# =============================================================================
# Nemesis heal_tomcat.sh — WAS(Tomcat) 레이어 자동 복구 (Phase D-2)
# 진단 → 복구 → 검증. 멱등 보장.
#
# 복구 액션(Roadmap Phase 4 WAS 레이어):
#   1) 응답성 점검(HTTP 포트) + 프로세스 생존 점검
#   2) catalina.out에서 OutOfMemoryError 감지 → setenv.sh 힙(-Xmx) 상향 후 재기동
#   3) 좀비/defunct 프로세스 정리
#   4) graceful shutdown → 미정지 시 kill -9 → startup
#   5) 검증: 포트 LISTEN 복귀
#
# 환경변수(미설정 시 추정):
#   CATALINA_HOME, TOMCAT_PORT(기본 8080), TOMCAT_USER, HEAP_MAX(기본 2048m)
#
# 종료코드: 0 정상/복구성공 / 1 복구실패 / 2 수동조치 필요
# =============================================================================
export LC_ALL=C LANG=C

PORT=${TOMCAT_PORT:-8080}
HEAP_MAX=${HEAP_MAX:-2048m}
log() { echo "[heal_tomcat] $*" >&2; }
has() { command -v "$1" >/dev/null 2>&1; }

discover_home() {
  [ -n "$CATALINA_HOME" ] && [ -x "$CATALINA_HOME/bin/catalina.sh" ] && return 0
  # [c]atalina 브래킷 트릭: grep 자기 프로세스 라인 자기매칭 방지
  CATALINA_HOME=$(ps -ef 2>/dev/null | grep -o '[c]atalina.home=[^ ]*' | head -1 | cut -d= -f2)
  [ -n "$CATALINA_HOME" ] && [ -x "$CATALINA_HOME/bin/catalina.sh" ] && return 0
  for d in /opt/tomcat /usr/local/tomcat /opt/apache-tomcat*; do
    [ -x "$d/bin/catalina.sh" ] && { CATALINA_HOME=$d; return 0; }
  done
  return 1
}

tomcat_pid() { ps -ef 2>/dev/null | grep -i 'org.apache.catalina.startup.Bootstrap' | grep -v grep | awk '{print $2}' | head -1; }

port_up() {
  if has curl; then curl -s -o /dev/null -m 3 "http://127.0.0.1:${PORT}/" && return 0; fi
  if has ss;   then ss -ltn 2>/dev/null | grep -q ":${PORT} " && return 0; fi
  if has netstat; then netstat -ltn 2>/dev/null | grep -q ":${PORT} " && return 0; fi
  return 1
}

run_as() { # $1=cmd  TOMCAT_USER 지정 시 su 전환
  if [ -n "$TOMCAT_USER" ] && [ "$(id -un)" != "$TOMCAT_USER" ]; then
    su - "$TOMCAT_USER" -c "$1"
  else
    sh -c "$1"
  fi
}

# -----------------------------------------------------------------------------
log "Tomcat 진단 시작 (port=${PORT})"
if ! discover_home; then log "CATALINA_HOME 미발견 — 수동 조치 필요"; exit 2; fi
log "CATALINA_HOME=$CATALINA_HOME"

# 1) 정상이면 조기 종료(멱등) -------------------------------------------------
if port_up && [ -n "$(tomcat_pid)" ]; then
  log "Tomcat 정상 응답 — 복구 불필요"; exit 0
fi

# 2) OOM 감지 시 힙 상향 ------------------------------------------------------
CATALINA_OUT="${CATALINA_HOME}/logs/catalina.out"
if [ -r "$CATALINA_OUT" ] && tail -500 "$CATALINA_OUT" | grep -q "OutOfMemoryError"; then
  log "OutOfMemoryError 감지 → setenv.sh 힙 상향(-Xmx${HEAP_MAX})"
  SETENV="${CATALINA_HOME}/bin/setenv.sh"
  if [ ! -f "$SETENV" ] || ! grep -q 'NEMESIS-HEAP' "$SETENV"; then
    printf '\n# NEMESIS-HEAP (auto-tuned by heal_tomcat.sh)\nexport CATALINA_OPTS="$CATALINA_OPTS -Xmx%s -XX:+HeapDumpOnOutOfMemoryError"\n' "$HEAP_MAX" >> "$SETENV"
    chmod +x "$SETENV" 2>/dev/null || true
  else
    log "setenv.sh에 이미 NEMESIS-HEAP 설정 존재 — 중복 추가 생략"
  fi
fi

# 3) 좀비/defunct 정리 --------------------------------------------------------
for z in $(ps -ef 2>/dev/null | grep defunct | grep -v grep | awk '{print $3}'); do
  [ -n "$z" ] && kill -CHLD "$z" 2>/dev/null || true
done

# 4) 재기동 (graceful → 강제) -------------------------------------------------
PID=$(tomcat_pid)
if [ -n "$PID" ]; then
  log "graceful shutdown 시도 (pid=$PID)"
  run_as "$CATALINA_HOME/bin/shutdown.sh" >/dev/null 2>&1 || true
  i=0; while [ $i -lt 10 ] && kill -0 "$PID" 2>/dev/null; do sleep 1; i=$((i+1)); done
  if kill -0 "$PID" 2>/dev/null; then
    log "미정지 → kill -9 (pid=$PID)"; kill -9 "$PID" 2>/dev/null || true; sleep 2
  fi
fi
log "startup 시도"
run_as "$CATALINA_HOME/bin/startup.sh" >/dev/null 2>&1 || { log "startup.sh 실패"; exit 1; }

# 5) 검증 --------------------------------------------------------------------
i=0; while [ $i -lt 20 ]; do port_up && break; sleep 1; i=$((i+1)); done
if port_up; then
  log "복구 검증 성공 (port ${PORT} LISTEN)"; exit 0
else
  log "복구 검증 실패 (port ${PORT} 무응답)"; exit 1
fi
