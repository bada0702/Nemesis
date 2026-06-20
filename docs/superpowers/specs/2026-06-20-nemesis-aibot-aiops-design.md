# Nemesis × aibot — AI 운영자(AIOps) 통합 설계

- **작성일:** 2026-06-20
- **상태:** 승인됨 (브레인스토밍 → 스펙)
- **대상 스펙(SP1):** 통합 척추 + 승인 워크플로 + 대시보드 AI 채팅 패널

---

## 1. 배경 & 목표

Nemesis(Java/Spring HA 오케스트레이터)는 이미 Phase A~E를 완료했다: 결정론적 감지
(`HealthMonitorService`), 자동 페일오버(`FailoverOrchestrator`), 스크립트 자가복구
(`agent/healing/heal_*.sh`), 단발성 LLM 판단(`AiDecisionService`:
FAILOVER_NOW/HOLD/SELF_HEAL_FIRST), 에이전트 명령 채널(17001), 멀티 LLM provider.

`/root/aibot`("헤르메스")는 Python/LangGraph 기반 ReAct 에이전트로, Nemesis에 없는
**반복형 조사·자가교정 루프**(error_analysis → reflexion), 가드레일(루프 방지), 컨텍스트
압축, `run_shell_command`/`self_diagnose`/스킬 자가생성, RAG 메모리, MCP 서버를 갖추고 있다.

**목표:** aibot을 "AI 운영자 두뇌"로 Nemesis에 접목해 다음을 달성한다.

1. **반복형 자가복구 두뇌** — 스크립트로 안 되는 복잡 장애를 aibot이 로그를 까보고·시도하고·검증하는 루프로 조치한다.
2. **능동 로그 모니터링** — 장애 전에도 aibot이 로그·메트릭을 자율 스캔해 이상 징후를 선제 탐지한다. *(SP3)*
3. **더 똑똑한 페일오버 판단** — 단발 LLM 판단을 aibot의 다단 추론으로 교체한다. *(SP4)*

### 확정된 핵심 결정 (브레인스토밍)

| 항목 | 결정 |
|---|---|
| 통합 방식 | **A안** — aibot 사이드카 HTTP 서비스 + Nemesis 오케스트레이션 (하이브리드) |
| 자율성 | **자율 주도형**, 단 *변경 행동* 전 **보고 + 승인 필수** (읽기/조사는 자율) |
| 보고/승인 UI | 대시보드 **AI 채팅 패널** + 상단 **헤더 알림(벨)** |
| 실행 경로 | **aibot 전권 직접**(SSH로 조사·실행), 승인 게이트로 통제 |
| 페일오버 정책 | **페일오버는 자동**(다운타임 최소화), SELF_HEAL·재시작 등 나머지 조치만 승인 |
| 첫 스펙 범위 | **SP1 + 채팅 패널** |

### 비목표 (SP1 범위 밖)

- 능동 로그 모니터링 스케줄러 (SP3)
- 단발 LLM 판단의 전면 교체 (SP4)
- Telegram 등 외부 채널 (보고는 대시보드 채팅 + 헤더 벨로 한정)
- aibot 스킬 자가생성을 Nemesis 운영에 노출 (현 단계 보류)

---

## 2. 아키텍처

```
┌─────────────── Nemesis Dashboard (React) ───────────────┐
│  Header 🔔 NotificationBell      Dashboard               │
│   (PENDING 제안 배지+드롭다운)    └─ AiChatPanel          │
│                                     (대화 + 제안카드      │
│                                      [승인][거부])        │
└───────────────┬─────────────────────────────────────────┘
                │ /api/ai/* (Bearer, RBAC operator+)
┌───────────────▼──────────── Nemesis Backend (Java) ──────┐
│  domain/aiops/                                            │
│   • AiProposal (entity, jsonb actions, status 머신)       │
│   • AiProposalController  (list/get/approve/reject)       │
│   • AiChatController       (→ aibot /chat SSE 프록시)      │
│   • AiOperatorService      (감지→조사→제안→승인→실행 조율) │
│   • AiOperatorClient       (RestTemplate→aibot, 타임아웃)  │
│   • AiNotificationService  (헤더 벨 소스)                  │
│  기존 연결점:                                             │
│   HealthMonitorService → NodeFaultEvent →                │
│   FailoverTriggerListener / AiDecisionService            │
│     └─ SELF_HEAL_FIRST 시 HOLD 대신 investigate 호출      │
│  ★ aibot 다운 시 기존 Rule/결정론 경로로 폴백 (HA 무의존)  │
└───────────────┬──────────────────────────────────────────┘
                │ loopback HTTP (127.0.0.1, Bearer 공유시크릿)
┌───────────────▼──────────── aibot service (Python) ──────┐
│  nemesis_service.py (FastAPI, 신규)                       │
│   • POST /ai/investigate → 읽기전용 ReAct 루프            │
│       → {diagnosis, rootCause, proposedActions[], conf}   │
│   • POST /ai/execute     → 승인된 명령셋 실행+검증         │
│   • POST /ai/chat (SSE)  → 기존 LangGraphAgent.run() 재사용│
│  신규 도구: nemesis_state(클러스터/노드/이벤트 조회),      │
│            remote SSH(전권) — 조사그래프는 읽기도구만 바인드│
└──────────────────────────────────────────────────────────┘
```

### 설계 원칙 3가지

1. **읽기/쓰기 분리** — `/investigate`는 읽기 전용 도구만 바인딩한 LangGraph 그래프
   (로그 tail·진단·상태조회). 변경 명령 도구가 그래프에 없으므로 LLM이 시도해도 불가.
   → "조사는 자율, 행동은 승인 후"를 코드 구조로 강제.
2. **승인된 것만, 보여준 그대로** — 제안 카드에 표시된 명령셋을 `/execute`가 정확히 그것만
   실행+검증. 검증 실패 시 임의로 파괴적 단계를 더하지 않고 *후속 제안*을 새로 올림.
   → "허락 받아야"를 정직하게 유지.
3. **HA는 aibot에 무의존** — aibot 서비스가 죽어도 Nemesis 결정론적 감지·페일오버는 그대로.
   aibot은 "증강"이지 "의존"이 아님.

---

## 3. 컴포넌트 상세

### 3.1 aibot 서비스 (`/root/aibot/nemesis_service.py`, 신규)

기존 `LangGraphAgent`·도구·프로바이더를 재사용하는 얇은 FastAPI 래퍼.

- **바인드:** `127.0.0.1:18900` (loopback 전용). Bearer 시크릿 `NEMESIS_AIBOT_TOKEN`.
- **엔드포인트:**
  - `POST /ai/investigate` — 읽기전용 그래프로 조사 후 구조화 조치안 반환.
  - `POST /ai/execute` — 승인된 명령셋만 실행+검증.
  - `POST /ai/chat` — 기존 `LangGraphAgent.run()` 재사용, SSE 스트림.
  - `GET /health` — 헬스체크(폴백 판정용).
- **신규 도구 (aibot 측):**
  - `nemesis_state` — Nemesis API(`/api/clusters`, `/api/.../nodes`, 이벤트)를 읽어 컨텍스트 제공.
  - `remote_tail_log` / `remote_read_file` / `remote_diagnose` — paramiko SSH 읽기 도구 (조사 그래프 전용).
  - `remote_exec` — paramiko SSH 실행 도구 (**execute 경로 전용**, 조사 그래프엔 미바인드).
- **읽기전용 그래프:** `investigate`용 별도 `bind_tools()` — 읽기 도구 + `nemesis_state`만.
  실행은 그래프가 아니라 승인된 명령 리스트를 `remote_exec`로 순차 실행하는 결정론적 경로.

#### SSH 자격 (구현 세부, 권장안)

aibot 전용 ops SSH 키쌍을 노드에 사전 배포(기존 에이전트 설치와 동일 패턴). Nemesis는
요청에 `sshTarget{host, port, user, iface}`만 전달하고 키는 aibot 로컬 보관.
→ 플랜 단계에서 키 배포 절차를 에이전트 install 흐름에 통합할지 확정.

### 3.2 Nemesis 백엔드 (`com.nemesis.domain.aiops`, 신규 패키지)

- **`AiProposal` (entity):**
  - `id` (UUID), `clusterId`, `nodeId`, `triggerType`
    (DETECTION / AI_DECISION / ROOT_CAUSE / CHAT), `triggerReason`
  - `diagnosis` (text), `rootCause` (text), `confidence` (double)
  - `proposedActions` (jsonb: `[{description, command, target, riskLevel}]`)
  - `status` (PENDING/APPROVED/EXECUTING/SUCCEEDED/FAILED/REJECTED/EXPIRED)
  - `executionLog` (text/jsonb), `decidedBy`, `decidedAt`, `createdAt`, `expiresAt`
- **`AiProposalRepository`** — 파생쿼리(상태별 조회, PENDING 카운트, 만료 후보).
- **`AiOperatorClient`** — RestTemplate로 aibot 호출. 연결/읽기 타임아웃, `/health` 체크.
- **`AiOperatorService`** — 조율 핵심:
  - `onFault(...)` (비동기) → `/investigate` → `AiProposal` PENDING 저장 → 알림 발행.
  - `approve(proposalId, user)` → 상태 검증 → `/execute` → 결과 반영(SUCCEEDED/FAILED) → 알림.
  - `reject(proposalId, user)` / `expireStale()`.
  - aibot 불통 시: investigate 단계면 제안 생략(로그), execute 단계면 FAILED + 운영자 알림.
- **`AiProposalController`** — `GET /api/ai/proposals`(상태 필터), `GET /api/ai/proposals/{id}`,
  `POST /api/ai/proposals/{id}/approve`, `POST /api/ai/proposals/{id}/reject`.
  approve/reject는 **RBAC operator+** (기존 `RbacFilter` 패턴).
- **`AiChatController`** — `POST /api/ai/chat`, aibot `/ai/chat` SSE 패스스루(인증 경유).
- **`AiNotificationService` / 피드** — 헤더 벨 소스. SP1은 `GET /api/ai/notifications`
  (최근 제안/결과 + PENDING 카운트) 폴링으로 시작(SSE는 후속 선택).
- **기존 연결점 수정:**
  - `FailoverTriggerListener` / `AiDecisionService`: SELF_HEAL_FIRST → HOLD 대신
    `AiOperatorService.onFault(...)`로 조사 제안 생성.
  - active 사망 페일오버는 **현행 자동 경로 유지** + 비동기 ROOT_CAUSE 조사 제안만 병렬 추가.

### 3.3 프론트엔드 (React)

- **`AiChatPanel`** (대시보드) — SSE 채팅 UI. 인라인 **제안 카드**(진단·근본원인·명령셋·riskLevel·
  confidence + [승인][거부]). 승인/거부 버튼은 기존 `isOperator`로 게이트.
- **헤더 `NotificationBell`** — PENDING 제안 배지 카운트 + 드롭다운(최근 제안·결과).
  클릭 시 해당 제안을 채팅 패널에 포커스.
- 데이터: `/api/ai/proposals`, `/api/ai/notifications`, `/api/ai/chat`. axios 인터셉터(Bearer) 재사용.

---

## 4. 데이터 흐름

### 흐름 1 — 반응형 페일오버 (active 사망)
감지 → `NodeFaultEvent` → 기존 결정론 경로가 **즉시 자동 페일오버**(승인 X). 동시에
`AiOperatorService.onFault`가 비동기로 `/investigate` 호출 → ROOT_CAUSE 제안(정보 + 선택적
후속 조치) → 벨 + 채팅 보고. 죽은 노드 복귀 등 *조치*는 PENDING 제안(승인 필요).

### 흐름 2 — 반응형 자가복구 (SELF_HEAL / 임계 / 프로세스 다운)
이벤트 → `/investigate`(로그 까보고 진단) → 조치안 제안 PENDING → 벨 + 채팅 카드 →
운영자 **승인** → `/execute`(SSH로 *보여준 명령 그대로* 실행 + 검증) → 결과
SUCCEEDED/FAILED를 채팅·벨에 보고. 검증 실패 시 후속 제안 생성(자동 파괴적 재시도 금지).

### 흐름 3 — 대화형
운영자 채팅 입력 → `/api/ai/chat` → aibot `/ai/chat`. 읽기 질문은 즉답. *변경 지시*는
직접 실행하지 않고 **PENDING 제안 생성** → 같은 승인 흐름. SSE로 패널 스트리밍.

### 제안 상태머신
```
PENDING ──approve──▶ APPROVED ──▶ EXECUTING ──▶ SUCCEEDED
   │                                       └──▶ FAILED
   ├──reject──▶ REJECTED
   └──timeout─▶ EXPIRED
```

---

## 5. aibot 서비스 계약 (JSON)

**`POST /ai/investigate`**
```jsonc
// 요청
{
  "context": {
    "clusterId": "...", "nodeId": "...", "hostname": "db2",
    "role": "active", "triggerType": "DETECTION",
    "triggerReason": "PROCESS_DOWN: oracle",
    "recentEvents": [ ... ], "metrics": { "cpu": 12, "mem": 88, ... }
  },
  "sshTarget": { "host": "10.0.0.12", "port": 22, "user": "oraadm", "iface": "eth0" }
}
// 응답
{
  "diagnosis": "Oracle pmon 프로세스 부재, alert log에 ORA-00257 (archive full)",
  "rootCause": "아카이브 로그 영역 100% → 인스턴스 정지",
  "proposedActions": [
    { "description": "오래된 아카이브 정리", "command": "...", "target": "db2", "riskLevel": "MEDIUM" },
    { "description": "Oracle 인스턴스 기동", "command": "...", "target": "db2", "riskLevel": "HIGH" }
  ],
  "confidence": 0.82
}
```

**`POST /ai/execute`**
```jsonc
// 요청
{ "proposalId": "...", "actions": [ {"command":"...","target":"db2"} ],
  "sshTarget": { ... } }
// 응답
{ "status": "SUCCEEDED",
  "steps": [ {"command":"...","exitCode":0,"output":"..."} ],
  "verification": "pmon 기동 확인, ORA- 오류 소거" }
```

**`POST /ai/chat`** — SSE 청크 `{type: token|tool|proposal|done, ...}`. `proposal` 타입은
변경 지시 시 생성된 PENDING 제안 id를 패널에 전달.

**인증:** 양쪽 `.env` 공유 Bearer `NEMESIS_AIBOT_TOKEN`. aibot은 `127.0.0.1`만 바인드.

---

## 6. 오류 처리 & 폴백

- **investigate 단계 aibot 불통/타임아웃** → 로그 후 제안 생략. Nemesis 결정론 경로 무영향(HA 보존).
- **execute 단계(승인 후) 불통** → 제안 FAILED + 사유, 운영자에 수동 처리 알림.
- **읽기전용 강제** → investigate 그래프에 실행 도구 미바인드. LLM이 시도해도 도구 부재로 불가.
- **만료** → PENDING이 `expiresAt`(기본 30분) 초과 시 스케줄러가 EXPIRED 전이, 실행 차단.
- **멱등** → approve/execute 진입 시 상태 검증으로 이중 실행 방지.
- **감사** → 모든 제안 생성·승인·거부·실행 결과를 `AiProposal` + 기존 RBAC 사용자(`decidedBy`)로 기록.

---

## 7. 테스트 전략

- **Java 단위(JUnit/Mockito):**
  - `AiOperatorService`: investigate 성공 시 PENDING 제안 생성; approve → execute 호출 + 상태 전이;
    aibot 다운 시 폴백(제안 생략/HA 경로 불변); execute 실패 → FAILED.
  - `AiProposalController`: approve/reject RBAC — viewer 403, operator 200; 이중 승인 거부.
- **aibot pytest:**
  - `/ai/investigate`: 구조화 응답 스키마 검증; 읽기전용 그래프가 쓰기 도구를 갖지 않음 확인.
  - `/ai/execute`: 주어진 명령만 실행(mock SSH); 명령 외 임의 실행 없음.
  - `/ai/chat`: SSE 스트림 + 변경 지시 시 proposal 청크 방출.
- **e2e(docker 스택 + headless Chromium):**
  - 장애 모의 → `GET /api/ai/proposals`에 PENDING 등장 → 승인 → SUCCEEDED.
  - 채팅 왕복; 헤더 벨 배지 카운트; viewer 승인 버튼 비활성 확인.

---

## 8. 후속 스펙 (분해)

- **SP2** — *(SP1에 통합)* 대시보드 AI 채팅 패널.
- **SP3** — 능동 로그 모니터링: aibot 자체 스케줄러가 주기적 로그·메트릭 이상탐지 → 제안/알림 푸시.
- **SP4** — 똑똑한 페일오버 판단: `AiDecisionService` 단발 LLM → aibot 다단 추론으로 교체.

---

## 9. 의존성 & 전제

- aibot 측 추가 의존: `fastapi`, `uvicorn`, `paramiko` (requirements 반영).
- aibot 서비스 systemd 등록(부팅 자동 기동), `127.0.0.1:18900` 바인드.
- Nemesis `.env` / `application.yml`에 `NEMESIS_AIBOT_BASE_URL`, `NEMESIS_AIBOT_TOKEN`,
  `nemesis.aiops.enabled`(기본 false → 점진 활성), 제안 만료시간 설정 추가.
- aibot 전용 ops SSH 키 노드 배포(플랜에서 절차 확정).
- Flyway 마이그레이션: `ai_proposals` 테이블 신규.
