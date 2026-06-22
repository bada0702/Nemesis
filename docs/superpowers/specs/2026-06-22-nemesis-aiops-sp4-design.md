# Nemesis × aibot — SP4: 똑똑한 페일오버 판단 설계

- **작성일:** 2026-06-22
- **상태:** 승인됨 (브레인스토밍 → 스펙)
- **대상:** 단발 LLM 페일오버 판단(`AiDecisionService`)을 [Nemesis 독립 TCP 프로브 → (애매할 때만) aibot 다단 추론] 결정 파이프라인으로 교체
- **선행:** SP1(사이드카·승인 워크플로), SP3(능동 모니터링). 상위 설계: `2026-06-20-nemesis-aibot-aiops-design.md` §8

---

## 1. 배경 & 목표

현재 페일오버 판단은 `AiDecisionService.shouldFailover()`가 단발 LLM(`LlmService.decideFailover`)에
컨텍스트를 한 번 던져 FAILOVER_NOW/HOLD/SELF_HEAL_FIRST를 받는 구조다. 페일오버를 트리거하는
실질 신호는 **단 하나 — active "무응답(stale)"**(`HealthMonitorService`가 active→fault 전환 시
`NodeFaultEvent`를 1회 발행). 임계·프로세스다운은 알람만 남기고 페일오버를 트리거하지 않는다.

"무응답"은 사실 가장 애매한 신호다. active가 메트릭 보고를 멈췄을 때 그것이:
- 진짜 크래시(→ 페일오버 필요)
- **Nemesis↔active 네트워크 파티션인데 active는 클라이언트에 정상 서비스 중**(→ 페일오버하면 **스플릿브레인**)
- 에이전트만 죽고 서비스는 정상(→ 페일오버 불필요)
- 곧 복구될 일시적 blip

**목표:** 단발 LLM 판단을 교체해 *살아있는 active 위에 페일오버하지 않기(스플릿브레인 방지)*에
집중한 다단 결정 파이프라인을 만든다. 진짜 죽었을 땐 빠르게, 애매할 땐 신중하게.

### 확정된 핵심 결정 (브레인스토밍)

| # | 항목 | 결정 |
|---|---|---|
| Q1 | 다단 추론 역할 | **케이스 분기** — 확정 사망=즉시 자동 페일오버(추론 스킵), 애매한 degraded=aibot 다단 추론 게이트 |
| Q2 | 범위 | **기존 "무응답" 트리거만** 똑똑하게. 신규 트리거 도입 없음 |
| Q3 | 독립 검증 수단 | **Nemesis 결정론 TCP 프로브 + aibot 추론**(하이브리드, SSH 키 불필요) |
| Q4 | REACHABLE인데 판단 불가 시 | **HOLD(보류) + 운영자 경보** — 스플릿브레인 회피 우선 |
| Q5 | HOLD 이후 limbo 처리 | **자동 재평가 스케줄러**(held 노드 주기 재프로브, 진짜 죽으면 페일오버) |
| 포트 | 프로브 대상 | **서비스 포트 완전 자동연동** — 에이전트가 리스닝 포트 보고 → managed_services.port 자동 upsert(영속) + 호스트 포트 폴백 |

### 비목표 (SP4 밖)

- SELF_HEAL 자동 실행 / PENDING 제안(무응답 노드라 도달성·SSH 키 의존 재등장)
- 펜싱(fencing, 구 active 격리)
- `onAmbiguous` 클러스터별 설정값(SP4는 단일 안전기본값 HOLD)
- ops SSH 프로브 강화(SP4.5)
- 신규 페일오버 트리거(프로세스다운/임계 기반) — SP5 후보

---

## 2. 아키텍처 & 데이터 흐름

```
HealthMonitorService: active→fault 전환 (무응답)
        │ NodeFaultEvent (기존, 1회 발행)
        ▼
FailoverTriggerListener  ──(nemesis.aiops.failover.enabled?)──┐
        │ no                                                   │ yes
        ▼                                                      ▼
  기존 경로 그대로                                  FailoverDecisionService (신규 SP4)
  (AiDecisionService 또는 즉시)                            │
                                                  ① NodeReachabilityProbe (독립 TCP, ~1s)
                                                     host 포트 + 서비스 포트
                                                           │
                            ┌──────────────────────────────┴──────────────────────────────┐
                       !hostReachable + 건강한 standby                            host/serviceReachable
                            │ = 확정 사망                                          │ = 파티션 의심(애매)
                            ▼                                                      ▼
                     즉시 자동 페일오버                           ② aibot /ai/decide (다단추론, 데드라인 10s)
                     (FailoverOrchestrator)                            │ ctx=프로브결과+이벤트+메트릭추세
                                                          ┌───────────┴────────────┐
                                                      FAILOVER                  HOLD / (불통·타임아웃)
                                                          ▼                        ▼
                                                  자동 페일오버           ③ FailoverHold 등록(HELD)
                                                                          + AiFinding(FAILOVER_HELD) 경보
                                                                                │
                                                                                ▼
                                                          ④ FailoverHoldScheduler (20s 주기 재프로브)
                                                             !hostReachable 전환 → 자동 페일오버 (RESOLVED_FAILOVER)
                                                             에이전트 복귀         → 해제 (RESOLVED_RECOVERED)
        모든 분기: AiDecision 감사 기록
```

### 설계 원칙 (SP1과 일관)

1. **HA는 aibot/LLM에 무의존** — aibot 불통/타임아웃이어도 결정론이 판단을 끝낸다
   (!hostReachable→페일오버, reachable→HOLD). aibot은 "증강"이지 "의존"이 아니다.
2. **느린 경로는 보류 유력 상황에서만** — 진짜 죽었을 땐(!hostReachable) aibot 없이 빠르게 페일오버.
3. **held는 limbo가 아니다** — 재평가 스케줄러가 진짜 죽으면 결국 페일오버, 복귀하면 해제.
4. **읽기/쓰기 분리** — `/ai/decide`는 읽기 전용 추론 그래프(쓰기 도구 미바인드, SP1 원칙).

---

## 3. 컴포넌트 상세

신규 패키지 **`com.nemesis.domain.aiops.failover`** (SP3 `...aiops.monitor`와 형제).

| 컴포넌트 | 종류 | 책임 |
|---|---|---|
| `NodeReachabilityProbe` | @Component | 독립 TCP 프로브. `probe(Node)` → host 포트 + 서비스 포트에 짧은 타임아웃 TCP connect. `ProbeResult` 반환. SSH·키 불필요 |
| `ServicePortCapture` | @Component | 에이전트가 보고한 리스닝 포트를 등록된 `haManaged` 서비스에 매칭해 `managed_services.port` upsert(있을 때만, null 미덮어씀 → 중지 시 유지) |
| `ServicePortResolver` | @Component | 노드 클러스터의 `haManaged=true` 서비스 포트 수집(managed_services.port; 미확보 시 SERVICE 프로브 생략) |
| `FailoverDecisionService` | @Service | SP4 핵심 조율. `decide(clusterId,nodeId,reason)` → `Verdict`. 프로브→분기→(aibot)→AiDecision 기록 |
| `FailoverHold` + Repository | @Entity | 보류 노드 추적 (`failover_holds`, V16) |
| `FailoverHoldScheduler` | @Scheduled | HELD 건 재프로브 → 페일오버 또는 해제 (`reevalIntervalMs`, 기본 20s) |

### 기존 코드 연결점 (최소 변경)

- **`FailoverTriggerListener`** — `nemesis.aiops.failover.enabled`면 `AiDecisionService.shouldFailover()`
  대신 `FailoverDecisionService.decide()` 호출. 꺼져 있으면 현행 경로 그대로(하위호환·점진 활성).
  PROCEED 시 기존 `FailoverOrchestrator.failover(...)` + 비동기 ROOT_CAUSE 조사(SP1) 유지.
- **`AiOperatorClient`** — `decide(ctx, sshTarget)` 추가 → aibot `/ai/decide`. 실패 시 null
  (호출자가 Q4-A대로 HOLD 처리). decide 전용 읽기 타임아웃 = `decideDeadlineMs`.
- **HOLD 경보 = SP3 `AiFinding` 재사용** — `signalType=FAILOVER_HELD, severity=HIGH`,
  summary/diagnosis=aibot reasoning. 대시보드 "열린 이슈" + 헤더 벨에 그대로 노출. hold 해소 시 finding도 resolve.
- **`AiDecision` 재사용**(audit) — action=`FAILOVER|HOLD`, reason에 프로브결과 요약, provider/confidence/latency. 스키마 변경 없음.

### aibot 사이드카 (`nemesis_service.py`) 신규 `POST /ai/decide`

- 입력: `{context:{hostname, role, triggerReason, probeResult, recentEvents, metricsTrend}, sshTarget?}`
- **읽기 전용** 다단 추론 그래프(쓰기 도구 미바인드) → `{action:"FAILOVER|HOLD", confidence, reasoning}`
- Q3-C대로 SSH 불요(주어진 컨텍스트로 추론). ops 키 배포되면 SSH 프로브로 강화 가능(SP4.5).

---

## 4. 데이터 모델 & 계약

### 4.1 ProbeResult — 호스트/서비스 도달성 분리

```java
record ProbeResult(boolean hostReachable, boolean serviceReachable, List<PortProbe> details) {}
record PortProbe(int port, String kind /* HOST | SERVICE */, boolean open, long latencyMs) {}
```

- `serviceReachable=true` → active가 *실제 서비스 중* → 가장 강한 HOLD 신호(스플릿브레인 직격)
- `hostReachable && !serviceReachable` → 호스트는 살아있고 서비스만 죽음 → 애매(aibot 판단)
- `!hostReachable` → 확정 사망 → 즉시 페일오버

### 4.2 서비스 포트 완전 자동연동 — Flyway V17

```sql
ALTER TABLE managed_services ADD COLUMN port INT;   -- nullable, 영속
```

**기존 자산(이미 구현됨, SP4 변경 없음):** 서비스 카탈로그는 이미 **영속 레지스트리**다 —
등록된 `ManagedService`는 프로세스가 중지돼도 레코드가 남고(`STOPPED` 표시), 관리페이지에서
**시작/중지/재시작**(`ServiceCatalog.jsx` svc-start/stop/restart → 에이전트 control.sh)과
**삭제 버튼**(`DELETE .../services/{id}`)이 동작한다. SP4는 여기에 *포트*만 더한다.

**포트 라이프사이클 (사용자 요구 반영):**
- 포트는 `managed_services.port`에 **영속 저장** → 서비스가 중지돼도 포트 유지(probe·관리에 계속 사용)
- 실행 중 관측 시 포트 **자동 캡처(upsert)**, 재기동 시 재확인. 중지돼도 **삭제하지 않음**
- 서비스 제거는 오직 **수동 삭제 버튼**으로만 (자동 삭제 절대 없음)

**자동 캡처 경로 (완전 자동, 에이전트 확장):**
1. **에이전트** — 프로세스 보고에 리스닝 포트 추가. `ss -ltnp`(폴백 `netstat -ltnp`)로
   pid→리스닝 포트 맵을 만들어 각 프로세스에 `port`(주 리스닝 포트) 부착.
2. **메트릭 DTO** — `MetricsPushRequest`의 process 항목에 `port` 필드 추가.
3. **포트 캡처(write 경로)** — 등록된 `haManaged` 서비스의 프로세스가 노드에서 관측되고 포트가
   있으면 `ManagedService.port`에 upsert(있을 때만 갱신, null로 덮어쓰지 않음 → 중지 시 유지).
   메트릭 인입 또는 카탈로그 리프레시 시점의 경량 매칭(`ServicePortCapture`).
4. **`ServicePortResolver`** — 노드 클러스터의 `haManaged` 서비스 `port` 수집 → SERVICE 프로브.
   포트 미확보 서비스는 SERVICE 프로브 생략(보수적). 설정 `probePorts`(기본 `[22]`)는 HOST 프로브.
- 카탈로그 UI: 포트 표시 + 수동 보정 입력 1칸(자동값 오버라이드 가능, 작음).

### 4.3 failover_holds — Flyway V16

```sql
CREATE TABLE failover_holds (
  id UUID PRIMARY KEY,
  cluster_group_id UUID,
  node_id UUID NOT NULL,
  reason TEXT,
  probe_result TEXT,                          -- JSON 스냅샷
  status VARCHAR(24) NOT NULL,                -- HELD | RESOLVED_FAILOVER | RESOLVED_RECOVERED
  finding_id UUID,                            -- 연결된 AiFinding(FAILOVER_HELD)
  last_probed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_failover_holds_node_held ON failover_holds (node_id) WHERE status = 'HELD';
```

### 4.4 aibot `/ai/decide` 계약

```jsonc
// 요청
{ "context": {
    "hostname":"db2", "role":"active", "triggerReason":"무응답 (마지막 보고 8초 전)",
    "probeResult": { "hostReachable":true, "serviceReachable":true, "details":[...] },
    "recentEvents":[ ... ], "metricsTrend":{ "cpu":[..], "mem":[..] } },
  "sshTarget": null }
// 응답
{ "action":"HOLD",                              // FAILOVER | HOLD
  "confidence":0.88,
  "reasoning":"서비스 포트 1521 도달 → active 서비스 지속 중, Nemesis↔노드 관리망 단절로 판단. 페일오버 시 스플릿브레인 위험." }
```

### 4.5 Java 측 계약

```java
// AiOperatorClient (확장)
DecideResponse decide(Map<String,Object> ctx, Map<String,Object> sshTarget); // 실패 시 null
record DecideResponse(String action, double confidence, String reasoning) {}

// FailoverDecisionService
record Verdict(boolean proceed, boolean held, String reason) {}
```

### 4.6 판단 로직 (FailoverDecisionService.decide)

```
probe = reachabilityProbe.probe(node)
if (!probe.hostReachable && hasFailoverTarget(node))   → PROCEED        // 확정 사망
else if (!hasFailoverTarget(node))                     → no-op + 경보   // 페일오버 대상 없음(현행 가드)
else:
   d = client.decide(ctx)                              // aibot (데드라인)
   if (d == null)                                      → HOLD           // Q4-A: 판단불가→보류
   else if (d.action == FAILOVER)                      → PROCEED
   else                                                → HOLD
HOLD이면: FailoverHold(HELD) 등록 + AiFinding(FAILOVER_HELD) 경보
모든 분기: AiDecision 기록
```

### 4.7 설정 `nemesis.aiops.failover.*` (AiOperatorProperties 확장)

| 키 | 기본 | 의미 |
|---|---|---|
| `enabled` | `false` | SP4 경로 활성(opt-in) |
| `probePorts` | `[22]` | HOST 도달성 TCP 프로브 포트 |
| `probeTimeoutMs` | `1000` | 프로브 connect 타임아웃 |
| `decideDeadlineMs` | `10000` | aibot `/ai/decide` 읽기 타임아웃(데드라인) |
| `reevalIntervalMs` | `20000` | held 재평가 스케줄러 주기 |

---

## 5. 오류처리 & 폴백 (HA는 aibot/LLM에 무의존)

| 상황 | 처리 |
|---|---|
| aibot 불통/데드라인 초과 (reachable 경로) | **HOLD** + 경보 (Q4-A). 결정론이 판단을 끝냄 → HA 보존 |
| aibot 불통 (!hostReachable 경로) | aibot 호출 안 함 → 즉시 자동 페일오버 |
| TCP connect **timeout** | host UNREACHABLE (호스트 다운) |
| TCP connection **refused** | host/port는 UP, 해당 포트만 닫힘(서비스 다운 신호) |
| 프로브 내부 예외(호스트 해석 실패 등) | indeterminate → aibot 경로, aibot도 불통이면 HOLD (스플릿브레인 회피 우선) |
| `failover.enabled=false` | SP4 경로 전체 off, 현행 동작 그대로 |
| 중복 HOLD | `failover_holds` 노드당 HELD 1건 유니크 인덱스 |
| 스케줄러 페일오버 트리거 | 노드가 여전히 fault인지 재확인(멱등) |
| held 노드 복귀 | HealthMonitorService NODE_RECOVERED → 스케줄러가 RESOLVED_RECOVERED + finding 해소 |

---

## 6. 테스트 전략 (TDD)

### Java 단위 (JUnit/Mockito)

- `NodeReachabilityProbeTest` — 로컬 ServerSocket open→REACHABLE / 닫힌 포트→UNREACHABLE / timeout; host·service 분리
- `ServicePortCaptureTest` — 관측된 포트 upsert; 중지(포트 미보고) 시 기존 포트 유지(null 미덮어씀); haManaged 아닌 서비스 무시
- `ServicePortResolverTest` — haManaged 서비스 포트 수집, 미확보 시 SERVICE 프로브 생략
- 에이전트(pytest 또는 스크립트 테스트) — `ss -ltnp` 파싱으로 pid→포트 맵, 프로세스에 port 부착(폴백 netstat)
- `FailoverDecisionServiceTest`:
  - `!hostReachable + target` → PROCEED (aibot 호출 없음)
  - `serviceReachable` → aibot 호출 → FAILOVER=PROCEED / HOLD=held+finding / null=held (Q4-A)
  - 각 분기 AiDecision 기록
  - 페일오버 대상 없으면 PROCEED 안 함(현행 가드)
- `FailoverHoldSchedulerTest` — HELD 재프로브 UNREACHABLE→페일오버+RESOLVED_FAILOVER / 복귀→RESOLVED_RECOVERED / REACHABLE→HELD 유지
- `AiOperatorClientDecideTest` — `/ai/decide` POST·파싱, 실패→null
- `FailoverTriggerListenerTest`(수정) — `failover.enabled`면 FailoverDecisionService 호출, 아니면 기존 경로

### aibot pytest

- `/ai/decide`: 응답 스키마 검증; 읽기전용 그래프가 쓰기 도구를 갖지 않음 확인; serviceReachable→HOLD / 전부 죽음→FAILOVER

### e2e (docker 스택 + headless Chromium)

- 무응답 + 서비스 포트 열림(mock) → HOLD → `FAILOVER_HELD` 열린이슈+벨, 노드 페일오버 안 됨
- 완전 사망 → 빠른 자동 페일오버
- held 노드가 unreachable 전환 → 스케줄러가 페일오버

---

## 7. 의존성 & 전제

- Flyway: **V16** `failover_holds`, **V17** `managed_services.port`.
- **에이전트 확장 + 재배포** — 리스닝 포트 보고(`ss -ltnp`/`netstat` 폴백). `MetricsPushRequest` process에 `port` 추가. ⚠️ 에이전트 노드 재배포 동반(로컬개발 함정 주의).
- 서비스 카탈로그 영속 레지스트리·시작/중지/재시작·삭제는 **이미 구현됨** — SP4는 포트만 추가.
- aibot 사이드카에 `/ai/decide` 엔드포인트 추가(읽기전용 추론 그래프). 사이드카는 systemd `nemesis-sidecar.service`로 관리(SP1).
- `nemesis.aiops.failover.*` 설정 추가, 기본 `enabled=false` → 점진 활성.
- 프로브는 SSH 불요(Q3-C). ops SSH 키 배포는 SP4.5(SSH 프로브 강화)의 전제.
- 프론트: 신규 거의 없음(HOLD 경보는 SP3 "열린 이슈"/벨 재사용). 서비스 카탈로그 포트 입력 1칸 추가.
