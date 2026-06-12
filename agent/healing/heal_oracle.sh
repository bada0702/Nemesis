#!/bin/sh
# =============================================================================
# Nemesis heal_oracle.sh — Oracle DB 레이어 자동 복구 (Phase D-2)
# 진단 → 복구 → 검증 루프. 멱등 보장.
#
# 복구 액션(Roadmap Phase 4 DB 레이어):
#   1) 리스너(LISTENER) 생존 확인 → 죽었으면 lsnrctl start
#   2) pmon(인스턴스) 생존 확인 → 죽었으면 sqlplus startup (best-effort)
#   3) 블로킹 락 세션 정리 (alter system kill session)
#   4) 아카이브 로그 영역 포화 시 경고(자동 삭제는 정책상 보류)
#   5) 검증: 리스너 status + pmon 존재
#
# 환경변수(미설정 시 자동 추정):
#   ORACLE_HOME, ORACLE_SID, ORA_OWNER(기본 oracle)
#
# 종료코드: 0 정상/복구성공 / 1 복구실패 / 2 수동조치 필요
# =============================================================================
export LC_ALL=C LANG=C

ORA_OWNER=${ORA_OWNER:-oracle}
log()  { echo "[heal_oracle] $*" >&2; }
has()  { command -v "$1" >/dev/null 2>&1; }

# oracle 유저 권한으로 명령 실행(루트로 호출될 수 있으므로 su 전환)
as_oracle() {
  if [ "$(id -un)" = "$ORA_OWNER" ]; then
    sh -c "$1"
  else
    su - "$ORA_OWNER" -c "$1"
  fi
}

# ORACLE_HOME 추정
discover_home() {
  [ -n "$ORACLE_HOME" ] && return 0
  if [ -r /etc/oratab ]; then
    line=$(grep -v '^#' /etc/oratab 2>/dev/null | grep -v '^$' | head -1)
    ORACLE_SID=${ORACLE_SID:-$(echo "$line" | cut -d: -f1)}
    ORACLE_HOME=$(echo "$line" | cut -d: -f2)
  fi
  [ -n "$ORACLE_HOME" ]
}

listener_up()  { as_oracle "$ORACLE_HOME/bin/lsnrctl status >/dev/null 2>&1"; }
pmon_up()      { pgrep -f "ora_pmon_${ORACLE_SID}" >/dev/null 2>&1 || pgrep -f "ora_pmon" >/dev/null 2>&1; }

# -----------------------------------------------------------------------------
log "Oracle 진단 시작 (SID=${ORACLE_SID:-?})"

if ! discover_home; then
  log "ORACLE_HOME을 찾을 수 없음 — 수동 조치 필요"; exit 2
fi
export ORACLE_HOME ORACLE_SID

# 1) 리스너 복구 -------------------------------------------------------------
if listener_up; then
  log "리스너 정상"
else
  log "리스너 다운 감지 → 재기동 시도"
  as_oracle "$ORACLE_HOME/bin/lsnrctl start" >/dev/null 2>&1
  sleep 2
  if listener_up; then log "리스너 재기동 성공"; else log "리스너 재기동 실패"; fi
fi

# 2) 인스턴스(pmon) 복구 -----------------------------------------------------
if pmon_up; then
  log "인스턴스(pmon) 정상"
else
  log "pmon 부재 → STARTUP 시도(best-effort)"
  as_oracle "$ORACLE_HOME/bin/sqlplus -s / as sysdba <<'SQL'
whenever sqlerror exit 1
startup
exit
SQL" >/dev/null 2>&1
  sleep 3
  if pmon_up; then log "인스턴스 기동 성공"; else log "인스턴스 기동 실패 — 수동 조치 필요"; exit 2; fi
fi

# 3) 블로킹 락 세션 정리 -----------------------------------------------------
log "블로킹 락 세션 점검"
KILLED=$(as_oracle "$ORACLE_HOME/bin/sqlplus -s / as sysdba <<'SQL'
set heading off feedback off pagesize 0
begin
  for r in (select distinct blocking_session sid from v\$session
            where blocking_session is not null) loop
    begin
      execute immediate 'alter system kill session '''||
        (select sid||','||serial# from v\$session where sid=r.sid and rownum=1)||''' immediate';
      dbms_output.put_line('killed '||r.sid);
    exception when others then null;
    end;
  end loop;
end;
/
exit
SQL" 2>/dev/null | grep -c '^killed')
[ "${KILLED:-0}" -gt 0 ] && log "블로킹 세션 ${KILLED}건 정리" || log "블로킹 세션 없음"

# 4) 아카이브 로그 영역(FRA) 사용률 경고 -------------------------------------
FRA_PCT=$(as_oracle "$ORACLE_HOME/bin/sqlplus -s / as sysdba <<'SQL'
set heading off feedback off pagesize 0
select round(max(percent_space_used)) from v\$flash_recovery_area_usage;
exit
SQL" 2>/dev/null | tr -dc '0-9')
if [ -n "$FRA_PCT" ] && [ "$FRA_PCT" -ge 90 ]; then
  log "경고: 아카이브/FRA 영역 ${FRA_PCT}% — RMAN 정리 필요(자동삭제 보류)"
fi

# 5) 최종 검증 ---------------------------------------------------------------
if listener_up && pmon_up; then
  log "복구 검증 성공 (리스너 UP, 인스턴스 UP)"; exit 0
else
  log "복구 검증 실패"; exit 1
fi
