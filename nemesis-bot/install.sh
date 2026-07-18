#!/bin/sh
# Nemesis aibot 사이드카 설치 스크립트
# /opt/nemesis-bot 에 소스+venv를 배포하고 nemesis-sidecar.service(systemd)로 등록한다.
# agent/install.sh(nemesis-agent 설치)와 짝을 이루는 스크립트 — 이건 관리서버 1대에만 실행한다.
set -e

INSTALL_DIR=/opt/nemesis-bot
UNIT_SRC_NAME=nemesis-sidecar.service
UNIT_PATH=/etc/systemd/system/nemesis-sidecar.service
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = "0" ] || { echo "root로 실행하세요(systemd 유닛 설치 필요)."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3가 필요합니다."; exit 1; }
command -v ssh-keygen >/dev/null 2>&1 || { echo "ssh-keygen이 필요합니다(openssh-client)."; exit 1; }

echo "=== Nemesis aibot 사이드카 설치 ==="

echo "-- 소스 복사: $SCRIPT_DIR -> $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
for item in "$SCRIPT_DIR"/*; do
  base=$(basename "$item")
  case "$base" in
    venv|__pycache__|.pytest_cache|.git|.env) continue ;;
  esac
  cp -rf "$item" "$INSTALL_DIR/"
done

echo "-- venv 구성 및 의존성 설치(시간이 걸릴 수 있습니다)"
[ -d "$INSTALL_DIR/venv" ] || python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"

NEW_TOKEN=""
if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo "-- .env 생성"
  NEW_TOKEN=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
  [ -f "$INSTALL_DIR/.env.example" ] && cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env" || : > "$INSTALL_DIR/.env"
  {
    echo ""
    echo "# --- Nemesis 백엔드 연동(install.sh 자동 생성) ---"
    echo "NEMESIS_AIBOT_TOKEN=$NEW_TOKEN"
    echo "NEMESIS_BACKEND_URL=http://localhost:18080"
    echo "NEMESIS_API_URL=http://localhost:18080"
    echo "NEMESIS_OPS_SSH_KEY=$INSTALL_DIR/.ssh/nemesis_ops"
    echo "NEMESIS_OPS_SSH_USER=root"
  } >> "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
else
  echo "-- 기존 .env 유지(덮어쓰지 않음): $INSTALL_DIR/.env"
fi

echo "-- ops SSH 키 준비(아이봇이 관리 노드에 직접 접속할 때 사용)"
mkdir -p "$INSTALL_DIR/.ssh"
if [ ! -f "$INSTALL_DIR/.ssh/nemesis_ops" ]; then
  ssh-keygen -t ed25519 -N "" -C "nemesis-aibot-ops" -f "$INSTALL_DIR/.ssh/nemesis_ops" >/dev/null
fi
chmod 700 "$INSTALL_DIR/.ssh"
chmod 600 "$INSTALL_DIR/.ssh/nemesis_ops"

echo "-- systemd 유닛 등록"
cp -f "$SCRIPT_DIR/$UNIT_SRC_NAME" "$UNIT_PATH"
systemctl daemon-reload
systemctl enable "$UNIT_SRC_NAME"
systemctl restart "$UNIT_SRC_NAME"

sleep 1
if command -v curl >/dev/null 2>&1 && curl -s --max-time 3 http://127.0.0.1:18900/health | grep -q '"status":"ok"'; then
  echo "-- 헬스체크 OK (127.0.0.1:18900/health)"
else
  echo "-- 경고: 헬스체크 실패 — 'journalctl -u nemesis-sidecar -n 50' 로 원인을 확인하세요."
fi

echo ""
echo "설치 완료!"
echo ""
if [ -n "$NEW_TOKEN" ]; then
  echo "  * 아래 토큰을 Nemesis 백엔드의 .env 에도 동일하게 넣고 백엔드를 재기동하세요:"
  echo "      NEMESIS_AIBOT_TOKEN=$NEW_TOKEN"
  echo ""
fi
echo "  * 관리 대상 노드에 SSH 직접 조사를 쓰려면 각 노드의 authorized_keys 에 공개키를 추가하세요:"
echo "      cat $INSTALL_DIR/.ssh/nemesis_ops.pub"
echo "  * 기본 호스트키 정책은 'reject' 입니다 — 최초 접속 전 각 노드를 known_hosts 에 등록하세요:"
echo "      ssh-keyscan -H <노드IP> >> /root/.ssh/known_hosts"
echo "  * LLM 프로바이더(AI_PROVIDER, API 키 등)는 $INSTALL_DIR/.env 에서 직접 채워야 합니다."
echo "  * 상태:  systemctl status nemesis-sidecar"
echo "  * 로그:  journalctl -u nemesis-sidecar -f"
