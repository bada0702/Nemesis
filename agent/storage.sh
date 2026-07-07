#!/bin/sh
# =============================================================================
# Nemesis storage.sh — 공유 스토리지(FC SAN) 조회 디스패처 (S0: 읽기 전용)
# AIX / Linux 공통, POSIX sh 호환. control.sh와 동일한 실행 규약을 따른다.
#
# 사용법: storage.sh <subcommand> [args...]
# 종료코드: 0 성공 / 1 실패 / 2 잘못된 사용법
#
# 서브커맨드(S0 — 읽기 전용, 파괴적 변경 없음):
#   scan-fc     FC/SCSI 버스 재스캔 트리거(신규 LUN 인식). 결과 자체는 반환하지 않음
#   disk-list   등록 가능한 LUN 목록(TSV: name\twwid\tsize\tpaths)
#
# AIX 분기는 코드만 작성(테스트 보류 — 장비 확보 후 검증 예정, S4).
# =============================================================================
export LC_ALL=C LANG=C

OS=$(uname -s 2>/dev/null || echo unknown)

log()  { echo "[storage] $*" >&2; }
die()  { log "ERROR: $*"; exit 1; }
usage(){ log "usage: storage.sh <subcommand> [args...]"; exit 2; }

has() { command -v "$1" >/dev/null 2>&1; }

# ----------------------------------------------------------------------------
# FC/SCSI 버스 재스캔
# ----------------------------------------------------------------------------
scan_fc() {
  case "$OS" in
    Linux)
      found=0
      for h in /sys/class/scsi_host/*/scan; do
        [ -e "$h" ] || continue
        echo "- - -" > "$h" 2>/dev/null && found=1
      done
      [ "$found" -eq 1 ] || log "scsi_host scan 인터페이스 없음(FC HBA 미탑재 환경일 수 있음)"
      if has multipath; then
        multipath -r >/dev/null 2>&1 || true
      fi
      log "FC/SCSI 재스캔 완료"
      exit 0
      ;;
    AIX)
      has cfgmgr || die "cfgmgr 없음"
      cfgmgr -v >/dev/null 2>&1 || die "cfgmgr 재스캔 실패"
      log "FC/SCSI 재스캔 완료(cfgmgr)"
      exit 0
      ;;
    *) die "지원하지 않는 OS: $OS" ;;
  esac
}

# ----------------------------------------------------------------------------
# 디스크(LUN) 목록 — TSV: name\twwid\tsize\tpaths
# ----------------------------------------------------------------------------
disk_list_linux_multipath() {
  multipath -ll 2>/dev/null | awk '
    BEGIN { name=""; wwid=""; size=""; paths=0 }
    /^[a-zA-Z0-9_-]+ \(/ {
      if (name != "") printf "%s\t%s\t%s\t%d\n", name, wwid, size, paths
      name=$1; wwid=$2; gsub(/[()]/, "", wwid); size=""; paths=0; next
    }
    {
      for (i=1;i<=NF;i++) if ($i ~ /^size=/) { split($i,a,"="); size=a[2] }
      if ($0 ~ /running$/) paths++
    }
    END { if (name != "") printf "%s\t%s\t%s\t%d\n", name, wwid, size, paths }
  '
}

disk_list_linux_fallback() {
  # multipath 미설치(단일경로) — WWN 지원(util-linux 2.29+) lsblk 폴백
  lsblk -ndp -o NAME,WWN,SIZE,TYPE 2>/dev/null | awk '
    $4 == "disk" && $2 != "" { print $1 "\t" $2 "\t" $3 "\t1" }
  '
}

disk_list() {
  case "$OS" in
    Linux)
      out=""
      if has multipath; then
        out=$(disk_list_linux_multipath)
      fi
      if [ -z "$out" ]; then
        has multipath || log "multipath 미설치 — 단일경로 폴백 조회"
        out=$(disk_list_linux_fallback)
      fi
      [ -n "$out" ] && printf '%s\n' "$out"
      exit 0
      ;;
    AIX)
      # 미검증(AIX 장비는 있으나 이번 릴리스 테스트 보류) — lspv 기반 베스트에포트
      has lspv || die "lspv 없음"
      lspv 2>/dev/null | awk '{ print $1 "\t" $1 "\t\t1" }'
      exit 0
      ;;
    *) die "지원하지 않는 OS: $OS" ;;
  esac
}

# ----------------------------------------------------------------------------
# 디스패치
# ----------------------------------------------------------------------------
SUB=$1; [ -n "$SUB" ] || usage; shift
case "$SUB" in
  scan-fc)   scan_fc ;;
  disk-list) disk_list ;;
  *)         log "알 수 없는 서브커맨드: $SUB"; usage ;;
esac
