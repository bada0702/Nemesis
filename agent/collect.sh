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
# total - available 방식: buffers/cache 포함, htop 기준과 일치
MEM_LINE=$(free -m | grep Mem)
MEM_TOTAL=$(echo "$MEM_LINE" | awk '{print $2}')
MEM_AVAIL=$(echo "$MEM_LINE" | awk '{print $7}')
MEM_USED=$(echo "$MEM_TOTAL - $MEM_AVAIL" | bc)
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

# 알려진 프로세스 감지 (+ 프로세스별 CPU/메모리 사용률)
PROCESSES=""
for P in ora_pmon tibero tomcat nginx httpd apache2 php-fpm php mysqld mariadbd postgres mongod redis-server db2sysc rabbitmq-server java node python; do
  PIDS=$(pgrep -f "$P" 2>/dev/null || true)
  [ -z "$PIDS" ] && continue
  FIRST=$(echo "$PIDS" | head -1)
  CSV=$(echo "$PIDS" | tr '\n' ',' | sed 's/,$//')
  # 매칭되는 모든 PID의 %CPU·%MEM을 합산(멀티 워커 서비스 대응)
  USAGE=$(ps -o %cpu=,%mem= -p "$CSV" 2>/dev/null | awk '{c+=$1; m+=$2} END {printf "%.1f|%.1f", c+0, m+0}')
  PCPU=$(echo "$USAGE" | cut -d'|' -f1); [ -z "$PCPU" ] && PCPU=0
  PMEM=$(echo "$USAGE" | cut -d'|' -f2); [ -z "$PMEM" ] && PMEM=0
  PROCESSES="${PROCESSES},{\"name\":\"$P\",\"pid\":\"$FIRST\",\"status\":\"running\",\"cpuPercent\":$PCPU,\"memPercent\":$PMEM}"
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
