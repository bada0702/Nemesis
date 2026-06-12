# SW 자동 스캔 및 AI 장애 분석 설계 문서

**날짜:** 2026-06-09  
**프로젝트:** NEMESIS v1.0  
**기능:** SW 자동 스캔 및 프로세스 등록 / AI 장애 로그 분석 및 오류 수정

---

## 1. 전체 구조

두 기능은 동일한 데이터 파이프라인 위에 올라간다.

```
에이전트 (노드)
  └─ 3초마다 MetricsPush ──→ POST /api/agent/metrics
                                  │
                            MetricsCacheService (메모리)
                             ├─ processes[]      ← SW 스캔에 사용
                             └─ errorLogPreview[] ← AI 분석에 사용
                                  │
                    ┌─────────────┴──────────────┐
                    ▼                            ▼
           SwScanController              AiFaultController
           GET  /api/sw/scan             POST /api/ai/analyze/{nodeId}
           POST /api/sw/register         GET  /api/ai/analysis/{nodeId}
           GET  /api/sw/list             POST /api/agent/{nodeId}/execute
                    │                            │
              SwProcessRepository         AiFaultAnalysisRepository
              (sw_process 테이블)          (ai_fault_analysis 테이블)
                                                 │
                                         OllamaService
                                         POST http://localhost:11434/api/chat
                                         model: gemma4:12b
```

**신규 생성:**
- `SwProcess` 엔티티 + 레포지토리
- `AiFaultAnalysis` 엔티티 + 레포지토리
- `OllamaService` (Ollama HTTP 클라이언트)
- `SwScanController` + `SwScanService`
- `AiFaultController` + `AiFaultService`
- 프론트엔드: SW 관리 페이지 스캔 버튼 + 등록 모달
- 프론트엔드: AI 분석 전용 페이지 (`/ai-analysis`)

**수정:**
- `MetricsPushController` — 에러 로그 push 시 AI 자동 분석 비동기 트리거
- `.env` — Ollama 설정으로 변경
- `client.js` — 새 API 함수 추가
- `Navbar.jsx` — `/ai-analysis` 경로 타이틀 추가
- `App.jsx` (라우팅) — `/ai-analysis` 라우트 추가

---

## 2. Feature 1: SW 자동 스캔 및 프로세스 등록

### 스캔 대상 Known SW 목록

서버 내장 목록 (확장 가능):
```
WebLogic, Oracle DB, Tomcat, Nginx, Apache HTTPD,
MySQL, PostgreSQL, Redis, Kafka, Zookeeper,
JBoss/WildFly, IBM MQ, Tibco EMS, HAProxy, Keepalived
```

매칭 방식: 프로세스명 `contains` 검색 (대소문자 무시)

### 백엔드 API

**GET /api/sw/scan?nodeId={nodeId}**
- `MetricsCacheService`에서 해당 노드의 `processes[]` 읽기
- Known SW 목록과 매칭
- 응답:
```json
{
  "known": [
    { "name": "ora_pmon_orcl", "displayName": "Oracle DB 19c", "pid": 12345, "type": "KNOWN" }
  ],
  "unknown": [
    { "name": "proc_xyz", "pid": 22222 }
  ]
}
```

**POST /api/sw/register**
- body: `{ nodeId, clusterId, processes: [{ name, displayName, type, pid }] }`
- `sw_process` 테이블에 upsert (`nodeId + name` 복합 유니크)
- 응답: `{ registered: 3 }`

**GET /api/sw/list?nodeId={nodeId}**
- 등록된 SW 목록 조회
- 응답: `{ items: [...] }`

### 프론트엔드 모달

SW 관리 페이지 상단에 "자동 스캔" 버튼 추가.

```
[자동 스캔] 버튼 클릭
  → 노드 선택 드롭다운 → "스캔 시작"
  → GET /api/sw/scan 호출
  → 결과 모달:

┌─────────────────────────────────────────────┐
│ 자동 감지된 SW (체크박스 목록)               │
│  ☑ WebLogic 12c   PID 12345  [알려진 SW]   │
│  ☑ Oracle DB 19c  PID 67890  [알려진 SW]   │
│  ☐ Tomcat 9       PID 11111  [알려진 SW]   │
├─────────────────────────────────────────────┤
│ 알 수 없는 프로세스 (수동 등록)              │
│  proc_xyz  PID 22222  [표시명 입력] [추가]  │
└─────────────────────────────────────────────┘
[취소]  [선택 항목 등록 (2개)]
```

체크된 항목 + 수동 추가 항목을 `POST /api/sw/register`로 일괄 전송.

---

## 3. Feature 2: AI 장애 로그 분석 및 오류 수정

### Ollama 연동

- URL: `http://localhost:11434/api/chat`
- 모델: `gemma4:12b`
- 스트리밍: `false` (단건 응답)
- HTTP 클라이언트: Spring `RestTemplate`

시스템 프롬프트:
```
당신은 AIX/Linux 엔터프라이즈 시스템 장애 분석 전문가입니다.
에러 로그를 분석하여 근본 원인과 수정 명령어를 JSON 형식으로 반환하세요.
응답 형식: { "rootCause": "...", "fixCommands": [{ "order": 1, "command": "...", "description": "...", "risk": "LOW|MEDIUM|HIGH" }] }
```

### 트리거

| 트리거 | 조건 | 동작 |
|--------|------|------|
| 자동 | 에이전트 push 시 `errorLogPreview` 비어있지 않음 | `@Async` 비동기 분석 실행 |
| 수동 | 관리자 "AI 분석" 버튼 클릭 | `POST /api/ai/analyze/{nodeId}` |

자동 트리거는 마지막 분석 후 5분 이내면 스킵 (중복 분석 방지).

### 백엔드 API

**POST /api/ai/analyze/{nodeId}**
- `MetricsCacheService`에서 `errorLogPreview` 읽기
- Ollama에 분석 요청
- 결과를 `ai_fault_analysis` 테이블에 저장
- 응답: `{ analysisId, status: "ANALYZING" }` (비동기) 또는 분석 결과 (동기 폴백)

**GET /api/ai/analysis/{nodeId}**
- 해당 노드의 최신 분석 결과 반환

**POST /api/agent/{nodeId}/execute**
- body: `{ command }`
- 에이전트 포트 17001로 명령 전달
- 응답: `{ stdout, stderr, exitCode }`

### 프론트엔드 페이지 (/ai-analysis)

```
[AI 장애 분석] 페이지
┌──────────────────────────────────────────────────┐
│ 노드: prod-node-01   분석 시각: 14:32:05          │
│ 상태: 분석 완료 ●                                 │
├──────────────────────────────────────────────────┤
│ 근본 원인                                         │
│ "Oracle 리스너 프로세스가 ORA-12541 오류로        │
│  중단됨. 포트 1521 바인딩 실패."                  │
├──────────────────────────────────────────────────┤
│ 수정 명령어                       위험도          │
│ 1. lsnrctl status                 [낮음]  [실행] │
│ 2. lsnrctl start                  [중간]  [실행] │
│ 3. netstat -an | grep 1521        [낮음]  [실행] │
└──────────────────────────────────────────────────┘
[다시 분석]
```

"실행" 버튼 클릭 시:
- 확인 모달: `"prod-node-01에서 'lsnrctl start'를 실행합니다. 계속하시겠습니까?"`
- `POST /api/agent/{nodeId}/execute` 호출
- 실행 결과(stdout/stderr) 화면에 표시

---

## 4. 데이터 모델

### sw_process

```sql
CREATE TABLE sw_process (
  id           BIGSERIAL PRIMARY KEY,
  node_id      VARCHAR(100) NOT NULL,
  cluster_id   BIGINT REFERENCES clusters(id),
  name         VARCHAR(200) NOT NULL,
  display_name VARCHAR(200),
  type         VARCHAR(20)  NOT NULL DEFAULT 'KNOWN', -- KNOWN | CUSTOM
  status       VARCHAR(20)  DEFAULT 'unknown',         -- running | stopped | unknown
  pid          INTEGER,
  registered_at TIMESTAMP   DEFAULT NOW(),
  UNIQUE (node_id, name)
);
```

### ai_fault_analysis

```sql
CREATE TABLE ai_fault_analysis (
  id           BIGSERIAL PRIMARY KEY,
  node_id      VARCHAR(100) NOT NULL,
  error_logs   TEXT,
  root_cause   TEXT,
  fix_commands JSONB,
  trigger      VARCHAR(10)  DEFAULT 'AUTO',   -- AUTO | MANUAL
  status       VARCHAR(20)  DEFAULT 'PENDING', -- PENDING | ANALYZING | DONE | FAILED
  created_at   TIMESTAMP    DEFAULT NOW()
);
```

---

## 5. .env 변경사항

```diff
- LLM_PROVIDER=openai
- LLM_API_KEY=sk-placeholder
- LLM_MODEL=gpt-4o
+ LLM_PROVIDER=ollama
+ OLLAMA_BASE_URL=http://localhost:11434
+ LLM_MODEL=gemma4:12b
```

---

## 6. 신규 API 엔드포인트 요약

| Method | Path | 설명 |
|--------|------|------|
| `GET`  | `/api/sw/scan?nodeId=` | 노드 프로세스 스캔 |
| `POST` | `/api/sw/register` | 프로세스 일괄 등록 |
| `GET`  | `/api/sw/list?nodeId=` | 등록된 SW 목록 조회 |
| `POST` | `/api/ai/analyze/{nodeId}` | 수동 AI 분석 트리거 |
| `GET`  | `/api/ai/analysis/{nodeId}` | 최신 분석 결과 조회 |
| `POST` | `/api/agent/{nodeId}/execute` | 수정 명령어 에이전트 전달 |
