# Nemesis × aibot — SP3 능동 로그/메트릭 모니터링 설계

- **작성일:** 2026-06-22
- **상태:** 승인됨 (브레인스토밍 → 스펙)
- **상위 설계:** `docs/superpowers/specs/2026-06-20-nemesis-aibot-aiops-design.md` (§8 SP3)
- **선행 스펙:** SP1 (통합 척추 + 승인 워크플로 + 채팅 패널) — Java 측 구현 완료

---

## 1. 배경 & 목표

SP1은 **반응형**이다: 장애가 감지(`NodeFaultEvent`)된 *뒤에* aibot이 조사·조치를 제안한다.
SP3는 **선제형**을 더한다: 장애가 터지기 *전에* 노드의 로그·메트릭을 주기적으로 자율
스캔해 이상 징후를 탐지하고, 정보성 알림(심각 시 조치 제안)으로 운영자에게 보고한다.

**목표:** 디스크 누적·메모리 누수·반복 에러 패턴 등 "서서히 나빠지는" 문제를 장애로
번지기 전에 잡는다. SP1의 승인 게이트·알림 인프라를 최대한 재사용한다.

### 확정된 핵심 결정 (브레인스토밍 2026-06-22)

| 항목 | 결정 |
|---|---|
| 산출물 | **정보성 알림 + 심각 시 조치 PENDING 제안** (SP1 승인 흐름 재사용), 심각도 게이트 |
| 스케줄러 위치 | **Nemesis(Java) 측** `@Scheduled` — Nemesis→aibot 단방향 유지, HA 무영향 |
| 탐지 방식 | **2단계 하이브리드** — 결정론 사전필터 → 의심 건만 사이드카 LLM 조사 |
| 소음 제어 | **상태추적 `AiFinding`** (open/resolved), open 동안 재알림 억제·복구 시 해소 알림 |

### 비목표 (SP3 범위 밖)

- SP4 — 단발 LLM 페일오버 판단의 aibot 다단 추론 교체.
- 외부 채널(텔레그램 등) — 보고는 SP1과 동일하게 대시보드 벨/채팅으로 한정.
- 1차 사전필터의 매 주기 SSH 접근 (§2 원칙 1: 주기 루프는 SSH/LLM 미사용).
- 능동 스캐너가 스스로 조치 실행 (조치는 항상 PENDING 제안 → 승인 후 SP1 `/ai/execute`).

---

## 2. 아키텍처

```
┌─────────────── Nemesis Dashboard (React) ───────────────┐
│  Header 🔔 NotificationBell (FINDING 알림 포함)          │
│  Dashboard "열린 이슈" 패널/탭 (GET /api/ai/findings)    │
└───────────────┬─────────────────────────────────────────┘
                │ /api/ai/* (Bearer, RBAC)
┌───────────────▼──────────── Nemesis Backend (Java) ──────┐
│  com.nemesis.domain.aiops.monitor/                       │
│   • AiMonitorScheduler  @Scheduled(기본 PT5M, config on/off) │
│        │ 1차: 결정론 사전필터 (값쌈, SSH/LLM 없음)        │
│        │   - 메트릭 임계치(DISK/MEM/CPU) ← 이미 수집된 값  │
│        │   - 최근 NodeFaultEvent / 이벤트 급증             │
│        ▼ 의심 대상(node, signalType)만                    │
│   • AiMonitorService                                      │
│        │ 2차: 의심 건만 사이드카 LLM 조사 호출            │
│        ▼                                                  │
│   • AiOperatorClient ──loopback HTTP──▶ aibot /ai/scan    │
│        ▼ findings[]                                       │
│   • AiFindingService → AiFinding upsert(open/resolved)    │
│        │   - 신규/미해소 → 벨+채팅 알림                   │
│        │   - severity>=HIGH → AiProposal PENDING(연결)    │
│        │   - 신호 해소 → resolved + 복구 알림             │
│        ▼                                                  │
│   • AiFindingController  GET /api/ai/findings             │
│  ★ aibot 다운 시 2차 조사만 생략, 결정론 경로 무영향(HA)  │
└───────────────┬──────────────────────────────────────────┘
                │ loopback HTTP (Bearer 공유시크릿, SP1과 동일)
┌───────────────▼──────────── aibot service (Python) ──────┐
│  nemesis_service.py (SP1) + POST /ai/scan (신규)          │
│   • 읽기전용 그래프(run_investigation 재사용)로            │
│     로그 tail·판정 → findings[] 반환                      │
└──────────────────────────────────────────────────────────┘
```

### 설계 원칙 3가지 (SP1 원칙 계승)

1. **주기 루프는 값싸게** — 1차 사전필터는 *Nemesis가 이미 가진* 메트릭/이벤트만 사용
   (SSH·LLM 미사용). SSH 로그 접근과 LLM은 의심 건 2차 조사에서만. → 평상시 비용 거의 0.
2. **HA 무의존 유지** — aibot 사이드카 다운 시 2차 조사만 건너뛰고(1차 규칙 알림은 계속)
   Nemesis 결정론 감지·페일오버 경로 무영향. aibot은 "증강"이지 "의존"이 아님.
3. **읽기 전용 조사** — `/ai/scan`도 `/ai/investigate`처럼 읽기 도구만 바인딩. 조치는 항상
   PENDING 제안 → 승인 후 SP1 `/ai/execute` 경로로만 실행.

---

## 3. 데이터 모델

### 신규 엔티티 `AiFinding` (Flyway `V14__ai_findings.sql`)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | UUID | PK |
| `clusterId`, `nodeId` | UUID | 대상 |
| `signalType` | enum | `DISK_FULL`/`MEM_HIGH`/`CPU_SUSTAINED`/`LOG_ERROR_PATTERN`/`EVENT_SPIKE`/`OTHER` |
| `fingerprint` | varchar | dedup 키 (= nodeId + signalType) |
| `severity` | enum | `INFO`/`WARN`/`HIGH`/`CRITICAL` |
| `status` | enum | `OPEN`/`RESOLVED` |
| `summary` | text | 1차 규칙 결과 요약 |
| `diagnosis`, `rootCause` | text (nullable) | 2차 LLM 조사 결과 |
| `proposalId` | UUID (nullable) | 심각 시 연결된 `AiProposal` FK |
| `detail` | text(JSON, Jackson) | 메트릭 스냅샷/매칭 패턴 등 근거 |
| `firstSeenAt`, `lastSeenAt`, `resolvedAt`, `createdAt` | timestamp | 생명주기 |

- **유니크 인덱스:** (`nodeId`, `signalType`) WHERE `status = 'OPEN'` (부분 유니크) — 노드별
  같은 신호의 OPEN은 동시에 1건만.
- **upsert 규칙:** (nodeId, signalType, OPEN) 존재 → `lastSeenAt`만 갱신(재알림 X).
  없으면 신규 INSERT + 알림. 다음 스캔에서 신호 미검출 → 해당 OPEN을 `RESOLVED`(+복구 알림).

### `AiFindingRepository`

- 파생쿼리: OPEN 목록(클러스터/노드/심각도 필터), (nodeId, signalType) OPEN 단건 조회,
  현재 스캔에서 사라진 OPEN finding(해소 후보) 조회.

### 알림 — `AiNotification` 재사용 (신규 테이블 없음)

- SP1 헤더 벨 피드(`AiNotificationService`)에 타입 `FINDING` / `FINDING_RESOLVED` 추가.
- finding 클릭 시 대시보드 "열린 이슈" 패널 또는 연결된 제안으로 포커스.

---

## 4. 컴포넌트 상세

### 4.1 `AiMonitorScheduler` (Java)

- `@Scheduled(fixedDelayString = "${nemesis.aiops.monitor.interval}")`,
  `nemesis.aiops.monitor.enabled=false`면 즉시 return(점진 활성).
- **1차 결정론 필터** (SSH·LLM 없이, 이미 수집된 메트릭/이벤트만):
  - `DISK_FULL`: 디스크 ≥ `disk-threshold`(기본 90)
  - `MEM_HIGH`: 메모리 ≥ `mem-threshold`(기본 90)
  - `CPU_SUSTAINED`: CPU ≥ `cpu-threshold`(기본 90)가 `cpu-sustained-cycles`회 연속
  - `EVENT_SPIKE`: `event-spike-window` 내 `NodeFaultEvent`/경고 ≥ `event-spike-count`
- **예비 심각도(밴딩):** 1차 필터가 임계 초과 폭으로 예비 severity를 매긴다 — 임계치 도달
  = `WARN`, `critical` 밴드(기본 임계+5%p, 예: 디스크 95%↑) = `HIGH`. 이 예비 severity가
  2차 LLM 조사 호출 여부(§4.2)와 알림 처리(§4.3)의 기준이 된다. 2차 조사 결과가 더 높은
  severity를 반환하면 finding에 그 값으로 갱신한다.
- 의심 대상 목록(`{node, signalType, severity, detail}`)을 `AiMonitorService`로 넘김.

### 4.2 `AiMonitorService` (Java)

- 의심 건마다 2차 조사 여부 판단:
  - 1차에서 HIGH/CRITICAL로 분류된 신호 → 사이드카 `/ai/scan` 호출(조치안 확보).
  - WARN 이하 → LLM 호출 없이 `AiFindingService`로 바로 알림용 finding 전달.
- aibot 불통/타임아웃 → 2차 조사 생략, 1차 요약만으로 finding 생성(HA 무영향). 로그 기록.

### 4.3 `AiFindingService` (Java)

- `upsert(finding)`: 부분 유니크 인덱스 기반 dedup. 신규면 알림 발행, 기존 OPEN이면
  `lastSeenAt` 갱신만.
- `severity >= HIGH`이고 2차 조사의 `proposedActions`가 있으면 `AiOperatorService`를 통해
  `AiProposal` PENDING 생성 후 `finding.proposalId` 연결(SP1 승인 흐름으로 합류).
- `reconcileResolved(scannedNodes, currentSignals)`: 이번 스캔에서 사라진 OPEN finding을
  `RESOLVED` 전이 + `FINDING_RESOLVED` 알림.

### 4.4 `AiFindingController` (Java)

- `GET /api/ai/findings` — status/cluster/node/severity 필터, OPEN 우선 정렬.
- 조회는 viewer+ 허용, 연결 제안의 승인/거부는 기존 SP1 RBAC(operator+) 그대로.

### 4.5 aibot 사이드카 — `POST /ai/scan` (신규)

기존 SP1 `nemesis_service.py`에 엔드포인트 추가, `run_investigation`의 읽기전용 그래프 재사용.

```jsonc
// 요청 — Nemesis가 의심 대상만 전달
{
  "context": {
    "clusterId": "...", "nodeId": "...", "hostname": "db2", "role": "active",
    "suspectSignals": [ { "signalType": "DISK_FULL", "detail": { "disk": 94 } } ],
    "recentEvents": [ ... ]
  },
  "sshTarget": { "host": "10.0.0.12", "port": 22, "user": "oraadm", "iface": "eth0" }
}
// 응답
{
  "findings": [
    {
      "signalType": "DISK_FULL", "severity": "HIGH",
      "summary": "/u01 94% — 아카이브 로그 누적",
      "diagnosis": "...", "rootCause": "...",
      "proposedActions": [
        { "description": "오래된 아카이브 정리", "command": "...", "target": "db2", "riskLevel": "MEDIUM" }
      ],
      "confidence": 0.8
    }
  ]
}
```
- `proposedActions`는 SP1 `/ai/execute` 계약과 동일 형태 → 승인 시 그대로 실행.
- `severity`가 HIGH 미만인 finding은 `proposedActions` 생략(알림만).
- 인증: SP1과 동일 공유 Bearer `NEMESIS_AIBOT_TOKEN`.

### 4.6 프론트엔드 (React)

- **헤더 `NotificationBell`** (기존 확장): `FINDING`/`FINDING_RESOLVED` 알림 표시.
- **대시보드 "열린 이슈"** 패널/탭: `GET /api/ai/findings`(OPEN)로 현재 이상 목록
  (노드·signalType·severity·summary·연결 제안 링크). 심각 finding의 제안은 인라인
  [승인][거부](기존 `isOperator` 게이트).

---

## 5. 데이터 흐름

### 흐름 1 — 정보성 이상 (WARN)
스케줄러 1차 필터 → MEM 91% 감지(WARN) → LLM 호출 없이 `AiFinding`(OPEN, WARN) upsert →
벨/채팅 정보성 알림. 다음 주기에도 지속이면 `lastSeenAt`만 갱신(재알림 X). 91→정상 복귀
시 RESOLVED + 복구 알림.

### 흐름 2 — 심각 이상 (HIGH/CRITICAL)
1차 필터 → 디스크 94%(HIGH) → 사이드카 `/ai/scan` 2차 조사(로그 까보고 진단·조치안) →
`AiFinding`(OPEN, HIGH) + `AiProposal` PENDING 생성·연결 → 벨/채팅 제안 카드 → 운영자
**승인** → SP1 `/ai/execute`(보여준 명령 그대로) → 결과 보고. 조치로 신호 해소되면 다음
스캔에서 finding RESOLVED.

### 상태 전이
```
(신규 탐지) ── INSERT ──▶ OPEN ── 신호 지속 ──▶ OPEN(lastSeen 갱신)
                           └── 신호 미검출 ──▶ RESOLVED (+복구 알림)
HIGH+ : OPEN 생성 시 AiProposal PENDING 연결 → (SP1 승인 상태머신)
```

---

## 6. 오류 처리 & 폴백

- **aibot 불통/타임아웃(2차 조사)** → 2차 생략, 1차 요약만으로 finding 생성. HA 무영향.
- **읽기전용 강제** → `/ai/scan` 그래프에 실행 도구 미바인드.
- **중복 방지** → (nodeId, signalType) OPEN 부분 유니크 인덱스 + upsert.
- **제안 합류** → 심각 finding의 조치는 SP1 `AiProposal` 상태머신·만료·멱등·감사를 그대로 따름.
- **점진 활성** → `monitor.enabled=false` 기본. 임계치/주기 전부 config.

---

## 7. 설정 & 의존성

```
nemesis.aiops.monitor.enabled                (기본 false)
nemesis.aiops.monitor.interval               (기본 PT5M)
nemesis.aiops.monitor.disk-threshold         (기본 90)
nemesis.aiops.monitor.mem-threshold          (기본 90)
nemesis.aiops.monitor.cpu-threshold          (기본 90)
nemesis.aiops.monitor.cpu-sustained-cycles   (기본 3)
nemesis.aiops.monitor.event-spike-window     (기본 PT10M)
nemesis.aiops.monitor.event-spike-count      (기본 5)
nemesis.aiops.monitor.critical-band-offset   (기본 5 — 임계+offset%p 이상이면 예비 HIGH)
```
- Flyway `V14__ai_findings.sql` 신규.
- aibot 사이드카 의존 변화 없음(SP1 `fastapi`/`paramiko` 재사용).

### ⚠️ 전제조건 (구현 착수 전 필수)

1. **SP1 aibot 사이드카 소스 복구** — `nemesis_service.py` / `nemesis_ops_tools.py` /
   `LangGraphAgent.run_investigation`이 현재 `/root/aibot` 디스크에 없음(2026-06-22
   `/root/aibot`이 SP1 이전 구버전으로 덮어써져 소실). 복구원: Claude file-history 세션
   `c0788ec5` @ 2026-06-21 08:06. SP3는 이 위에 `/ai/scan`을 더하므로 복구가 선행돼야 함.
2. **`/root/aibot` 버전관리(git) 적용** — 미적용이 이번 소실의 근본원인. 재발 방지.

---

## 8. 테스트 전략

- **Java 단위(JUnit/Mockito):**
  - 1차 필터: 임계치별 signalType 판정; CPU 연속 N회 지속 로직; 이벤트 급증 판정.
  - `AiFindingService`: dedup(OPEN 중복 미생성, lastSeen 갱신); 신호 해소 → RESOLVED +
    복구 알림; HIGH → AiProposal 생성·finding 연결.
  - 폴백: aibot 다운 시 2차 조사 생략·1차 알림 유지·HA 경로 불변.
  - `AiFindingController`: 조회 RBAC(viewer 200), 필터 동작.
- **aibot pytest:**
  - `/ai/scan`: 응답 스키마 검증; 읽기전용 그래프가 쓰기 도구를 갖지 않음 확인;
    WARN finding은 `proposedActions` 미포함.
- **e2e(docker 스택 + headless Chromium):**
  - 디스크 가득 모의 → 벨에 FINDING 등장 → HIGH면 PENDING 제안 → 승인 → SUCCEEDED →
    다음 스캔에서 finding RESOLVED 표시.

---

## 9. 후속

- **SP4** — 똑똑한 페일오버 판단: `AiDecisionService` 단발 LLM → aibot 다단 추론 교체.
