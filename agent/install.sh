#!/bin/sh
# Nemesis Agent 설치 스크립트
set -e

INSTALL_DIR=/opt/nemesis-agent
CONFIG_DIR=/etc/nemesis

echo "=== Nemesis Agent 설치 ==="
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"
cp -f nemesis-agent.py "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/nemesis-agent.py"

# AIX면 AIX 수집 스크립트, 아니면 Linux
if [ "$(uname)" = "AIX" ]; then
  cp -f collect_aix.sh "$INSTALL_DIR/collect.sh"
else
  cp -f collect.sh "$INSTALL_DIR/collect.sh"
fi
chmod +x "$INSTALL_DIR/collect.sh"

# HA 실행 스크립트(Phase D): VIP/GPFS/서비스 제어 + 레이어별 Self-Healing
cp -f control.sh "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/control.sh"
cp -f storage.sh "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/storage.sh"
mkdir -p "$INSTALL_DIR/healing"
cp -f healing/heal_oracle.sh healing/heal_tomcat.sh healing/heal_nginx.sh "$INSTALL_DIR/healing/"
chmod +x "$INSTALL_DIR/healing/"*.sh

echo ""
echo "설치 완료! 에이전트 시작:"
echo "  python3 $INSTALL_DIR/nemesis-agent.py start \\"
echo "    --server https://{관리서버IP}:18080 \\"
echo "    --key {API_KEY}"
echo ""
echo "※ 포트 방화벽 설정:"
echo "  - 17001/TCP (관리 서버 → 에이전트): VIP 이동 / Self-Healing 명령 수신"
echo "  - 17000/TCP (에이전트 ↔ 에이전트): 노드 간 직접 하트비트(관리 서버 단절 시 자율 페일오버)"
echo "  (각각 NEMESIS_CONTROL_PORT / NEMESIS_HEARTBEAT_PORT 환경변수로 변경 가능)"
