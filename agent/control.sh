#!/bin/sh
# =============================================================================
# Nemesis control.sh — HA 실행 명령 디스패처 (Phase D-2)
# AIX / Linux 공통, POSIX sh 호환.
#
# 페일오버 오케스트레이터(Phase B)가 에이전트 명령 채널(17001)을 통해 호출하는
# "실제 인수 동작"의 실행 단위다. VIP 이동 / GPFS 마운트 / 서비스 기동·종료를
# 멱등(idempotent)하게 수행하고, 결과를 종료코드로 명확히 보고한다.
#
# 사용법: control.sh <subcommand> [args...]
# 종료코드: 0 성공 / 1 실패 / 2 잘못된 사용법
#
# 서브커맨드:
#   vip-up    <iface> <vip> [cidr=24]   VIP 인수(별칭 추가 + GARP 브로드캐스트)
#   vip-down  <iface> <vip> [cidr=24]   VIP 해제(별칭 제거)
#   vip-check <vip>                     로컬에 VIP가 떠 있으면 0
#   garp      <iface> <vip>             Gratuitous ARP 재전송(ARP 캐시 갱신)
#   gpfs-mount   <fs>                   GPFS 파일시스템 마운트
#   gpfs-umount  <fs>                   GPFS 파일시스템 언마운트
#   gpfs-state                          mmgetstate 요약(0=active)
#   svc-start  <name>                   서비스 기동(systemd/SysV 자동 감지)
#   svc-stop   <name>                   서비스 종료
#   svc-restart <name>                  서비스 재시작
#   svc-status <name>                   서비스 상태(running=0)
#   dir-list  <path>                    하위 디렉토리 목록(TSV, 읽기전용)
#   dir-sync  <destHbIp> <src> <dst> [--delete] [--exclude=PAT]  rsync over SSH
#   ssh-keygen-nemesis                  rsync용 SSH 키 생성, 공개키 출력(멱등)
#   ssh-authorize <pubkey>              peer 공개키 신뢰 등록(멱등)
# =============================================================================
export LC_ALL=C LANG=C

OS=$(uname -s 2>/dev/null || echo unknown)

log()  { echo "[control] $*" >&2; }
die()  { log "ERROR: $*"; exit 1; }
usage(){ log "usage: control.sh <subcommand> [args...]"; exit 2; }

has() { command -v "$1" >/dev/null 2>&1; }

# ----------------------------------------------------------------------------
# VIP 제어
# ----------------------------------------------------------------------------
cidr_to_netmask() {
  # 24 -> 255.255.255.0  (AIX ifconfig는 dotted netmask를 요구)
  bits=$1; mask=""; i=0
  while [ "$i" -lt 4 ]; do
    if [ "$bits" -ge 8 ]; then o=255; bits=$((bits-8))
    elif [ "$bits" -le 0 ]; then o=0
    else o=$((256 - (1 << (8-bits)))); bits=0
    fi
    [ -z "$mask" ] && mask="$o" || mask="$mask.$o"
    i=$((i+1))
  done
  echo "$mask"
}

vip_present() {
  _vip=$1
  if has ip; then
    ip -o addr show 2>/dev/null | grep -qw "$_vip" && return 0
  fi
  ifconfig -a 2>/dev/null | grep -qw "$_vip" && return 0
  return 1
}

# 설정된 iface가 존재하면 그대로 쓰고, 없으면 VIP 대상 서브넷의 실제 인터페이스를
# 라우팅으로 자동 감지한다. 호스트마다 NIC명이 달라(eth0/ens33/wlp5s0/en0) 기본값
# 'eth0'이 안 맞으면 VIP 인수가 실패하던 문제를 보정한다. AIX/ip 미지원 시 설정값 유지.
resolve_iface() {
  _iface=$1; _vip=$2
  if has ip; then
    if ip link show "$_iface" >/dev/null 2>&1; then
      echo "$_iface"; return 0
    fi
    _dev=$(ip -o route get "$_vip" 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)
    if [ -n "$_dev" ]; then
      log "설정 iface '$_iface' 없음 → 자동 감지 '$_dev' 사용 (VIP $_vip 서브넷)"
      echo "$_dev"; return 0
    fi
  fi
  echo "$_iface"
}

send_garp() {
  _iface=$1; _vip=$2
  if has arping; then
    # -A: ARP REPLY(GARP), -U: unsolicited. 둘 중 지원되는 쪽 사용.
    arping -c 3 -A -I "$_iface" "$_vip" >/dev/null 2>&1 \
      || arping -c 3 -U -I "$_iface" "$_vip" >/dev/null 2>&1 || true
  elif has ping; then
    # 폴백: 자기 자신 ping으로 스위치 MAC 테이블 갱신 유도
    ping -c 1 -w 1 "$_vip" >/dev/null 2>&1 || true
  fi
}

vip_up() {
  iface=$1; vip=$2; cidr=${3:-24}
  [ -n "$iface" ] && [ -n "$vip" ] || usage
  iface=$(resolve_iface "$iface" "$vip")

  if vip_present "$vip"; then
    log "VIP $vip 이미 존재 — 멱등 통과"
  else
    case "$OS" in
      Linux)
        has ip || die "ip 명령 없음"
        ip addr add "$vip/$cidr" dev "$iface" || die "VIP 추가 실패($vip/$cidr dev $iface)"
        ;;
      AIX)
        has ifconfig || die "ifconfig 없음"
        mask=$(cidr_to_netmask "$cidr")
        ifconfig "$iface" alias "$vip" netmask "$mask" || die "VIP alias 실패($vip on $iface)"
        ;;
      *) die "지원하지 않는 OS: $OS" ;;
    esac
    log "VIP $vip/$cidr 인수 완료 (dev $iface)"
  fi
  send_garp "$iface" "$vip"
  log "GARP 브로드캐스트 완료 ($vip via $iface)"
  exit 0
}

vip_down() {
  iface=$1; vip=$2; cidr=${3:-24}
  [ -n "$iface" ] && [ -n "$vip" ] || usage

  if ! vip_present "$vip"; then
    log "VIP $vip 미존재 — 멱등 통과"; exit 0
  fi

  # VIP가 어느 인터페이스에 실제로 할당됐는지 찾는다.
  # ip route get은 VIP 할당 후 'local dev lo'를 반환하므로 신뢰할 수 없다.
  if has ip; then
    _actual=$(ip -o addr show 2>/dev/null | awk -v vip="$vip" '$4 ~ "^"vip"/" {print $2; exit}')
    if [ -n "$_actual" ]; then
      log "VIP $vip 실제 인터페이스: $_actual"
      iface="$_actual"
    else
      iface=$(resolve_iface "$iface" "$vip")
    fi
  fi

  case "$OS" in
    Linux) ip addr del "$vip/$cidr" dev "$iface" || die "VIP 제거 실패" ;;
    AIX)   ifconfig "$iface" delete "$vip"       || die "VIP delete 실패" ;;
    *)     die "지원하지 않는 OS: $OS" ;;
  esac
  log "VIP $vip 해제 완료 (dev $iface)"
  exit 0
}

# ----------------------------------------------------------------------------
# GPFS 제어
# ----------------------------------------------------------------------------
gpfs_mount() {
  fs=$1; [ -n "$fs" ] || usage
  has mmmount || die "mmmount 없음(GPFS 미설치?)"
  if mmlsmount "$fs" -L 2>/dev/null | grep -qi "is mounted"; then
    log "GPFS $fs 이미 마운트 — 멱등 통과"; exit 0
  fi
  mmmount "$fs" || die "GPFS 마운트 실패($fs)"
  log "GPFS $fs 마운트 완료"; exit 0
}

gpfs_umount() {
  fs=$1; [ -n "$fs" ] || usage
  has mmumount || die "mmumount 없음"
  mmumount "$fs" || die "GPFS 언마운트 실패($fs)"
  log "GPFS $fs 언마운트 완료"; exit 0
}

gpfs_state() {
  has mmgetstate || die "mmgetstate 없음"
  out=$(mmgetstate -Y 2>/dev/null || mmgetstate 2>/dev/null)
  echo "$out"
  echo "$out" | grep -qi "active" && exit 0 || exit 1
}

# ----------------------------------------------------------------------------
# 서비스 제어 (systemd → SysV → service 폴백)
# ----------------------------------------------------------------------------
svc_action() {
  action=$1; name=$2
  [ -n "$name" ] || usage
  if has systemctl; then
    systemctl "$action" "$name"
  elif [ -x "/etc/init.d/$name" ]; then
    "/etc/init.d/$name" "$action"
  elif has service; then
    service "$name" "$action"
  else
    die "서비스 관리자 없음 (systemctl/init.d/service)"
  fi
}

svc_status() {
  name=$1; [ -n "$name" ] || usage
  if has systemctl; then
    systemctl is-active --quiet "$name" && { log "$name: running"; exit 0; }
    log "$name: stopped"; exit 1
  elif pgrep -f "$name" >/dev/null 2>&1; then
    log "$name: running(pgrep)"; exit 0
  else
    log "$name: stopped"; exit 1
  fi
}

# ----------------------------------------------------------------------------
# Docker 조회 (자동 스캔용 — 읽기 전용, 상태 변경 없음)
# ----------------------------------------------------------------------------
docker_ps() {
  has docker || die "docker 미설치"
  # 컨테이너 목록(TSV) + 구분자 + 실행중 컨테이너 리소스 통계(TSV)
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Ports}}\t{{.RunningFor}}' 2>/dev/null || die "docker ps 실패"
  echo '---STATS---'
  docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null || true
}

docker_images() {
  has docker || die "docker 미설치"
  used=$(docker ps -a --format '{{.Image}}' 2>/dev/null | sort -u)
  docker images --format '{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' 2>/dev/null | \
  while IFS="$(printf '\t')" read -r repo tag size created; do
    if echo "$used" | grep -qx "$repo:$tag" || echo "$used" | grep -qx "$repo"; then u=true; else u=false; fi
    printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$tag" "$size" "$created" "$u"
  done
}

# ----------------------------------------------------------------------------
# Phase: 폴더 동기화(dir-sync)
# ----------------------------------------------------------------------------
# rsync 전용 SSH 계정. install.sh가 보장(없으면 root 홈 폴백).
SYNC_USER=${NEMESIS_SYNC_USER:-nemesis}

_sync_home() {
  h=$(eval echo "~${SYNC_USER}" 2>/dev/null)
  case "$h" in ~*|"") h="/home/${SYNC_USER}" ;; esac
  [ -d "$h" ] || h=$(eval echo ~ 2>/dev/null)
  echo "$h"
}

# 읽기전용: 지정 경로의 하위 디렉토리만 TSV(name\tdir)로 출력
dir_list() {
  path=$1; [ -n "$path" ] || usage
  [ -d "$path" ] || { log "경로 없음: $path"; exit 2; }
  ls -1Ap "$path" 2>/dev/null | grep '/$' | sed 's#/$##' | while IFS= read -r d; do
    printf '%s\tdir\n' "$d"
  done
}

# active에서 실행: heartbeat IP로 standby에 rsync over SSH
dir_sync() {
  dest_ip=$1; src=$2; dst=$3
  [ -n "$dest_ip" ] && [ -n "$src" ] && [ -n "$dst" ] || usage
  [ $# -ge 3 ] && shift 3 || shift $#
  has rsync || die "rsync 미설치"
  flags="-az --stats"
  for a in "$@"; do
    case "$a" in
      --delete)    flags="$flags --delete" ;;
      --exclude=*) flags="$flags --exclude=${a#--exclude=}" ;;
    esac
  done
  ssh_opts="ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10"
  # shellcheck disable=SC2086
  out=$(rsync $flags -e "$ssh_opts" "$src/" "${SYNC_USER}@${dest_ip}:${dst}/" 2>&1) \
    || { log "rsync 실패: $out"; exit 1; }
  files=$(printf '%s\n' "$out" | sed -n 's/^Number of regular files transferred: *//p' | tr -d ', ')
  bytes=$(printf '%s\n' "$out" | sed -n 's/^Total transferred file size: *//p' | sed 's/ bytes//' | tr -d ', ')
  echo "NEMESIS_SYNC {\"files\":${files:-0},\"bytes\":${bytes:-0}}"
  exit 0
}

# SSH 키쌍 없으면 생성, 공개키 출력(멱등)
ssh_keygen_nemesis() {
  d="$(_sync_home)/.ssh"
  mkdir -p "$d"; chmod 700 "$d"
  key="$d/id_ed25519"
  [ -f "$key" ] || ssh-keygen -t ed25519 -N "" -f "$key" -q || die "키 생성 실패"
  chown -R "${SYNC_USER}" "$d" 2>/dev/null || true
  cat "${key}.pub" || die "공개키 읽기 실패"
}

# peer 공개키를 authorized_keys에 멱등 추가
ssh_authorize() {
  pub="$*"; [ -n "$pub" ] || usage
  d="$(_sync_home)/.ssh"
  mkdir -p "$d"; chmod 700 "$d"
  ak="$d/authorized_keys"; touch "$ak"; chmod 600 "$ak"
  grep -qF "$pub" "$ak" || echo "$pub" >> "$ak"
  chown -R "${SYNC_USER}" "$d" 2>/dev/null || true
  log "authorized"; exit 0
}

# ----------------------------------------------------------------------------
# 디스패치
# ----------------------------------------------------------------------------
SUB=$1; [ -n "$SUB" ] || usage; shift
case "$SUB" in
  vip-up)      vip_up "$@" ;;
  vip-down)    vip_down "$@" ;;
  vip-check)   vip_present "$1" && { log "VIP $1 present"; exit 0; } || { log "VIP $1 absent"; exit 1; } ;;
  garp)        send_garp "$1" "$2"; log "GARP sent"; exit 0 ;;
  gpfs-mount)  gpfs_mount "$@" ;;
  gpfs-umount) gpfs_umount "$@" ;;
  gpfs-state)  gpfs_state ;;
  svc-start)   svc_action start "$1" && { log "$1 started"; exit 0; } || die "$1 start 실패" ;;
  svc-stop)    svc_action stop  "$1" && { log "$1 stopped"; exit 0; } || die "$1 stop 실패" ;;
  svc-restart) svc_action restart "$1" && { log "$1 restarted"; exit 0; } || die "$1 restart 실패" ;;
  svc-status)  svc_status "$1" ;;
  docker-ps)     docker_ps ;;
  docker-images) docker_images ;;
  dir-list)           dir_list "$1" ;;
  dir-sync)           dir_sync "$@" ;;
  ssh-keygen-nemesis) ssh_keygen_nemesis ;;
  ssh-authorize)      ssh_authorize "$@" ;;
  *)           log "알 수 없는 서브커맨드: $SUB"; usage ;;
esac
