#!/bin/sh
# Linux 메트릭 수집 — POSIX sh 호환
export LC_ALL=C LANG=C
set -e

HOSTNAME=$(hostname)
TIMESTAMP=$(date +%s)

# CPU: vmstat 1 2 → idle 컬럼(15번째)
CPU_IDLE=$(vmstat 1 2 | tail -1 | awk '{print $15}')
CPU=$(echo "100 - ${CPU_IDLE:-0}" | bc)

# Memory: free -m (LC_ALL=C 로 영문 출력 보장)
MEM_LINE=$(free -m | grep Mem)
MEM_TOTAL=$(echo "$MEM_LINE" | awk '{print $2}')
MEM_USED=$(echo "$MEM_LINE"  | awk '{print $3}')
if [ "${MEM_TOTAL:-0}" -gt 0 ]; then
  MEM_PCT=$(echo "scale=1; $MEM_USED * 100 / $MEM_TOTAL" | bc)
else
  MEM_PCT=0
fi

# Disk: df -m /
DISK_LINE=$(df -m / | tail -1)
DISK_USED=$(echo "$DISK_LINE" | awk '{print $3}')
DISK_TOTAL=$(echo "$DISK_LINE" | awk '{print $2}')
DISK_PCT=$(echo "$DISK_LINE"   | awk '{print $5}' | tr -d '%')

# Network: /proc/net/dev
NET_IF=$(ip route show default 2>/dev/null | awk '{print $5}' | head -1)
NET_IF=${NET_IF:-eth0}
NET_RX=0; NET_TX=0
if [ -f /proc/net/dev ]; then
  NET_LINE=$(grep "${NET_IF}:" /proc/net/dev | head -1)
  NET_RX=$(echo "$NET_LINE" | awk '{print $2}')
  NET_TX=$(echo "$NET_LINE" | awk '{print $10}')
fi

# 알려진 프로세스 감지
PROCESSES=""
for P in ora_pmon tibero tomcat nginx httpd mysqld mariadbd postgres mongod redis-server db2sysc; do
  PID=$(pgrep -f "$P" 2>/dev/null | head -1)
  [ -n "$PID" ] && PROCESSES="${PROCESSES},{\"name\":\"$P\",\"pid\":\"$PID\",\"status\":\"running\"}"
done
PROCESSES=$(echo "$PROCESSES" | sed 's/^,//')

# 에러 로그 프리뷰
ERROR_PREVIEW="[]"
for LOG in /var/log/messages /var/log/syslog; do
  if [ -r "$LOG" ]; then
    ERRORS=$(grep -i "error\|oom\|critical" "$LOG" 2>/dev/null | tail -5 | \
      sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{print "\"" $0 "\""}' | tr '\n' ',' | sed 's/,$//')
    ERROR_PREVIEW="[${ERRORS}]"
    break
  fi
done

printf '{"hostname":"%s","timestamp":%s,"cpuPercent":%s,"memoryPercent":%s,"memoryUsedMb":%s,"memoryTotalMb":%s,"diskPercent":%s,"diskUsedGb":%s,"diskTotalGb":%s,"networkRxBytesPerSec":%s,"networkTxBytesPerSec":%s,"processes":[%s],"errorLogPreview":%s}\n' \
  "$HOSTNAME" "$TIMESTAMP" "${CPU:-0}" "${MEM_PCT:-0}" "${MEM_USED:-0}" "${MEM_TOTAL:-0}" \
  "${DISK_PCT:-0}" "$(echo "${DISK_USED:-0} / 1024" | bc)" "$(echo "${DISK_TOTAL:-0} / 1024" | bc)" \
  "${NET_RX:-0}" "${NET_TX:-0}" "$PROCESSES" "$ERROR_PREVIEW"
