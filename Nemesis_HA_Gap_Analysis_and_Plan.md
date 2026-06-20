# Nemesis — 소스 분석 & HA/AI 장애대응 개선 플랜

> 작성일: 2026-06-11
> 대상: 백엔드(Spring Boot), 프론트엔드(React), 에이전트(Python/Shell), Mock API
> 목적: ① 현재 소스의 문제점·중복·미작동 기능 정리 ② AI가 장애를 **빨리 감지**하고, HA **페일오버를 정확히 수행**하며, **장애를 자동 복구**하도록 만드는 실행 플랜 수립

---

## 1. 한눈에 보는 결론

현재 코드는 **"대시보드 목업 + 일부 실 API"** 상태다. 화면은 그려지지만, PRD가 약속한 핵심 HA 기능(자동 장애감지 → 자동 페일오버 → 자동 복구)은 **실제로 동작하는 코드가 없다.**

| 영역 | PRD 약속 | 현재 구현 | 상태 |
|---|---|---|---|
| 장애 감지 | 하트비트 3초, 자동 Fault 판정 | **판정 로직 없음** (스케줄러 0개) | ❌ 미작동 |
| 페일오버 | AI/자동/하트비트 트리거 | **수동(manualFailover)만** 존재 | ❌ 미작동 |
| VIP 이동 | Failover 시 VIP 인수 | DB role만 변경, **VIP 명령 없음** | ❌ 미작동 |
| Self-Healing | DB/WAS/Web 복구 스크립트 | **healing/*.sh 파일 없음** | ❌ 미작동 |
| 노드 간 하트비트 | TCP 17000 직접 통신 | 에이전트에 **소켓 코드 없음** | ❌ 미작동 |
| 에이전트 명령 실행 | 17001 control.sh | 에이전트에 **명령 수신 서버 없음** | ❌ 미작동 |
| AI 분석 | LLM Provider 3종 전환 | **Ollama만**, 페일오버와 미연동 | ⚠️ 부분 |
| 대시보드 다수 페이지 | 실 데이터 | **Mock API에만** 존재 | ⚠️ 목업 |

---

## 2. 문제점 상세 (Critical → Minor)

### 🔴 C-1. 장애 감지 로직이 아예 없다
- `@EnableScheduling`은 켜져 있으나(`NemesisServerApplication.java:9`) **`@Scheduled` 메서드가 코드 전체에 0개**다.
- 노드 생존 판정 기준인 `last_seen_at`은 메트릭 Push 시 갱신만 될 뿐, **이를 검사해 Fault로 바꾸는 주체가 없다.**
- 결과: 에이전트가 죽어도 노드는 영원히 정상으로 표시된다. → **"빨리 감지"의 출발점 자체가 없음.**

### 🔴 C-2. 노드 "상태"가 가짜다 (캐시 존재 여부로 판정)
- `ClusterAgentController.java:40` — `state = (metricsCache에 값 있으면 RUNNING, 없으면 STOPPED)`.
- `MetricsCacheService`는 **TTL/만료가 없는 ConcurrentHashMap**이고 `remove()`는 어디서도 호출되지 않는다.
- 즉 한 번 Push된 노드는 에이전트가 죽어도 캐시에 남아 **계속 RUNNING**으로 보인다. 실제 liveness와 무관.

### 🔴 C-3. 자동 페일오버가 없다
- `FailoverService.manualFailover()`만 존재. body로 `fromNodeId/toNodeId`를 받아 **DB의 role 컬럼만 swap**한다.
- VIP 이동, GPFS 마운트, 서비스 기동/종료 등 **실제 인수 동작이 전혀 없다.** role만 바뀌고 트래픽은 그대로 죽은 노드로 간다.
- `pingpong_guard_seconds`, `heartbeat_fail_threshold`, `max_failover_count` 컬럼은 스키마에만 있고 **코드에서 한 번도 읽지 않는다.**

### 🔴 C-4. AI가 페일오버를 결정하지 못한다 (분리된 두 기능)
- AI 경로(`MetricsPushController:31` → `AiFaultService.analyzeAsync`)는 **에러 로그 텍스트 분석 후 DB에 글자만 저장**한다.
- `analyzeCluster()`는 `Map.of("analysis", 텍스트, "severity", ...)`만 반환 — **failover를 호출하지 않는다.**
- 즉 "AI Failover"는 이름만 있고, AI 판단 → 페일오버 실행으로 이어지는 연결 고리가 없다.

### 🔴 C-5. 에이전트가 명령을 받을 수 없다
- `AgentCommandController:40`는 `http://{serviceIp}:17001/api/command`로 POST를 보낸다.
- 그러나 `nemesis-agent.py`는 **Push 전용 루프**이고, 17001 포트로 **명령을 수신하는 HTTP 서버가 없다.**
- 따라서 Self-Healing/VIP 이동 명령은 전송돼도 **받는 쪽이 없어 항상 502**다.

### 🔴 C-6. Self-Healing / control 스크립트가 없다
- PRD·plan.md는 `control.sh`, `healing/heal_oracle.sh`, `heal_tomcat.sh`, `heal_nginx.sh`를 명시하나 `agent/` 폴더에는 `collect.sh`, `collect_aix.sh`, `install.sh`만 존재.
- 복구 자동화의 **실행 단위가 비어 있다.**

### 🔴 C-7. 노드 간 직접 하트비트(17000)가 없다
- PRD의 Split-Brain 방지 핵심(관리 서버 장애 시 노드끼리 17000으로 생존 확인)이 **에이전트에 구현돼 있지 않다.** 소켓 코드 자체가 없다.
- 관리 서버 단일 장애점(SPOF)이 그대로 남는다.

### 🟠 H-1. 프론트엔드 ↔ 백엔드 역할(role) 값 불일치
- 프론트는 `role === 'PRIMARY'`로 판정(`ClusterDetail.jsx:19,283`, `NodeStatus.jsx:10`).
- 백엔드 `Node.Role` enum은 `active/standby/fault/recovering` (소문자).
- Mock API는 `PRIMARY/STANDBY/FAULT`를 돌려주므로 **목업에선 동작, 실 백엔드 연결 시 화면이 깨진다.** (Primary 노드를 못 찾음)
- `state`도 Mock은 `RUNNING/STOPPED`, 백엔드는 동일 문자열을 캐시 유무로 생성 — 정의가 제각각.

### 🟠 H-2. 다수 페이지가 Mock에만 존재하는 API에 의존
- `client.js`에 선언됐지만 **백엔드 컨트롤러가 없는** 엔드포인트:
  `/db`, `/docker/containers`, `/docker/images`, `/inspection`, `/reports`,
  `/alerts/config`, `/settings/system`, `/ha/sequences/{id}`, `/ha/heartbeat/{id}`,
  `/ha/metadata-sync/{id}`, `/services`, `/clusters/{id}/apps/failover`, `/clusters/{id}/apps/control`.
- 백엔드 구현 존재: clusters, nodes, dashboard(summary/performance/sw-status/docker/alerts), runbook, sw(scan/register/list), ai, failover, agent.
- → DB/Docker/점검/리포트/알림설정/시스템설정/HA시퀀스·동기화·하트비트/서비스 페이지는 **실 백엔드에서 빈 화면 또는 에러.**

### 🟠 H-3. AI Provider 전환이 구현 안 됨
- PRD/.env는 `LLM_PROVIDER = openai | anthropic | ollama` 전환을 약속하나, 코드에는 `OllamaService` **하나뿐**이고 Provider 추상화/분기가 없다.
- `application.yml`의 기본 모델 `gemma4:12b`는 **존재하지 않는 모델명**(오타로 추정, gemma2 계열). 온프레미스 미설치 시 모든 분석이 catch로 떨어져 "분석 실패" 문자열만 남는다.

### 🟠 H-4. 인증/RBAC 부재
- 메트릭 Push만 Bearer 검사. **대시보드·클러스터·페일오버·에이전트 명령 API는 인증이 전혀 없다.**
- `WebConfig`의 CORS `allowedOrigins("*")` + 인증 없음 = 누구나 `POST /api/clusters/{id}/failover` 호출 가능.
- PRD가 요구한 3단계 RBAC(admin/operator/viewer), `users` 테이블이 코드/스키마에 없다.

### 🟡 M-1. 중복·죽은 코드
- **미사용 React 컴포넌트**(어디서도 import 안 됨): `AiJudgmentPanel`, `CentralStatus`, `ClusterStatusPanel`, `PerformancePanel`, `SummaryCard`, `TimelineChart`. → 혼란 유발, 삭제 대상.
- AI 분석 진입점이 **두 갈래**(`/api/ai/analyze/{nodeId}` 노드 단위 vs `/api/clusters/{id}/ai-analysis` 클러스터 단위)인데 결과 포맷·저장 방식이 달라 일관성이 없다.
- `getDockerStatus()`는 모든 노드를 `status:"N/A", 0/0`으로 **하드코딩** 반환 — 사실상 미구현.

### 🟡 M-2. `@Transactional` private 메서드 무효
- `AiFaultService.doAnalyze()`가 `private @Transactional` (`AiFaultService.java:84`). Spring AOP 프록시는 **private 메서드에 트랜잭션을 적용하지 못한다.** 어노테이션이 조용히 무시됨.

### 🟡 M-3. 에이전트 Pull이 메타데이터 동기화가 아님
- `nemesis-agent.py:104` Pull은 `/api/clusters` GET을 호출하고 **결과를 버린다.** PRD의 "메타데이터 받아 로컬 캐시 갱신"이 아니라 단순 ping. `metadata.json`은 등록 시 1회만 기록되고 이후 갱신되지 않는다.

---

## 3. 핵심 격차 요약: "빠른 감지 → 정확한 페일오버 → 자동 복구"가 끊겨 있다

```
[현재]
에이전트 Push(3s) ──→ 캐시 저장 ──→ 대시보드 표시
                          └─(에러로그 있을때만)→ AI 텍스트 분석 → DB 저장(끝)

   ✗ 생존 판정 없음   ✗ 자동 페일오버 없음   ✗ VIP/복구 실행 없음   ✗ 노드간 하트비트 없음

[목표]
감지(Detector) → 판단(Rule+AI) → 결정(Failover Decision) → 실행(VIP/GPFS/서비스) → 복구(Healing) → 검증
```

---

## 4. 개선 플랜

설계 원칙: **Rule 기반으로 빠르고 결정적으로 감지/페일오버하고, AI는 "원인 분석·복구안 추천·오탐 억제"의 보조 판단으로 둔다.** (LLM 응답이 늦거나 실패해도 HA는 독립 동작해야 함 — C-4/H-3 대응)

### Phase A — 장애 감지 엔진 (가장 시급, C-1·C-2)

**A-1. 하트비트/Liveness 스케줄러 신설**
- `HealthMonitorService`에 `@Scheduled(fixedRate=1000)` 추가.
- 각 노드 `last_seen_at`을 검사: `now - lastSeen > heartbeat_fail_threshold × pushInterval` 이면 **연속 미응답 카운트 증가**, 임계(기본 3회) 도달 시 `role = fault` 전이 + `events` 적재.
- 메트릭 캐시에 **수신 시각**을 함께 저장하고, liveness는 캐시 존재가 아니라 **신선도(staleness)** 로 판정 → C-2 해결.

**A-2. 메트릭 캐시 TTL/타임스탬프 도입**
- `MetricsCacheService`를 `{metrics, receivedAt}` 래핑으로 변경, `getFresh(nodeId, maxAgeMs)` 제공.
- 노드 삭제·장애 시 `remove()` 호출 경로 연결.

**A-3. 임계 기반 즉시 이벤트화**
- CPU/Mem/Disk 임계 초과, 프로세스 다운(`processes`에서 기대 서비스 누락)을 감지 즉시 `events`+`alarms` 생성. (지금은 대시보드 조회 시점에만 계산 → 상시 감지로 전환)

> 효과: **장애 발생 3~4초 내 Fault 판정** 확보. 이게 "빨리 감지"의 토대.

### Phase B — 자동 페일오버 (C-3)

**B-1. FailoverOrchestrator 신설**
- 입력: 감지 이벤트(Fault 전이) 또는 수동/AI 트리거.
- 가드: `pingpong_guard_seconds`(최근 페일오버 후 유예), `max_failover_count`(횟수 제한), 대상 Standby 생존 확인. → 스키마에만 있던 컬럼들을 **실제 사용.**
- 상태 머신: `active→fault`, 선택된 `standby→recovering→active`. 결과를 `failover_history`에 기록.

**B-2. 실제 인수 동작 연결**
- VIP 이동·GPFS 마운트·서비스 기동을 **에이전트 명령으로 실행**(Phase D와 연동). DB role swap은 마지막 커밋 단계로.
- 실패 시 롤백/재시도 정책.

**B-3. 트리거 일원화**
- 수동/AI/하트비트 3개 트리거가 모두 Orchestrator 한 곳을 호출하도록 통합(M-1의 두 갈래 정리).

### Phase C — AI 판단 연동 (C-4·H-3)

**C-1. LLMProvider 추상화**
- `LLMProvider` 인터페이스 + `OllamaProvider`/`OpenAiProvider`/`AnthropicProvider` 구현, `LLM_PROVIDER`로 분기. 기본 모델명 오타(`gemma4:12b`) 수정.
- **타임아웃·서킷브레이커**: LLM 무응답 시 Rule 결정으로 즉시 폴백(HA가 LLM에 묶이지 않게).

**C-2. AI를 "결정 보조"로 배치**
- 감지 후 Orchestrator가 AI에 `{메트릭, 에러로그, 이력}`을 주고 **`failover_now / hold / self_heal_first` + confidence**를 받는다.
- `confidence ≥ 임계` & `severity=critical`이면 즉시 페일오버, 애매하면 핑퐁 가드만큼 hold → **오탐(False Failover) 억제**.
- 모든 판단을 `ai_decisions`(latency 포함)에 적재 → 성공지표 측정 가능.

### Phase D — 에이전트 명령 채널 & Self-Healing (C-5·C-6·C-7)

**D-1. 에이전트 명령 수신 서버**
- `nemesis-agent.py`에 17001 경량 HTTP(또는 동일 TLS) 핸들러 추가: `POST /api/command` 수신 → 화이트리스트 명령만 실행 → `{stdout,stderr,exitCode}` 반환. → C-5 해결, `AgentCommandController`가 비로소 동작.

**D-2. control.sh / healing 스크립트 작성**
- `control.sh`: `vip-up/vip-down`, `gpfs-mount/umount`, `svc-start/stop`(서비스명 인자).
- `healing/heal_oracle.sh|heal_tomcat.sh|heal_nginx.sh`: 레이어별 진단→재기동→검증, 멱등 보장, 종료코드 규약.
- Self-Healing 모드(`auto/semi/manual`) 정책 반영: semi는 승인 대기.

**D-3. 노드 간 직접 하트비트(17000)**
- 에이전트에 peer 하트비트 송수신 스레드 추가. 관리 서버 단절 시 `metadata.json` 기준 **자율 페일오버**(3회 무응답 → VIP 인수) → C-7/SPOF 해소.

**D-4. Pull을 실 메타데이터 동기화로 교체**
- `/api/clusters` ping → **`/api/agent/metadata` 수신 후 `metadata.json` 원자적 갱신**(checksum 비교)으로 변경 → M-3 해결.

### Phase E — 데이터/계약 정합 & 정리 (H-1·H-2·H-4·M-1·M-2)

- **E-1. role/state 계약 통일**: 백엔드 enum과 프론트 상수를 한 값으로 맞춤(권장: 백엔드 `active/standby/fault`를 유지하고 프론트·Mock을 거기에 맞춤, 또는 DTO에서 매핑). 단일 소스로 문서화. → H-1
- **E-2. 누락 컨트롤러 구현 또는 명시적 비활성**: DB/Docker/Inspection/Reports/Alerts·System 설정/HA(sequences·heartbeat·metadata-sync)/Services를 실 구현하거나, 미구현 페이지는 UI에서 "준비중" 처리해 빈 화면/에러 방지. → H-2
- **E-3. 인증·RBAC 도입**: `users`/`user_group_perms` 테이블 + 로그인, 제어 API(failover/execute/settings)에 인증·역할 검사. CORS origin 화이트리스트로 축소. → H-4
- **E-4. 죽은 코드 제거**: 미사용 컴포넌트 6종 삭제, AI 진입점 이원화 통합, `getDockerStatus` 실제 구현 또는 명시적 미지원. → M-1
- **E-5. 트랜잭션 버그 수정**: `doAnalyze`를 public/별도 빈으로 분리해 `@Transactional` 유효화. → M-2

---

## 5. 우선순위 & 권장 순서

| 순위 | 작업 | 이유 | 의존 |
|---|---|---|---|
| 1 | **Phase A** 감지 엔진 | 모든 자동화의 출발점. 없으면 나머지 의미 없음 | - |
| 2 | **Phase D-1/D-2** 명령채널+control.sh | 페일오버·복구의 "실행 손발" | - |
| 3 | **Phase B** 자동 페일오버 | 감지+실행을 묶어 핵심 가치 완성 | A, D |
| 4 | **Phase E-1/E-5** 계약·버그 정리 | 실 백엔드 화면이 깨지지 않게 | - |
| 5 | **Phase C** AI 연동 | 오탐 억제·원인분석 고도화 | B |
| 6 | **Phase D-3** 노드간 하트비트 | SPOF 제거, 고가용 마무리 | D |
| 7 | **Phase E-2/E-3/E-4** 잔여 페이지·RBAC·정리 | 제품 완성도 | - |

---

## 6. 성공 판정 기준 (이 플랜 완료 시)

- 에이전트 강제 종료 → **4초 내** 노드 Fault 표시, **핑퐁 가드 내 1회만** 자동 페일오버 발생.
- 페일오버 후 VIP가 실제 Standby로 이동(ping/arp로 검증), 서비스 무중단.
- DB/WAS/Web 프로세스 강제 종료 → Self-Healing 스크립트가 **무인 재기동**, 결과가 `healing_history`에 기록.
- 관리 서버 정지 상태에서 Active 다운 → 노드 간 하트비트로 **자율 페일오버** 동작.
- LLM 미연동/지연 상태에서도 Rule 페일오버는 **정상 동작**(AI는 보조).
- 실 백엔드 연결 시 대시보드/클러스터 화면이 **role 불일치로 깨지지 않음**.

---

*본 문서는 현재 소스(backend 46 Java, frontend 50 JSX, agent Python/Shell, mock-api.js)를 직접 검토해 작성했다. 인용한 파일:라인은 검토 시점 기준이다.*

---

## 7. 진행 현황 (Progress Log)

| Phase | 작업 | 상태 | 산출물 |
|---|---|---|---|
| **A** | 장애 감지 엔진 (C-1·C-2·C-3 토대) | ✅ 완료 | `detection/HealthMonitorService`(@Scheduled 1s, staleness 판정, 자원/프로세스 이벤트), `MetricsCacheService`(receivedAt/TTL), `event/DetectionEvent`, `DetectionProperties`, 테스트 1종 |
| **D-1** | 에이전트 명령 수신 채널(17001) | ✅ 완료 | `nemesis-agent.py` ThreadingHTTPServer + Bearer 인증 + 화이트리스트(`control.sh`/`healing/*`), `AgentCommandController`가 노드 API키로 Bearer 전송, `AgentKeyRepository.findByNodeId` |
| **D-2** | control.sh / healing 스크립트 | ✅ 완료 | `agent/control.sh`(vip-up/down·gpfs-mount/umount·svc-*·GARP, AIX/Linux), `agent/healing/heal_oracle\|tomcat\|nginx.sh`(진단→복구→검증, 멱등, 종료코드 0/1/2), `install.sh` 배포 반영 |
| **B** | 자동 페일오버(Orchestrator) | ✅ 완료 | `FailoverOrchestrator`(가드: pingpong/max_count/대상 생존, recovering 상태머신, VIP 인수→실패 시 롤백, `failover_history` 적재), `NodeFaultEvent`+`FailoverTriggerListener`(AFTER_COMMIT @Async), 수동/감지/AI 트리거 일원화, `AgentCommandClient`(타임아웃 RestTemplate), 단위테스트 5종 |
| **E-1** | role/state 계약 통일 | ✅ 완료 | `Node.Role.uiToken()`(active→PRIMARY 등) API 경계 매핑 + `Node.Role.parse()` 역매핑, ClusterAgentController/NodeService 적용 |
| **E-5** | @Transactional 버그 | ✅ 완료 | `AiFaultService.doAnalyze` public화 + `@Lazy self` 프록시 경유 호출로 트랜잭션 유효화 |
| **C** | AI 판단 연동 | ✅ 완료 | `llm/LlmProvider`+Ollama/OpenAI/Anthropic 구현(provider 분기, `gemma4` 오타 수정), `LlmService`(타임아웃·폴백), `AiDecisionService`(FAILOVER_NOW/HOLD/SELF_HEAL_FIRST+confidence, Rule 폴백), `ai_decisions` 적재, 리스너 게이트(ai_enabled 시) |
| **D-3/D-4** | 노드간 하트비트·메타 동기화 | ✅ 완료 | 에이전트 17000 하트비트 서버/송신 스레드, 관리서버 단절+active 사망 시 control.sh로 자율 VIP 인수, `/api/agent/meta` Pull→`metadata.json` 원자적 갱신 |
| **E-4** | 죽은 코드 제거 | ✅ 완료 | 미사용 React 컴포넌트 6종 삭제, `getDockerStatus` 가짜 0/0→명시적 미지원, OllamaService 제거 |
| **E-3** | 인증·RBAC | ✅ 완료 | `users`+3단계 Role, PBKDF2 해시, HMAC 토큰, `RbacFilter`(failover/execute=operator+, 사용자생성=admin), `/api/auth/login`, 기본 admin 시드, CORS `*`→화이트리스트 |
| **E-2** | 누락 컨트롤러 | ✅ 완료 | 실 데이터 소스 부재 페이지 10종(DB/Docker컨테이너·이미지/Inspection/Reports/Alerts설정/System설정/HA시퀀스·동기화/Services)에 재사용 `ComingSoon` 배너 적용 → 빈 화면/에러를 "준비중"으로 명시. 향후 수집 파이프라인 연결 시 배너만 제거 |
| **③ 프론트 RBAC** | 로그인→토큰 첨부·계약 연결 | ✅ 완료 | `api/token.js`(저장), `client.js` axios 인터셉터(Bearer 첨부 + 401→자동 로그아웃), `auth/AuthContext`(login/logout/isOperator/isAdmin), `pages/Login.jsx`, `App` 인증 게이트, Navbar 실 사용자·로그아웃. role/state는 백엔드 `uiToken()`이 이미 PRIMARY 등으로 변환해 정합 |
| **SP1 AIOps** | aibot AI 운영자 접목(감지→조사→제안→승인→실행→보고) | ✅ 완료 | aibot 사이드카(`nemesis_service.py` FastAPI `/health·/ai/chat·/ai/investigate·/ai/execute`, 읽기전용 조사도구 `nemesis_ops_tools.py`, paramiko SSH), Nemesis `domain/aiops`(`AiProposal`+V11, `AiOperatorClient/Service/Properties`, 제안·알림 컨트롤러, RBAC operator+), `FailoverTriggerListener`→`onFault` 비동기 조사, `AiChatController` aibot 프록시+LLM 폴백, 프론트 `AiPanel` 제안카드·`Navbar` 알림벨. 단위테스트 aibot 9 + 백엔드 aiops 8 |

**검증(2026-06-11):**
- 명령 채널 e2e: 무인증/오인증 401, 비화이트리스트(`rm -rf /`) 403, 인젝션 인자 무해, 허용 스크립트 정상.
- 피어 하트비트 e2e: `/hb` 응답·`ping_peer` alive/dead 판정 정상.
- 셸 5종 `sh -n` 통과, 에이전트 `py_compile` 통과, 미사용 컴포넌트 0 참조 확인 후 삭제.
- ⚠️ **백엔드는 로컬에 JDK/gradle 미설치로 미컴파일.** 변경은 표준 패턴(파생쿼리, JDK 크립토, OncePerRequestFilter)이나 빌드 환경에서 `gradle test` 1회 필요. 신규 테스트: `FailoverOrchestratorTest`(5), 갱신 `HealthMonitorServiceTest`.

**검증(2026-06-21) — SP1 AIOps e2e:**
- 단위: aibot pytest 9 통과, 백엔드 `gradle test` 44 통과(신규 aiops 8 포함, 기존 회귀 0; 무관한 기존 깨진 테스트 2건 정정).
- 런타임: 백엔드 컨테이너 재빌드·재기동 시 Flyway V11 적용 확인, `/api/ai/proposals`·`/api/ai/notifications` 200. 실제 감지 `NodeFaultEvent`→`onFault`→aibot 호출→사이드카 불통 시 "제안 생략" 폴백(HA 무영향) 로그 확인.
- aibot 사이드카: `/health` ok, 무/오토큰 401, `/ai/investigate`가 라이브 백엔드 read API 조회 후 구조화 조치안 JSON 반환. `/api/ai/chat`(admin) aibot→ollama 왕복 응답.
- 제안 생애주기: PENDING 제안 적재→`notifications.pending=1`→admin 승인→aibot `/ai/execute` 호출→SSH 키 부재로 안전 실패→**FAILED 보고**(decidedBy=admin) 전이 확인.

**검증(2026-06-12):**
- ① **`gradle test` 통과** — Docker(`gradle:8.7-jdk17`)로 백엔드 최초 컴파일+테스트. 18/18 통과. 1건 수정: `FailoverOrchestratorTest`의 `@BeforeEach` 공용 stub을 `lenient()` 처리(strict-stubbing의 `UnnecessaryStubbingException`, 로직 버그 아님).
- ② E-2 — `ComingSoon` 배너 10개 페이지 적용, `vite build` 통과.
- ③ 프론트 RBAC — 인증 배선 완료, `vite build` 통과(모듈 1859→1862).
- ③+ 제어 버튼 role-gate — 페일오버(`ClusterDetail`, `SyncStatusPanel`)·명령실행(`AiAnalysis`) 버튼을 `isOperator`로 `disabled`+툴팁("operator 이상 권한 필요") 처리. viewer는 비활성, 백엔드 403과 이중 방어. `vite build` 통과.

**브라우저 e2e 검증(2026-06-12, Docker 스택 + headless Chromium):**
- 발견·수정: **CORS 버그** — 배포 UI 출처(`http://localhost:18090`)가 허용목록에 없어 브라우저 로그인이 403. 브라우저는 동일 출처 POST에도 `Origin`을 보내므로 배포 출처 필수(curl은 Origin 미전송이라 통과해 숨어 있었음). `SecurityProperties` 기본값 + `application.yml`(`NEMESIS_ALLOWED_ORIGINS` env 분리) + `.env`에 18090 추가.
- 통과: 로그인 화면 렌더 → admin/admin 로그인(Navbar `admin/Administrator`, localStorage 토큰 저장) → 로그아웃(토큰 제거·로그인 복귀) → 틀린 비번 "인증 실패" 표시 → viewer1 로그인(`Viewer` 표시).
- role-gate: viewer는 "수동 전환(Failover)" 버튼 `disabled`+툴팁("operator 이상 권한이 필요합니다"), admin은 활성 — 브라우저에서 확인.
- RBAC API: 틀린 비번 401, admin 토큰 사용자생성 200, 무인증 사용자생성 401. Flyway V5~V8 마이그레이션 정상 적용.

**DB/Docker 자동 스캔 + 버그 수정(2026-06-12):**
- **DB 자동 스캔**: `DbScanController`(`GET /api/db`) — SW 스캔과 동일하게 메트릭 캐시 processes에서 DB 엔진 감지(노드+엔진 중복제거). `collect.sh` 감시 목록 확장(postgres/mariadbd/mongod/redis-server/tibero/db2sysc). Db 페이지 "자동 스캔" 버튼, 배너 제거. **실검증: MySQL·PostgreSQL @ bot 감지.**
- **Docker 자동 스캔**: `control.sh`에 읽기전용 `docker-ps`/`docker-images` 액션(이미 화이트리스트라 에이전트 수정 불필요), `DockerScanController`(`/api/docker/containers|images`) — 노드별 명령 실행→TSV 파싱, 노드 실패는 errors로 부분보고. Containers/Images 페이지 "자동 스캔" 버튼+8s 폴링 제거(명령은 비싸므로 수동), 배너 제거. **실검증: 컨테이너 8(CPU/MEM 통계 포함)·이미지 6(used 판정).**
- 🔴 **버그1 — "노드 추가가 저장 안 됨"(사용자 보고)**: 저장(POST 201)은 됐으나 `GET /api/clusters/{id}/nodes`가 **500**(Node 엔티티 직접 반환→cluster lazy proxy Jackson 직렬화 실패) → 목록이 항상 비어 미저장처럼 보임. NodeController 전체를 `NodeService.toUiDto()`(nodeId/uiToken role/신선도 state) 경유로 수정 — Agents 페이지의 nodeId undefined(수정/삭제 불능)·소문자 role·state 부재도 함께 해결. **브라우저 검증: 추가 1→2행 반영, 삭제 정상.**
- 🔴 **버그2 — 에이전트 명령 채널 전체 불통**: Spring 6.1 `SimpleClientHttpRequestFactory`가 Map 바디를 **chunked 스트리밍** 전송 → 파이썬 `BaseHTTPRequestHandler`는 chunked를 못 읽어 빈 바디 400. `AgentCommandClient`가 JSON을 String으로 직렬화해 Content-Length(fixed-length) 전송하도록 수정. **FailoverOrchestrator의 VIP 인수 명령도 동일 경로라 이 수정 전엔 실환경에서 실패했을 핵심 버그.** ⚠️ 기존 §7의 "명령 채널 e2e" 검증은 curl 직접 호출이라 이 버그를 못 잡았음 — Java 클라이언트 경유 e2e 필요.
- 운영 메모: 에이전트는 코드 갱신 후 **재시작 필요**(구버전 프로세스는 17000/17001 미리스닝). 로컬 개발에서 에이전트가 `--server localhost`로 등록하면 serviceIp가 127.0.0.1로 등록돼 컨테이너 백엔드가 못 닿음 → 노드 serviceIp를 호스트 IP로 설정.

**E-2 잔여 페이지 실구현 — ComingSoon 전면 제거(2026-06-13):**
- 그동안 `ComingSoon` 배너로 막아둔 페이지를 모두 실 데이터 백엔드로 전환. Flyway `V10__ops_pages.sql`(inspections/system_settings/alert_rules/reports/ha_sequences) 추가.
- **점검 관리**: `inspection` 패키지(Inspection 엔티티+CRUD 컨트롤러), `GET/POST/PUT/DELETE /api/inspection`. 실 DB 영속.
- **시스템 설정**: `settings` 패키지(SystemSettings 단일행 id=1), `GET/PUT /api/settings/system`. 없으면 기본값 생성.
- **알람 설정**: `alert` 패키지(AlertRule, 6종 시드), `GET /api/alerts/config`·`PUT /api/alerts/config/{id}`. **DashboardService.getAlerts()가 이 규칙을 단일 소스로 사용** — 토글/임계값 변경이 실제 대시보드 알람 생성에 즉시 반영(disk 알람도 추가). 비활성 규칙은 알람 미생성.
- **리포트**: `report` 패키지(Report 엔티티+ReportService), `GET /api/reports`·`POST /api/reports`(type별 실데이터 생성: MONTHLY=구성요약, INCIDENT=failover_history, PERFORMANCE=메트릭캐시 평균, SECURITY=VIP노출·노드도달성)·`GET /api/reports/{id}/download`(텍스트 첨부). 프론트 생성 셀렉트+버튼·다운로드 blob 배선.
- **HA 운영 절차**: `ha` 패키지(HaSequence, jsonb steps), `GET/PUT /api/ha/sequences/{clusterId}`(STARTUP/SHUTDOWN/FAILOVER). Sequence.jsx ComingSoon·RunbookTab `setList(r.data.items)` 버그·clusterId `+` 강제변환(UUID→NaN) 수정.
- **HA 하트비트 매트릭스**: `HeartbeatCache`(인메모리) + `POST /api/agent/heartbeat`(에이전트 피어 핑 결과 보고) + `GET /api/ha/heartbeat/{clusterId}`(보고값 우선, 없으면 서버 메트릭 신선도 폴백). 에이전트 `measure_peer`/`report_heartbeat` 추가(run_loop에서 매 주기 보고, 추가형).
- **HA 메타데이터 동기화**: `GET/POST /api/ha/metadata-sync/{clusterId}` — 관리서버가 메타 마스터, 노드 신선=IN_SYNC/오래됨=DIVERGED. POST는 다음 에이전트 폴링 반영 ack.
- **대시보드 목업 패널 실연결**: `ServiceStatusPanel`(swItems→서비스 행), `RunbookProgressPanel`(/runbook 진행중 항목)을 Dashboard.jsx에서 실 props로 연결(기존엔 항상 빈 상태).
- ClusterStatus.jsx 하트비트/메타 탭 ComingSoon·clusterId `+` 강제변환 2곳 수정. `ha/Sync.jsx`는 `/monitoring/cluster` 리다이렉트로 미사용(방치).
- **검증**: Docker `gradle:8.7-jdk17` `compileJava`+`test` 통과(회귀 없음), `vite build` 통과(1858 모듈). ⚠️ 실 PostgreSQL 기동 시 V10 Flyway 적용 + 브라우저 e2e는 후속 권장. 에이전트 하트비트 보고는 실 에이전트 미보유로 코드 리뷰만(추가형이라 미보고 시 폴백 동작).

**잔여 작업(후속 권장):** ① 기본 admin 비밀번호 운영 환경 교체. ② 외부 호스트에서 UI 접속 시 `NEMESIS_ALLOWED_ORIGINS`에 해당 origin 추가. ③ 에이전트 자기 IP 감지 개선(127.0.0.1 등록 방지). ④ Java 클라이언트 경유 명령채널 통합테스트 추가. ⑤ 실 PostgreSQL 기동 후 V10 페이지 브라우저 e2e + 에이전트 하트비트 보고 실측.
