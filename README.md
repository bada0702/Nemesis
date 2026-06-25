# Nemesis — AIX/Linux HA Console

경량 + AI + 크로스플랫폼 고가용성(HA) 관리 솔루션. 관리 서버가 AIX/Linux 노드의 에이전트로부터 메트릭을 수집하고, 장애를 감지해 VIP 페일오버·자가 복구(Self-Healing)를 수행한다. HACMP/VCS의 경량 대안.

- **관리 서버:** Spring Boot 3.2.5 (Java 17) + PostgreSQL 15 + Flyway
- **웹 UI:** React 18 + Vite + Tailwind
- **에이전트:** Python 3 단일 파일 (AIX/Linux), 표준 셸 메트릭 수집

---

## 빠른 시작 (두 가지 경로)

### A) UI 개발/데모 — 백엔드/Docker 없이 (가장 빠름)

실 Spring 백엔드 대신 `mock-api.js`(시드 데이터를 주는 목 API)를 띄워 프론트만 본다. Node.js만 있으면 된다.

```bash
./nemesis.sh start      # mock-api(:18080) + vite(:5173) 기동
./nemesis.sh status     # 상태 확인
./nemesis.sh logs       # 로그 tail
./nemesis.sh stop       # 종료
```

기동 후 → **http://localhost:5173** (기본 로그인 `admin` / `admin`)

> ⚠️ **목 API는 실 백엔드와 계약이 다르다.** cluster id가 숫자(`1,2,3`)이고 입력 검증이 느슨하며 에러 형식이 단순하다. 실 백엔드는 UUID id·엄격한 검증·RBAC를 쓴다. **출시 전 반드시 아래 B 경로(실 백엔드)로 e2e 검증할 것.**

### B) 풀스택 — 실 백엔드 + PostgreSQL (프로덕션/통합 검증)

Docker와 Docker Compose가 필요하다.

```bash
cp .env.example .env     # 값 채우기 (아래 환경변수 표 참고)
docker compose up -d --build
```

| 서비스 | 포트(호스트) | 설명 |
|--------|------|------|
| 웹 UI (nginx) | `18090` → http://localhost:18090 | `frontend/dist` 정적 서빙 (먼저 `cd frontend && npm run build`) |
| 관리 API (Spring) | `18080` | REST API. Flyway가 기동 시 `V1~V10` 마이그레이션 적용 |
| PostgreSQL | (내부) | 데이터 영속 |

> 프론트엔드를 새로 빌드해야 nginx가 최신 UI를 서빙한다: `cd frontend && npm install && npm run build` 후 `docker compose up -d`.

---

## 포트 맵

| 포트 | 방향 | 용도 |
|------|------|------|
| `18080` | 클라이언트 → 관리 서버 | REST API |
| `18090` | 브라우저 → nginx | 웹 UI (프로덕션) |
| `5173` | 브라우저 → vite | 웹 UI (개발) |
| `17001` | 관리 서버 → 에이전트 | VIP 이동 / Self-Healing 명령 수신 |
| `17000` | 에이전트 ↔ 에이전트 | 노드 간 직접 하트비트 (관리 서버 단절 시 자율 페일오버) |

---

## 환경변수 (`.env`)

`.env.example`을 복사해 채운다. 핵심 값:

```ini
NEMESIS_API_PORT=18080         # 관리 API 포트
NEMESIS_UI_PORT=18090          # 웹 UI 포트
NEMESIS_CONTROL_PORT=17001     # 에이전트 명령 수신 포트

DB_HOST=postgres               # compose 내부 호스트명
DB_NAME=nemesis
DB_USER=nemesis
DB_PASSWORD=changeme           # 운영 환경에서 반드시 교체

LLM_PROVIDER=openai            # openai | anthropic | ollama
LLM_API_KEY=sk-...             # 인터넷 차단 환경은 ollama 사용
LLM_MODEL=gpt-4o

MAX_CLUSTER_GROUPS=10
```

브라우저로 외부 호스트에서 UI에 접속하면 `NEMESIS_ALLOWED_ORIGINS`에 해당 origin을 추가해야 한다(CORS). 미설정 시 로그인 POST가 403.

---

## 에이전트 설치 (관리 대상 노드)

각 AIX/Linux 노드에서:

```bash
cd agent
./install.sh                   # /opt/nemesis-agent 에 배포 (수집/제어/healing 스크립트 포함)

python3 /opt/nemesis-agent/nemesis-agent.py start \
  --server https://{관리서버IP}:18080 \
  --key    {API_KEY}
```

API 키는 관리 UI에서 클러스터/노드를 등록할 때 발급된다. 방화벽에 `17000`·`17001`/TCP를 열어야 페일오버·하트비트가 동작한다.

> 로컬 개발에서 에이전트가 `--server localhost`로 등록하면 serviceIp가 `127.0.0.1`로 잡혀 컨테이너 백엔드가 노드에 도달하지 못한다. `NEMESIS_SERVICE_IP`/`NEMESIS_HEARTBEAT_IP`로 호스트 IP를 지정할 것.

---

## 개발

```bash
# 프론트엔드
cd frontend && npm install && npm run dev     # vite :5173 (→ :18080 프록시)

# 백엔드 (로컬 JDK 없으면 Docker로)
cd backend
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test --console=plain
```

- DB 스키마는 코드가 아니라 **Flyway 마이그레이션**(`backend/src/main/resources/db/migration/V*.sql`)으로 관리한다. 테이블 변경 시 새 `V{n}__설명.sql`을 추가한다 (`ddl-auto: validate`이라 엔티티와 스키마가 어긋나면 기동 실패).
- 새 API 페이지를 추가하면 `mock-api.js`도 같은 계약으로 갱신해야 A 경로 데모가 깨지지 않는다.

---

## 문서

| 문서 | 내용 |
|------|------|
| `Nemesis_PRD.md` | 제품 요구사항 |
| `Nemesis_Roadmap.md` | Phase 1~5 제품 로드맵 |
| `Nemesis_HA_Gap_Analysis_and_Plan.md` | 소스 격차 개선 플랜 + 진행 로그(§7) |
