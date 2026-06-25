#!/bin/sh
# AIX 메트릭 수집 — AIX ksh/sh 호환 (표준 명령만 사용)
# /proc 없음 → vmstat/svmon/netstat 활용

HOSTNAME=$(hostname)
TIMESTAMP=$(date +%s)

# CPU: vmstat 1 2 → idle(16번째 컬럼, AIX 기준)
CPU_IDLE=$(vmstat 1 2 | tail -1 | awk '{print $16}')
CPU=$(expr 100 - "${CPU_IDLE:-0}" 2>/dev/null || echo 0)

# Memory: svmon -G (AIX 전용, 4KB 페이지 단위)
MEM_TOTAL=0; MEM_USED=0; MEM_PCT=0
if command -v svmon > /dev/null 2>&1; then
  SVS=$(svmon -G 2>/dev/null | awk '/^memory/{print $2, $3}')
  TOTAL_4K=$(echo "$SVS" | awk '{print $1}')
  USED_4K=$(echo "$SVS"  | awk '{print $2}')
  MEM_TOTAL=$(expr "${TOTAL_4K:-0}" \* 4 / 1024 2>/dev/null || echo 0)
  MEM_USED=$(expr "${USED_4K:-0}"   \* 4 / 1024 2>/dev/null || echo 0)
  [ "$MEM_TOTAL" -gt 0 ] && MEM_PCT=$(expr "$MEM_USED" \* 100 / "$MEM_TOTAL")
fi

# Disk: df -m /
DISK_LINE=$(df -m / | tail -1)
DISK_USED=$(echo "$DISK_LINE"  | awk '{print $3}')
DISK_TOTAL=$(echo "$DISK_LINE" | awk '{print $2}')
DISK_PCT=$(echo "$DISK_LINE"   | awk '{print $4}' | tr -d '%')

# Network: netstat -i (AIX)
NET_IF=${NEMESIS_NET_IF:-en0}
NET_RX=$(netstat -i 2>/dev/null | awk -v if="$NET_IF" '$1==if{print $5}' | head -1)
NET_TX=$(netstat -i 2>/dev/null | awk -v if="$NET_IF" '$1==if{print $7}' | head -1)
NET_RX=${NET_RX:-0}; NET_TX=${NET_TX:-0}

# 프로세스 감지
PROCESSES=""
for P in ora_pmon tomcat nginx httpd mysqld; do
  PID=$(ps -ef 2>/dev/null | grep "$P" | grep -v grep | awk '{print $2}' | head -1)
  [ -n "$PID" ] && PROCESSES="${PROCESSES},{\"name\":\"$P\",\"pid\":\"$PID\",\"status\":\"running\"}"
done
PROCESSES=$(echo "$PROCESSES" | sed 's/^,//')

# 에러 로그 프리뷰 (AIX syslog)
ERROR_PREVIEW="[]"
for LOG in /var/log/syslog /var/adm/syslog; do
  if [ -r "$LOG" ]; then
    ERRORS=$(grep -i "error\|oom\|critical" "$LOG" 2>/dev/null | tail -5 | \
      sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{print "\"" $0 "\""}' | tr '\n' ',' | sed 's/,$//')
    ERROR_PREVIEW="[${ERRORS}]"
    break
  fi
done

printf '{"hostname":"%s","timestamp":%s,"cpuPercent":%s,"memoryPercent":%s,"memoryUsedMb":%s,"memoryTotalMb":%s,"diskPercent":%s,"diskUsedGb":%s,"diskTotalGb":%s,"networkRxBytesPerSec":%s,"networkTxBytesPerSec":%s,"processes":[%s],"errorLogPreview":%s}\n' \
  "$HOSTNAME" "$TIMESTAMP" "${CPU:-0}" "${MEM_PCT:-0}" "${MEM_USED:-0}" "${MEM_TOTAL:-0}" \
  "${DISK_PCT:-0}" "$(expr "${DISK_USED:-0}" / 1024 2>/dev/null || echo 0)" \
  "$(expr "${DISK_TOTAL:-0}" / 1024 2>/dev/null || echo 0)" \
  "$NET_RX" "$NET_TX" "$PROCESSES" "$ERROR_PREVIEW"
