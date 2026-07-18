# Nemesis — AIX/Linux HA Console

경량 + AI + 크로스플랫폼 고가용성(HA) 관리 솔루션. 관리 서버가 AIX/Linux 노드의 에이전트로부터 메트릭을 수집하고, 장애를 감지해 VIP 페일오버·자가 복구(Self-Healing)를 수행한다. HACMP/VCS의 경량 대안.

- **관리 서버:** Spring Boot 3.2.5 (Java 17) + PostgreSQL 15 + Flyway
- **웹 UI:** React 18 + Vite + Tailwind
- **에이전트:** Python 3 단일 파일 (AIX/Linux), 표준 셸 메트릭 수집
- **AIOps 사이드카:** LangGraph 기반 AI 운영자(aibot) — 능동 모니터링, 지식베이스(RAG) 기반 장애 조사, 승인 게이트 적용 조치

<img width="2554" height="1268" alt="image" src="https://github.com/user-attachments/assets/a78bc3c6-5e56-4df9-8594-c1dad04a6079" />
<img width="2551" height="1262" alt="image" src="https://github.com/user-attachments/assets/fab816ed-ba04-4a49-9fc5-1bc00692aa19" />
<img width="2544" height="653" alt="image" src="https://github.com/user-attachments/assets/3bc42a48-4df0-47c7-aeb3-7455f416ffc1" />
<img width="2543" height="999" alt="image" src="https://github.com/user-attachments/assets/f5099c26-54f7-4894-8a64-1161a23bc983" />
<img width="2544" height="1004" alt="image" src="https://github.com/user-attachments/assets/df646c85-4123-418a-abd0-6e08272f58f5" />

---

## 빠른 시작 — 풀스택 (실 백엔드 + PostgreSQL)

Docker와 Docker Compose가 필요하다.

```bash
cp .env.example .env     # 값 채우기 (아래 환경변수 표 참고)
docker compose up -d --build
```

| 서비스 | 포트(호스트) | 설명 |
|--------|------|------|
| 웹 UI (nginx) | `18090` → http://localhost:18090 | `frontend/dist` 정적 서빙 (먼저 `cd frontend && npm run build`) |
| 관리 API (Spring) | `18080` | REST API. Flyway가 기동 시 마이그레이션 적용 |
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
| `18900` | 관리 서버 ↔ AIOps 사이드카(aibot) | AI 조사/알림/승인 게이트 |

---

## 환경변수 (`.env`)

`.env.example`을 복사해 채운다. `.env`는 API 키·비밀번호를 담으므로 **절대 커밋하지 않는다**(`.gitignore`에 이미 포함). 핵심 값:

```ini
NEMESIS_API_PORT=18080         # 관리 API 포트
NEMESIS_UI_PORT=18090          # 웹 UI 포트
NEMESIS_CONTROL_PORT=17001     # 에이전트 명령 수신 포트

DB_HOST=postgres               # compose 내부 호스트명
DB_NAME=nemesis
DB_USER=nemesis
DB_PASSWORD=changeme           # 운영 환경에서 반드시 교체

# AI Provider — LLM 설정은 DB(admin 설정 화면)에서도 조정 가능
LLM_PROVIDER=ollama            # ollama | openai | anthropic | gemini
OLLAMA_BASE_URL=http://172.17.0.1:11434
LLM_MODEL=gpt-4o

# AIOps 사이드카(aibot) 연동
NEMESIS_AIOPS_ENABLED=true
NEMESIS_AIBOT_TOKEN=            # 사이드카 인증 토큰 — 실제 값은 .env에만 두고 커밋 금지
NEMESIS_AIBOT_URL=http://172.18.0.1:18900

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

## 주요 기능

- **HA 페일오버**: 클러스터 그룹 단위 VIP 관리, 장애 감지 시 자동 페일오버 + 원인 해소 후 자동 페일백
- **공유 스토리지**: FC 디스크(WWID 식별) 배치 등록 + mount 상태 리컨실(MountReconciler)
- **폴더 동기화**: active→standby rsync 기반 디렉터리 동기화 + 하트비트
- **AIOps**: 능동 모니터링(주기적 이상 탐지) → AI(aibot) 장애 조사 → 승인 게이트를 거친 조치 실행
- **장애 지식베이스**: OS/장비별 RDF 온톨로지(`nemesis-bot/knowledge/`)를 AI 조사 프롬프트에 주입(RAG), 평가 하네스(`nemesis-bot/harness/`)로 회귀 검증
- **LLM 설정**: ollama/openai/anthropic/gemini 중 선택, 관리 UI에서 교체 가능

---

## 개발

```bash
# 프론트엔드
cd frontend && npm install && npm run dev     # vite :5173 (→ :18080 프록시)

# 백엔드 (로컬 JDK 없으면 Docker로)
cd backend
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test --console=plain

# AIOps 사이드카(aibot)
cd nemesis-bot
pip install -r requirements.txt
pytest tests/                                 # 지식베이스/조사 회귀 테스트
```

- DB 스키마는 코드가 아니라 **Flyway 마이그레이션**(`backend/src/main/resources/db/migration/V*.sql`)으로 관리한다. 테이블 변경 시 새 `V{n}__설명.sql`을 추가한다 (`ddl-auto: validate`이라 엔티티와 스키마가 어긋나면 기동 실패).
- 새 API 페이지를 추가하면 `mock-api.js`도 같은 계약으로 갱신해야 A 경로 데모가 깨지지 않는다.

---

## 문서

상세 설계/기획 문서는 `docs/`에 있다.

| 문서 | 내용 |
|------|------|
| `docs/Nemesis_PRD.md` | 제품 요구사항 |
| `docs/Nemesis_Roadmap.md` | Phase 1~5 제품 로드맵 |
| `docs/Nemesis_HA_Gap_Analysis_and_Plan.md` | 소스 격차 개선 플랜 + 진행 로그 |
| `docs/DEPLOY.md` | 배포 절차 |
| `docs/CHANGELOG.md` | 변경 이력 |
| `docs/superpowers/specs/` | 기능별 설계 문서(스토리지, AIOps, 페일오버 등) |
