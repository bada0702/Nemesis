#!/usr/bin/env bash
# Nemesis HA Console -- 신규 서버 원클릭 설치 (Docker only)
#
# 대상: Docker Engine + compose 플러그인이 설치된 깨끗한 리눅스 서버.
# 하는 일:
#   1) 전제조건 점검(docker, compose)
#   2) .env 생성(없으면 .env.example 기반 + DB 비밀번호 자동 생성)
#   3) 프론트엔드 dist 빌드(node 컨테이너 사용 → 호스트에 node 불필요)
#   4) docker compose up -d --build  (postgres + backend + frontend)
#   5) DB 스키마는 백엔드 부팅 시 Flyway가 자동 적용
#   6) 헬스 확인 후 접속 URL 출력
#
# 재실행 안전(idempotent): 이미 있는 .env 는 보존, 컨테이너는 재기동.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "  ${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "  ${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "  ${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "  ${RED}[ERR ]${NC}  $*"; exit 1; }

echo ""
echo -e "  ${BOLD}Nemesis HA Console -- 신규 서버 설치${NC}"
echo "  ===================================="
echo ""

# ── 1. 전제조건 ────────────────────────────────────────────────
command -v docker &>/dev/null || err "Docker 미설치. https://docs.docker.com/engine/install/ 참고"
docker info &>/dev/null || err "Docker 데몬에 접근 불가(권한/실행 확인). sudo 또는 docker 그룹 필요."
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# compose 명령 탐지: v2(docker compose) 우선, 없으면 v1(docker-compose)
if docker compose version &>/dev/null; then
    COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE="docker-compose"
    warn "compose v1(docker-compose) 사용 — 가능하면 v2 플러그인 권장."
else
    err "docker compose 플러그인이 없습니다. 'docker-compose-plugin' 설치 필요."
fi
ok "compose: ${COMPOSE}"

# ── 2. .env ───────────────────────────────────────────────────
if [ -f .env ]; then
    ok ".env 존재 — 보존(편집하려면 직접 수정)"
else
    [ -f .env.example ] || err ".env.example 이 없습니다(저장소 손상?)"
    cp .env.example .env
    # DB 비밀번호 자동 생성(기본 changeme 치환)
    GEN_PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
    if grep -q '^DB_PASSWORD=' .env; then
        sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=${GEN_PW}/" .env
    fi
    ok ".env 생성 (DB_PASSWORD 자동 생성)"
    warn "AI(LLM)·알림을 쓰려면 .env 의 LLM_*, TELEGRAM_*, EMAIL_* 값을 채우세요."
fi

# 운영 접속 origin 안내(외부 접속 시 CORS 추가 필요)
UI_PORT="$(grep -E '^NEMESIS_UI_PORT=' .env | cut -d= -f2 || true)"; UI_PORT="${UI_PORT:-18090}"

# ── 3. 프론트엔드 dist 빌드 (node 컨테이너) ─────────────────────
if [ -f frontend/dist/index.html ]; then
    info "frontend/dist 이미 존재 — 재빌드하려면 frontend/dist 삭제 후 재실행"
else
    [ -f frontend/package.json ] || err "frontend/package.json 없음"
    info "프론트엔드 빌드(node:20-alpine 컨테이너)..."
    docker run --rm -v "$ROOT/frontend":/app -w /app node:20-alpine \
        sh -c "npm install --no-audit --no-fund && npm run build" \
        || err "프론트엔드 빌드 실패"
    [ -f frontend/dist/index.html ] || err "빌드 산출물(frontend/dist) 없음"
    ok "프론트엔드 빌드 완료"
fi

# ── 4. 컨테이너 기동 (postgres + backend + frontend) ───────────
info "컨테이너 빌드·기동 (postgres → backend → frontend)..."
$COMPOSE up -d --build || err "compose up 실패"
ok "컨테이너 기동 요청 완료"

# ── 5. 헬스 대기 (DB 스키마는 Flyway 자동 적용) ─────────────────
API_PORT="$(grep -E '^NEMESIS_API_PORT=' .env | cut -d= -f2 || true)"; API_PORT="${API_PORT:-18080}"
info "백엔드 헬스 대기(최대 120초, Flyway 마이그레이션 포함)..."
for i in $(seq 1 60); do
    if curl -fsS "http://localhost:${API_PORT}/actuator/health" &>/dev/null \
       || curl -fsS "http://localhost:${API_PORT}/api/health" &>/dev/null; then
        ok "백엔드 응답 확인"
        break
    fi
    sleep 2
    [ "$i" -eq 60 ] && warn "백엔드 헬스 확인 실패 — '$COMPOSE logs nemesis-server' 로 확인하세요."
done

# ── 6. 안내 ────────────────────────────────────────────────────
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; HOST_IP="${HOST_IP:-<server-ip>}"
echo ""
echo -e "  ${GREEN}${BOLD}설치 완료!${NC}"
echo ""
echo "  접속:    http://${HOST_IP}:${UI_PORT}"
echo "  상태:    $COMPOSE ps"
echo "  로그:    $COMPOSE logs -f nemesis-server"
echo "  중지:    $COMPOSE down        (데이터 볼륨 nemesis-data 는 보존)"
echo "  완전삭제: $COMPOSE down -v     (DB 데이터까지 삭제)"
echo ""
echo "  참고: 외부 호스트에서 접속하면 .env 의 NEMESIS_ALLOWED_ORIGINS 에"
echo "        해당 origin(http://${HOST_IP}:${UI_PORT}) 을 추가 후 재기동하세요."
echo "  참고: AI 운영(aibot 사이드카, :18900)은 별도 설치 컴포넌트입니다."
echo ""
