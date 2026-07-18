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
# 서브커맨드(S1 — 생성, 멱등):
#   fs-create <wwid> <fstype> <mountpoint>
#     wwid로 디바이스를 다시 찾아 pvcreate→vgcreate→lvcreate(-l 100%FREE)→mkfs→mount까지
#     수행한다. 이미 끝난 단계는 건너뛰고 이어서 진행(vip-up과 동일한 멱등 원칙).
#     LUN 전체를 LV 1개로 쓴다(파티션 분할 없음). Linux 전용(fstype: ext4|xfs).
#
# 서브커맨드(S2 — MountReconciler 지원, 멱등):
#   mount-status <mountpoint>   현재 마운트 여부만 확인(exit 0=마운트됨 / 1=아님). fstab 미등록
#                                원칙이라 재부팅 후 드리프트를 관리서버가 주기 감시하는 데 쓰인다.
#   fs-umount <mountpoint>      standby에 남은 마운트 잔재 해제(스플릿브레인 방지).
#
# AIX 분기는 scan-fc/disk-list만 작성(테스트 보류 — 장비 확보 후 검증 예정, S4).
# fs-create는 AIX 미지원(JFS2는 별도 설계 필요).
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
# 디바이스 생성/마운트 (S1, 멱등, Linux 전용)
# ----------------------------------------------------------------------------

# wwid로 현재 디바이스 경로를 다시 찾는다(재스캔 이후 이름이 바뀔 수 있어 매번 재확인).
resolve_device_by_wwid() {
  wwid=$1
  if has multipath; then
    alias=$(multipath -ll 2>/dev/null | awk -v w="$wwid" '$0 ~ "\\(" w "\\)" { print $1; exit }')
    [ -n "$alias" ] && [ -e "/dev/mapper/$alias" ] && { echo "/dev/mapper/$alias"; return 0; }
  fi
  lsblk -ndp -o NAME,WWN 2>/dev/null | awk -v w="$wwid" '$2==w { print $1; exit }'
}

fs_create() {
  wwid=$1; fstype=$2; mountpoint=$3
  [ -n "$wwid" ] && [ -n "$fstype" ] && [ -n "$mountpoint" ] || usage
  case "$fstype" in
    ext4|xfs) ;;
    *) die "지원하지 않는 fstype: $fstype (ext4|xfs만 허용)" ;;
  esac
  [ "$OS" = "Linux" ] || die "fs-create는 Linux만 지원합니다(OS=$OS)"

  # mountpoint 마지막 세그먼트로 vg/lv 이름을 규칙적으로 파생 — 별도 이름 저장 불필요.
  seg=$(basename "$mountpoint")
  vg="vg_$seg"; lv="lv_$seg"
  lvpath="/dev/$vg/$lv"

  if mountpoint -q "$mountpoint" 2>/dev/null; then
    log "$mountpoint 이미 마운트됨 — 멱등 통과"
    exit 0
  fi

  dev=$(resolve_device_by_wwid "$wwid")
  [ -n "$dev" ] || die "wwid로 디바이스를 찾을 수 없습니다: $wwid (재스캔 필요할 수 있음)"

  has pvs && has vgs && has lvcreate || die "lvm2 명령 없음(pvcreate/vgcreate/lvcreate)"

  if ! pvs "$dev" >/dev/null 2>&1; then
    pvcreate -y "$dev" >/dev/null 2>&1 || die "pvcreate 실패: $dev"
    log "pvcreate 완료: $dev"
  fi

  if ! vgs "$vg" >/dev/null 2>&1; then
    vgcreate "$vg" "$dev" >/dev/null 2>&1 || die "vgcreate 실패: $vg ($dev)"
    log "vgcreate 완료: $vg"
  fi

  if [ ! -e "$lvpath" ]; then
    if vgs "$vg" >/dev/null 2>&1 && lvs "$lvpath" >/dev/null 2>&1; then
      # 재부팅 등으로 VG/LV 메타데이터는 있으나 비활성 상태 — 새로 만들지 않고 활성화만.
      vgchange -ay "$vg" >/dev/null 2>&1 || die "vgchange -ay 실패: $vg"
      log "vgchange -ay 완료(비활성 LV 재활성화): $vg"
    else
      lvcreate -y -l 100%FREE -n "$lv" "$vg" >/dev/null 2>&1 || die "lvcreate 실패: $vg/$lv"
      log "lvcreate 완료: $lvpath"
    fi
  fi

  existing_fstype=$(blkid -o value -s TYPE "$lvpath" 2>/dev/null)
  if [ -z "$existing_fstype" ]; then
    "mkfs.$fstype" -q "$lvpath" >/dev/null 2>&1 || die "mkfs.$fstype 실패: $lvpath"
    log "mkfs.$fstype 완료: $lvpath"
  elif [ "$existing_fstype" != "$fstype" ]; then
    die "$lvpath 에 이미 다른 fstype($existing_fstype)이 있습니다 — 강제 재포맷하지 않음"
  fi

  mkdir -p "$mountpoint" || die "mkdir 실패: $mountpoint"
  mount "$lvpath" "$mountpoint" || die "mount 실패: $lvpath -> $mountpoint"
  log "mount 완료: $lvpath -> $mountpoint"
  exit 0
}

# ----------------------------------------------------------------------------
# 마운트 상태 조회 / 해제 (S2, MountReconciler 지원)
# ----------------------------------------------------------------------------
mount_status() {
  mountpoint_arg=$1
  [ -n "$mountpoint_arg" ] || usage
  if mountpoint -q "$mountpoint_arg" 2>/dev/null; then
    log "$mountpoint_arg 마운트됨"
    exit 0
  fi
  log "$mountpoint_arg 마운트 안 됨"
  exit 1
}

fs_umount() {
  mountpoint_arg=$1
  [ -n "$mountpoint_arg" ] || usage
  if ! mountpoint -q "$mountpoint_arg" 2>/dev/null; then
    log "$mountpoint_arg 이미 마운트 해제됨 — 멱등 통과"
    exit 0
  fi
  umount "$mountpoint_arg" || die "umount 실패: $mountpoint_arg"
  log "umount 완료: $mountpoint_arg"
  exit 0
}

# ----------------------------------------------------------------------------
# 디스패치
# ----------------------------------------------------------------------------
SUB=$1; [ -n "$SUB" ] || usage; shift
case "$SUB" in
  scan-fc)      scan_fc ;;
  disk-list)    disk_list ;;
  fs-create)    fs_create "$1" "$2" "$3" ;;
  mount-status) mount_status "$1" ;;
  fs-umount)    fs_umount "$1" ;;
  *)         log "알 수 없는 서브커맨드: $SUB"; usage ;;
esac
