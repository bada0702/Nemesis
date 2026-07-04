# HA 프로세스 다운 자동 페일오버 + 자동 페일백 설계

**날짜:** 2026-07-04
**배경:** AIOps 수순 검증(감시→즉시 페일오버→조치→페일백)에서 확인된 갭 2개.
사용자 요구 수순 = "등록된 프로세스·로그 실시간 감시 → 장애 시 바로 페일오버 → 장애 조치 → 페일백".

## 갭

1. **프로세스 다운 → 페일오버 미트리거.** `HealthMonitorService.checkProcessDown`은
   사라진 프로세스에 WARNING 이벤트만 남긴다. active 노드의 핵심 서비스(DB 등)가 죽어도
   노드 하트비트가 살아 있으면 페일오버가 일어나지 않는다.
2. **자동 페일백 미구현.** 장애 노드는 복구되면 standby로 되돌아올 뿐(HealthMonitorService),
   원래 역할로 자동 환원하는 코드가 없다. 수동 전환으로만 가능.

## 설계 원칙

- 기존 트리거 일원화(B-3) 유지: 페일오버 실행은 **반드시 `FailoverOrchestrator`를 통해서만**.
  기존 가드(핑퐁·최대횟수·대상 생존)를 그대로 상속받는다.
- "등록된 프로세스"의 정의 = **`ManagedService`(서비스 카탈로그) 중 `haManaged=true`인 것**.
  임의 프로세스 소실(기존 PROCESS_DOWN WARNING)은 페일오버 사유가 아니다 — 운영자가
  HA 대상으로 명시한 서비스만 트리거한다(오탐 방지, 기존 opt-in 모델 재사용).
- 프로세스 매칭은 `ServiceCatalogService.instanceState`와 동일 규칙
  (프로세스명 lowercase `contains(패턴)`).

## Feature A: HA 서비스 프로세스 다운 자동 페일오버

**위치:** `HealthMonitorService` (감지 엔진, 1초 주기 스캔의 신선 메트릭 경로)

**판정 (active 노드에만 적용):**
1. `processes`가 보고된 신선한 메트릭에서, 클러스터의 `haManaged` 서비스 패턴이
   하나도 매칭되지 않으면 "소실 시작 시각"을 기록한다.
2. 소실이 `processFailoverGraceSeconds`(기본 10초) 이상 지속되면 인시던트당 1회:
   - **가드:** 같은 클러스터에 [role=standby + 신선한 메트릭 + 해당 서비스 프로세스 실행 중]인
     노드가 없으면 → CRITICAL 이벤트만 기록하고 페일오버 보류(승격해도 서비스가 없어
     핑퐁만 유발).
   - 가드 통과 시: `PROCESS_DOWN` CRITICAL 이벤트 기록 + `NodeFaultEvent` 발행.
     이후는 기존 경로 그대로: `FailoverTriggerListener` → (AI enabled면 HOLD 게이트) →
     `FailoverOrchestrator.failover(trigger=DETECTION)`.
3. 프로세스가 다시 보이면 소실 상태·발화 플래그를 초기화한다(재다운 시 유예부터 다시).

**페일오버 후 노드 상태:** orchestrator가 from을 fault로 강등하지만, 에이전트가 살아
있으므로 다음 스캔에서 기존 복구 로직이 fault→standby로 되돌린다(의도된 동작).

**설정 (`DetectionProperties`, `nemesis.detection.*`):**
- `process-failover-enabled` (기본 true)
- `process-failover-grace-seconds` (기본 10)

**한계(문서화):** 승격 대상 자동 선택(pickStandby)은 "서비스 실행 중인 standby"를
우선하지 않는다(신선 메트릭 우선). 2노드 클러스터에서는 사전 가드와 동일 노드라 무관.

## Feature B: 자동 페일백

**위치:** 신규 `FailbackService` (`domain/failover`), `@Scheduled` 15초 주기.

**페일백 대상 결정(스키마 변경 없음):** 클러스터의 **가장 최근 SUCCESS 페일오버 이력**이
기준이다.
- trigger가 `DETECTION`/`AI`(자동)일 때만 페일백 후보 = 그 이력의 `fromNodeId`(강등된 원 노드).
- `MANUAL`은 운영자 의도이므로 자동 페일백 안 함. `FAILBACK` 성공 후에는 최신 이력이
  FAILBACK이 되므로 루프가 자연 종료된다.

**발화 조건(모두 충족, 안정화 시계 방식):**
1. 후보 노드가 존재하고 role=standby, 메트릭 신선.
2. 클러스터에 `haManaged` 서비스가 등록돼 있으면 후보 노드에서 **전부 실행 중**
   (미기동 상태로 승격하면 Feature A가 즉시 되돌려 핑퐁 — 사용자 수순의 "장애 조치 후"
   페일백을 이 조건이 담보한다: 조치가 끝나 서비스가 다시 떠야만 페일백).
3. 위 조건이 `stabilizationSeconds`(기본 120초) 동안 연속 유지(끊기면 시계 리셋).
4. 핑퐁 가드 윈도(`cluster.pingpongGuardSeconds`) 경과 후에만 시도(SKIPPED 이력 스팸 방지).

**실행:** `orchestrator.failover(clusterId, from=null(현 active 자동), to=후보,
trigger=FAILBACK, reason="자동 페일백: …")`. 신규 enum `FailoverHistory.Trigger.FAILBACK`
(EnumType.STRING, varchar(20)에 안전. 프론트는 trigger 라벨 매핑이 없어 원문 표시 — 무해).
시도 후에는 결과와 무관하게 안정화 시계를 리셋(실패 시 재시도 간격 확보).
AI HOLD 게이트는 거치지 않는다(결정적 정책, 조건 자체가 보수적).

**설정 (신규 `FailbackProperties`, `nemesis.failback.*`):**
- `enabled` (기본 true, `@ConditionalOnProperty` matchIfMissing=true)
- `stabilization-seconds` (기본 120)
- 체크 주기: `nemesis.failback.check-interval-ms` (기본 15000, @Scheduled placeholder)

## 변경 파일

| 파일 | 변경 |
|---|---|
| `detection/DetectionProperties.java` | 프로세스 페일오버 설정 2개 추가 |
| `detection/HealthMonitorService.java` | `ManagedServiceRepository` 주입 + HA 프로세스 감시/트리거 |
| `domain/catalog/ManagedServiceRepository.java` | `findByClusterIdAndHaManagedTrue` 추가 |
| `domain/failover/FailoverHistory.java` | Trigger enum에 `FAILBACK` 추가 |
| `domain/failover/FailoverHistoryRepository.java` | `findFirstByClusterGroupIdAndStatusOrderByCreatedAtDesc` 추가 |
| `domain/failover/FailbackProperties.java` | 신규 |
| `domain/failover/FailbackService.java` | 신규 |
| 테스트 | `HealthMonitorServiceTest` 확장(생성자 변경 반영), `FailbackServiceTest` 신규 |

## 테스트 계획 (기존 Mockito 단위 테스트 컨벤션)

**HealthMonitorServiceTest 추가:**
- active의 HA 서비스 프로세스가 유예 경과까지 없으면 CRITICAL + NodeFaultEvent 발행 (grace=0)
- 유예 미경과면 발행 안 함 (grace=10, 1회 스캔)
- 서비스 실행 중인 standby가 없으면 CRITICAL만 기록, 발행 안 함
- standby 노드의 프로세스 다운은 발행 안 함
- 프로세스 복귀 후 재다운 시 다시 유예부터 (인시던트당 1회 발화)
- haManaged 서비스 미등록이면 아무 것도 안 함

**FailbackServiceTest 신규:**
- 최신 SUCCESS가 DETECTION + 후보 standby·신선·서비스 실행·안정화 0초 → FAILBACK 트리거로 orchestrator 호출
- MANUAL / FAILBACK 이력이면 호출 안 함
- 안정화 미경과(120초, 1 tick) → 호출 안 함
- 후보 role=fault → 호출 안 함 + 시계 리셋
- haManaged 서비스 미기동 → 호출 안 함
- 핑퐁 가드 윈도 내 → 호출 안 함(시계는 유지)

## 검증/배포

- 단위 테스트: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '...'`
- 배포: backend 이미지 재빌드 → 컨테이너 재생성(compose recreate 버그 우회 절차) → 스케줄러 로그 확인.
- **실 페일오버 발사는 하지 않는다**(콜로케이션 호스트에서 VIP 제거 위험 — 기존 caveat).
