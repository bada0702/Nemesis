# AIOps SP5 — AI 운영 센터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 에러/현재 상태와 장애 예측을 한 화면에서 확인하고 예방·복구 조치를 검토·승인하는 통합 'AI 운영' 페이지와, 추세 기반 하이브리드 장애 예측을 추가한다.

**Architecture:** 기존 SP3 모니터링 파이프라인(`AiPrefilter → AiMonitorService → client.scan → AiFindingService → (HIGH/CRIT) AiProposal → 승인 → /ai/execute`)을 재사용한다. 신규 개념은 "예측 신호"(`AiPredictPrefilter`)뿐이며, 예측 신호도 동일한 scan/finding/proposal 경로를 타고 finding은 `category`(REACTIVE/PREDICTIVE)로만 구분한다. 프론트는 단일 페이지 3탭으로 findings/proposals를 폴링·표시한다.

**Tech Stack:** Spring Boot(Java 17, JPA, Flyway), JUnit5 + Mockito + AssertJ, React(Vite) + axios + lucide-react + Tailwind.

## Global Constraints

- 백엔드 테스트는 gradle wrapper가 없으므로 Docker로 실행한다(프로젝트 관례):
  `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "<FQN>"`
  (worktree 루트에서 실행. `$(pwd)`는 worktree 루트여야 함.)
- `spring.jpa.hibernate.ddl-auto=validate` → 스키마 변경은 반드시 Flyway 마이그레이션으로. 다음 버전 = **V17**.
- 기존 코드 컨벤션 준수: 한국어 주석, `AiFinding` 상수 사용, Suspect record 시그니처 변경 금지.
- HA 폴백 철학: 사이드카/LLM 미가용 시 조용히 skip(예외 전파 금지).
- 프론트는 JS 단위테스트 하네스가 없음 → 검증은 `npm run build` 성공 + 수동 확인.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

신규:
- `backend/src/main/resources/db/migration/V17__ai_finding_category.sql` — category 컬럼
- `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilter.java` — 추세 예측 사전필터
- `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilterTest.java`
- `frontend/src/pages/AiOpsCenter.jsx` — 통합 3탭 페이지

수정:
- `backend/.../aiops/monitor/AiFinding.java` — category 필드 + 상수(DISK_TREND/MEM_TREND/REACTIVE/PREDICTIVE)
- `backend/.../aiops/AiOperatorProperties.java` — Monitor에 predict* 설정
- `backend/.../aiops/monitor/AiFindingService.java` — category 인자 오버로드
- `backend/.../aiops/monitor/AiFindingRepository.java` — category 필터 쿼리
- `backend/.../aiops/monitor/AiFindingController.java` — category 파라미터
- `backend/.../aiops/monitor/AiMonitorService.java` — 예측 패스 추가
- `frontend/src/api/client.js` — getAiFindings(status, category)
- `frontend/src/App.jsx` — /ai 라우트 + /ai-analysis redirect
- `frontend/src/components/Sidebar.jsx` — 'AI 운영' 메뉴

선택(저장소 밖, 배포본):
- `/opt/nemesis-aibot/nemesis_service.py` + `/root/aibot/nemesis_service.py` — 예측 프롬프트 힌트

---

## Task 1: AiFinding category 필드 + 마이그레이션

**Files:**
- Create: `backend/src/main/resources/db/migration/V17__ai_finding_category.sql`
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFinding.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingTest.java` (기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `AiFinding.REACTIVE`, `AiFinding.PREDICTIVE`, `AiFinding.DISK_TREND`, `AiFinding.MEM_TREND` (String 상수); `AiFinding.getCategory()/setCategory(String)`; 신규 finding의 category 기본값 `"REACTIVE"`.

- [ ] **Step 1: 마이그레이션 작성**

Create `backend/src/main/resources/db/migration/V17__ai_finding_category.sql`:

```sql
-- SP5: finding을 반응형/예측형으로 구분
ALTER TABLE ai_findings ADD COLUMN category VARCHAR(10) NOT NULL DEFAULT 'REACTIVE';
```

- [ ] **Step 2: 실패 테스트 추가**

`AiFindingTest.java` 끝(마지막 `}` 직전)에 추가:

```java
    @Test void defaultCategoryIsReactive() {
        AiFinding f = AiFinding.builder().nodeId(java.util.UUID.randomUUID())
                .signalType(AiFinding.DISK_FULL).severity(AiFinding.WARN).build();
        f.prePersist();
        org.assertj.core.api.Assertions.assertThat(f.getCategory()).isEqualTo(AiFinding.REACTIVE);
    }

    @Test void trendSignalConstantsDefined() {
        org.assertj.core.api.Assertions.assertThat(AiFinding.DISK_TREND).isEqualTo("DISK_TREND");
        org.assertj.core.api.Assertions.assertThat(AiFinding.MEM_TREND).isEqualTo("MEM_TREND");
        org.assertj.core.api.Assertions.assertThat(AiFinding.PREDICTIVE).isEqualTo("PREDICTIVE");
    }
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiFindingTest"`
Expected: FAIL — `getCategory()` / `DISK_TREND` 심볼 없음(컴파일 에러).

- [ ] **Step 4: 엔티티 수정**

`AiFinding.java`에서 상수 블록에 추가(기존 `EVENT_SPIKE, OTHER` 라인 뒤):

```java
    public static final String DISK_TREND = "DISK_TREND", MEM_TREND = "MEM_TREND";
    public static final String REACTIVE = "REACTIVE", PREDICTIVE = "PREDICTIVE";
```

`detail` 필드 선언(`@Column(columnDefinition = "TEXT") private String detail;`) 바로 아래에 추가:

```java
    @Column(nullable = false, length = 10) private String category;
```

`prePersist()` 안 `if (status == null) status = OPEN;` 다음 줄에 추가:

```java
        if (category == null) category = REACTIVE;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiFindingTest"`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/resources/db/migration/V17__ai_finding_category.sql backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFinding.java backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingTest.java
git commit -m "feat(aiops): SP5 AiFinding category(반응형/예측형) + 추세 신호 상수

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: AiOperatorProperties 예측 설정

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorProperties.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorPropertiesTest.java` (기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `Monitor.isPredictEnabled()`, `getPredictWindowSize()`, `getPredictMinSamples()`, `getPredictTargetPercent()` (double), `getPredictHorizonMinutes()` (long), `getPredictHighEtaMinutes()` (long), `getPredictCriticalEtaMinutes()` (long). 기본값: enabled=true, window=6, minSamples=4, target=95.0, horizon=360, high=120, critical=30.

- [ ] **Step 1: 실패 테스트 추가**

`AiOperatorPropertiesTest.java` 마지막 `}` 직전에 추가:

```java
    @Test void monitorPredictDefaults() {
        AiOperatorProperties.Monitor m = new AiOperatorProperties().getMonitor();
        org.assertj.core.api.Assertions.assertThat(m.isPredictEnabled()).isTrue();
        org.assertj.core.api.Assertions.assertThat(m.getPredictWindowSize()).isEqualTo(6);
        org.assertj.core.api.Assertions.assertThat(m.getPredictMinSamples()).isEqualTo(4);
        org.assertj.core.api.Assertions.assertThat(m.getPredictTargetPercent()).isEqualTo(95.0);
        org.assertj.core.api.Assertions.assertThat(m.getPredictHorizonMinutes()).isEqualTo(360L);
        org.assertj.core.api.Assertions.assertThat(m.getPredictHighEtaMinutes()).isEqualTo(120L);
        org.assertj.core.api.Assertions.assertThat(m.getPredictCriticalEtaMinutes()).isEqualTo(30L);
    }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.AiOperatorPropertiesTest"`
Expected: FAIL — `isPredictEnabled()` 심볼 없음(컴파일 에러).

- [ ] **Step 3: Monitor 클래스에 필드 추가**

`AiOperatorProperties.java`의 `static class Monitor { ... }` 안, `private int eventSpikeCount = 5;` 다음 줄에 추가:

```java

        /** SP5: 추세 기반 장애 예측 */
        private boolean predictEnabled = true;
        private int     predictWindowSize = 6;        // 노드별 롤링 샘플 보관 개수
        private int     predictMinSamples = 4;        // 예측에 필요한 최소 샘플 수
        private double  predictTargetPercent = 95.0;  // 도달 시 위험으로 보는 목표치(%)
        private long    predictHorizonMinutes = 360;  // 이 이내 도달 예상 시 신호(분)
        private long    predictHighEtaMinutes = 120;  // ETA 이하면 HIGH
        private long    predictCriticalEtaMinutes = 30; // ETA 이하면 CRITICAL
```

(`@Getter @Setter`가 클래스에 있으므로 getter/setter 자동 생성됨. boolean은 `isPredictEnabled()`.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.AiOperatorPropertiesTest"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/AiOperatorProperties.java backend/src/test/java/com/nemesis/domain/aiops/AiOperatorPropertiesTest.java
git commit -m "feat(aiops): SP5 예측 모니터 설정(window/eta 임계) 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: AiPredictPrefilter (추세→ETA 예측 사전필터)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilter.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilterTest.java`

**Interfaces:**
- Consumes: `MetricsCacheService.getAll()` → `Map<UUID, MetricsPushRequest>` (필드 `getDiskPercent()`, `getMemoryPercent()`); `NodeRepository.findAll()`; `AiOperatorProperties.getMonitor()`; `AiOpsDtos.Suspect` record `(UUID nodeId, UUID clusterId, String hostname, String role, String signalType, String severity, Map<String,Object> detail)`.
- Produces: `static long etaMinutes(double[] samples, long intervalMinutes, double target)` (증가추세 아님/이미 도달/샘플부족 시 -1); `List<Suspect> evaluate()` (signalType=`DISK_TREND`/`MEM_TREND`, detail={current, etaMinutes, target}). Spring `@Component`.

- [ ] **Step 1: 실패 테스트 작성**

Create `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilterTest.java`:

```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiPredictPrefilterTest {
    MetricsCacheService metrics; NodeRepository nodeRepo; AiOperatorProperties props; AiPredictPrefilter pf;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        metrics = mock(MetricsCacheService.class);
        nodeRepo = mock(NodeRepository.class);
        props = new AiOperatorProperties();
        props.getMonitor().setIntervalMs(60_000L);   // 1분 간격 → ETA 계산 단순화
        Node node = mock(Node.class);
        when(node.getId()).thenReturn(nodeId);
        when(node.getHostname()).thenReturn("db2");
        Cluster c = mock(Cluster.class);
        when(c.getId()).thenReturn(clusterId);
        when(node.getCluster()).thenReturn(c);
        when(node.getRole()).thenReturn(Node.Role.active);
        when(nodeRepo.findAll()).thenReturn(List.of(node));
        pf = new AiPredictPrefilter(metrics, nodeRepo, props);
    }
    private MetricsPushRequest disk(double d) {
        MetricsPushRequest r = new MetricsPushRequest();
        r.setDiskPercent(d); r.setMemoryPercent(0); return r;
    }

    // ── 순수 함수 etaMinutes ──
    @Test void etaRisingReachesTarget() {
        // 80,82,84,86 (1분 간격, +2/분) → 95까지 (95-86)/2 = 4.5 → ceil 5
        long eta = AiPredictPrefilter.etaMinutes(new double[]{80, 82, 84, 86}, 1, 95);
        assertThat(eta).isEqualTo(5L);
    }
    @Test void etaFlatReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{80, 80, 80, 80}, 1, 95)).isEqualTo(-1L);
    }
    @Test void etaFallingReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{90, 88, 86, 84}, 1, 95)).isEqualTo(-1L);
    }
    @Test void etaAlreadyAtTargetReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{94, 95, 96, 97}, 1, 95)).isEqualTo(-1L);
    }
    @Test void etaTooFewSamplesReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{80}, 1, 95)).isEqualTo(-1L);
    }

    // ── evaluate() ──
    @Test void noSignalUntilMinSamples() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, disk(86)));
        for (int i = 0; i < props.getMonitor().getPredictMinSamples() - 1; i++)
            assertThat(pf.evaluate()).isEmpty();   // 샘플 누적 중
    }
    @Test void risingDiskEmitsTrendSuspect() {
        // 4회 push: 80,82,84,86 → ETA 5분 ≤ critical(30) → CRITICAL
        double[] seq = {80, 82, 84, 86};
        List<Suspect> last = List.of();
        for (double v : seq) { when(metrics.getAll()).thenReturn(Map.of(nodeId, disk(v))); last = pf.evaluate(); }
        assertThat(last).hasSize(1);
        Suspect s = last.get(0);
        assertThat(s.signalType()).isEqualTo(AiFinding.DISK_TREND);
        assertThat(s.severity()).isEqualTo(AiFinding.CRITICAL);
        assertThat(s.detail()).containsKey("etaMinutes");
    }
    @Test void slowRiseBeyondHorizonNoSignal() {
        // +0.01/분 → 95까지 수백 분 → horizon(360) 초과 → 신호 없음
        double[] seq = {80.00, 80.01, 80.02, 80.03};
        List<Suspect> last = List.of();
        for (double v : seq) { when(metrics.getAll()).thenReturn(Map.of(nodeId, disk(v))); last = pf.evaluate(); }
        assertThat(last).isEmpty();
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiPredictPrefilterTest"`
Expected: FAIL — `AiPredictPrefilter` 클래스 없음(컴파일 에러).

- [ ] **Step 3: 구현 작성**

Create `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilter.java`:

```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.AiOperatorProperties.Monitor;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** SP5 예측 사전필터: 노드별 disk/mem 롤링 추세로 임계 도달 ETA를 추정해 의심신호 방출. */
@Component
public class AiPredictPrefilter {
    private final MetricsCacheService metrics;
    private final NodeRepository nodeRepo;
    private final AiOperatorProperties props;

    private final Map<UUID, Deque<Double>> diskHist = new ConcurrentHashMap<>();
    private final Map<UUID, Deque<Double>> memHist  = new ConcurrentHashMap<>();

    public AiPredictPrefilter(MetricsCacheService metrics, NodeRepository nodeRepo, AiOperatorProperties props) {
        this.metrics = metrics; this.nodeRepo = nodeRepo; this.props = props;
    }

    /** 최근 샘플(시간순)로 최소제곱 기울기를 구해 target 도달까지 분 추정.
     *  증가추세 아님/이미 도달/샘플부족 시 -1. */
    public static long etaMinutes(double[] samples, long intervalMinutes, double target) {
        int n = samples.length;
        if (n < 2 || intervalMinutes <= 0) return -1;
        double current = samples[n - 1];
        if (current >= target) return -1;                 // 이미 도달 → 반응형이 처리
        double meanX = (n - 1) / 2.0, meanY = 0;
        for (double v : samples) meanY += v;
        meanY /= n;
        double num = 0, den = 0;
        for (int i = 0; i < n; i++) { num += (i - meanX) * (samples[i] - meanY); den += (i - meanX) * (i - meanX); }
        if (den == 0) return -1;
        double slopePerStep = num / den;
        if (slopePerStep <= 0) return -1;                 // 평탄/하강
        double slopePerMin = slopePerStep / intervalMinutes;
        return (long) Math.ceil((target - current) / slopePerMin);
    }

    public List<Suspect> evaluate() {
        Monitor cfg = props.getMonitor();
        if (!cfg.isPredictEnabled()) return List.of();
        long intervalMin = Math.max(1, cfg.getIntervalMs() / 60_000L);
        double target = cfg.getPredictTargetPercent();
        Map<UUID, MetricsPushRequest> all = metrics.getAll();
        List<Suspect> out = new ArrayList<>();
        for (Node node : nodeRepo.findAll()) {
            MetricsPushRequest mx = all.get(node.getId());
            if (mx == null) continue;
            UUID cid = node.getCluster() != null ? node.getCluster().getId() : null;
            String role = node.getRole() != null ? node.getRole().name() : "?";
            push(diskHist, node.getId(), mx.getDiskPercent(), cfg.getPredictWindowSize());
            push(memHist,  node.getId(), mx.getMemoryPercent(), cfg.getPredictWindowSize());
            predict(node, cid, role, AiFinding.DISK_TREND, diskHist.get(node.getId()),
                    mx.getDiskPercent(), intervalMin, target, cfg).ifPresent(out::add);
            predict(node, cid, role, AiFinding.MEM_TREND, memHist.get(node.getId()),
                    mx.getMemoryPercent(), intervalMin, target, cfg).ifPresent(out::add);
        }
        return out;
    }

    private void push(Map<UUID, Deque<Double>> hist, UUID id, double v, int max) {
        Deque<Double> q = hist.computeIfAbsent(id, k -> new ArrayDeque<>());
        q.addLast(v);
        while (q.size() > max) q.removeFirst();
    }

    private Optional<Suspect> predict(Node n, UUID cid, String role, String type, Deque<Double> hist,
                                      double current, long intervalMin, double target, Monitor cfg) {
        if (hist == null || hist.size() < cfg.getPredictMinSamples()) return Optional.empty();
        double[] arr = hist.stream().mapToDouble(Double::doubleValue).toArray();
        long eta = etaMinutes(arr, intervalMin, target);
        if (eta <= 0 || eta > cfg.getPredictHorizonMinutes()) return Optional.empty();
        String sev = eta <= cfg.getPredictCriticalEtaMinutes() ? AiFinding.CRITICAL
                   : eta <= cfg.getPredictHighEtaMinutes()     ? AiFinding.HIGH
                   : AiFinding.WARN;
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("current", current); d.put("etaMinutes", eta); d.put("target", target);
        return Optional.of(new Suspect(n.getId(), cid, n.getHostname(), role, type, sev, d));
    }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiPredictPrefilterTest"`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilter.java backend/src/test/java/com/nemesis/domain/aiops/monitor/AiPredictPrefilterTest.java
git commit -m "feat(aiops): SP5 AiPredictPrefilter — 추세 기반 임계 도달 ETA 예측

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: AiFindingService category 인자 오버로드

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingService.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingServiceTest.java` (케이스 추가)

**Interfaces:**
- Consumes: `AiFinding.REACTIVE/PREDICTIVE` (Task 1).
- Produces: `recordWarn(Suspect)` 와 `recordWarn(Suspect, String category)`; `recordHigh(Suspect, ScanFinding)` 와 `recordHigh(Suspect, ScanFinding, String category)`. 1-인자 버전은 REACTIVE로 위임(기존 호출·테스트 호환). 신규 finding의 category가 인자대로 저장됨.

- [ ] **Step 1: 실패 테스트 추가**

`AiFindingServiceTest.java` 마지막 `}` 직전에 추가:

```java
    @Test void predictiveWarnSetsCategoryPredictive() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        Suspect s = new Suspect(nodeId, clusterId, "db2", "active",
                AiFinding.DISK_TREND, AiFinding.WARN, Map.of("etaMinutes", 200L));
        svc.recordWarn(s, AiFinding.PREDICTIVE);
        verify(repo).save(argThat(f -> AiFinding.PREDICTIVE.equals(f.getCategory())
                && f.getSignalType().equals(AiFinding.DISK_TREND)));
    }

    @Test void defaultRecordWarnIsReactive() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        svc.recordWarn(warn());
        verify(repo).save(argThat(f -> AiFinding.REACTIVE.equals(f.getCategory())));
    }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiFindingServiceTest"`
Expected: FAIL — `recordWarn(Suspect, String)` 없음(컴파일 에러).

- [ ] **Step 3: 서비스 수정**

`AiFindingService.java`에서 기존 `recordWarn(Suspect s)`의 시그니처/본문을 다음으로 교체(1-인자 위임 + 2-인자 본문):

```java
    @Transactional
    public void recordWarn(Suspect s) { recordWarn(s, AiFinding.REACTIVE); }

    @Transactional
    public void recordWarn(Suspect s, String category) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        Optional<AiFinding> open = repo.findByFingerprintAndStatus(fp, AiFinding.OPEN);
        if (open.isPresent()) {                 // 기존 열림 → lastSeen만 갱신(LLM 재호출 안 함: 비용 한정)
            AiFinding f = open.get();
            f.setLastSeenAt(OffsetDateTime.now());
            f.setSummary(summary(s));
            repo.save(f);
            return;
        }
        AiFinding f = newFinding(s, category);
        f.setSummary(summary(s));
        explainErrorPattern(s, f);              // 신규일 때만 SSH 없는 경량 LLM 설명
        repo.save(f);
    }
```

기존 `recordHigh(Suspect s, ScanFinding sf)`의 시그니처/본문을 다음으로 교체:

```java
    @Transactional
    public void recordHigh(Suspect s, ScanFinding sf) { recordHigh(s, sf, AiFinding.REACTIVE); }

    @Transactional
    public void recordHigh(Suspect s, ScanFinding sf, String category) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        Optional<AiFinding> open = repo.findByFingerprintAndStatus(fp, AiFinding.OPEN);
        if (open.isPresent()) {                 // 이미 열림 → 갱신만(제안 중복 방지)
            AiFinding f = open.get();
            f.setLastSeenAt(OffsetDateTime.now());
            if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
            repo.save(f);
            return;
        }
        AiFinding f = newFinding(s, category);
        f.setSeverity(sf != null ? sf.severity() : s.severity());
        f.setSummary(sf != null ? sf.summary() : summary(s));
        if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
        if (sf != null && sf.proposedActions() != null && !sf.proposedActions().isEmpty()) {
            AiProposal p = ops.createFindingProposal(s.clusterId(), s.nodeId(), summary(s), sf);
            if (p != null) f.setProposalId(p.getId());
        }
        repo.save(f);
    }
```

기존 `private AiFinding newFinding(Suspect s)`의 시그니처를 `private AiFinding newFinding(Suspect s, String category)`로 바꾸고, builder 체인에 `.category(category)` 추가(`.detail(...)` 다음 줄):

```java
    private AiFinding newFinding(Suspect s, String category) {
        return AiFinding.builder()
                .id(UUID.randomUUID()).clusterId(s.clusterId()).nodeId(s.nodeId())
                .signalType(s.signalType()).severity(s.severity()).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(s.nodeId(), s.signalType()))
                .detail(toJson(s.detail()))
                .category(category)
                .firstSeenAt(OffsetDateTime.now()).lastSeenAt(OffsetDateTime.now())
                .createdAt(OffsetDateTime.now())
                .build();
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiFindingServiceTest"`
Expected: PASS (신규 2건 + 기존 케이스 모두)

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingService.java backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingServiceTest.java
git commit -m "feat(aiops): SP5 AiFindingService category 인자 오버로드(예측형 기록)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: AiMonitorService 예측 패스 통합

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiMonitorService.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiMonitorServiceTest.java` (케이스 추가)

**Interfaces:**
- Consumes: `AiPredictPrefilter.evaluate()` (Task 3); `AiFindingService.recordWarn/recordHigh(.., category)` (Task 4).
- Produces: 생성자에 `AiPredictPrefilter` 파라미터 추가(마지막 인자); `runScan()`이 반응형+예측형 둘 다 수행하고 reconcile은 합집합.

- [ ] **Step 1: 기존 테스트의 생성자 호출 확인**

`AiMonitorServiceTest.java`에서 `new AiMonitorService(...)` 호출부를 찾는다. 생성자에 예측 prefilter 인자가 새로 들어가므로 기존 호출도 수정해야 한다.

Run: `grep -n "new AiMonitorService" backend/src/test/java/com/nemesis/domain/aiops/monitor/AiMonitorServiceTest.java`

- [ ] **Step 2: 실패 테스트 추가 + 기존 생성자 호출 수정**

`AiMonitorServiceTest.java`에서:

(a) 필드/목 선언부에 예측 prefilter mock 추가(기존 `AiPrefilter prefilter;` 선언 옆):

```java
    AiPredictPrefilter predictPrefilter;
```

(b) `@BeforeEach`(또는 셋업)에서 mock 생성 및 기본 동작(빈 리스트) 지정, 그리고 `new AiMonitorService(...)` 호출에 마지막 인자로 `predictPrefilter` 추가. 예:

```java
        predictPrefilter = mock(AiPredictPrefilter.class);
        when(predictPrefilter.evaluate()).thenReturn(java.util.List.of());
        // 기존: new AiMonitorService(prefilter, client, findings, props, nodeRepo)
        // 변경: 마지막 인자로 predictPrefilter 추가
        svc = new AiMonitorService(prefilter, client, findings, props, nodeRepo, predictPrefilter);
```

(주의: 기존 셋업의 실제 변수명/순서에 맞춰 마지막 인자만 추가한다.)

(c) 마지막 `}` 직전에 예측 패스 검증 케이스 추가:

```java
    @Test void predictiveCriticalRecordsHighWithPredictiveCategory() {
        // 반응형은 비우고 예측형만 CRITICAL 1건
        when(prefilter.evaluate()).thenReturn(java.util.List.of());
        Suspect pred = new Suspect(nodeId, clusterId, "db2", "active",
                AiFinding.DISK_TREND, AiFinding.CRITICAL, java.util.Map.of("etaMinutes", 10L));
        when(predictPrefilter.evaluate()).thenReturn(java.util.List.of(pred));
        when(client.scan(any(), any())).thenReturn(null);   // 사이드카 폴백: 1차 정보만

        svc.runScan();

        verify(findings).recordHigh(eq(pred), isNull(), eq(AiFinding.PREDICTIVE));
        verify(findings).reconcileResolved(argThat(set ->
                set.contains(AiFinding.fingerprint(nodeId, AiFinding.DISK_TREND))));
    }

    @Test void predictiveWarnRecordsWarnWithPredictiveCategory() {
        when(prefilter.evaluate()).thenReturn(java.util.List.of());
        Suspect pred = new Suspect(nodeId, clusterId, "db2", "active",
                AiFinding.MEM_TREND, AiFinding.WARN, java.util.Map.of("etaMinutes", 300L));
        when(predictPrefilter.evaluate()).thenReturn(java.util.List.of(pred));

        svc.runScan();

        verify(findings).recordWarn(eq(pred), eq(AiFinding.PREDICTIVE));
    }
```

(import 필요 시 상단에 `import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;`, `import static org.mockito.ArgumentMatchers.*;` 확인.)

- [ ] **Step 3: 테스트 실패 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiMonitorServiceTest"`
Expected: FAIL — 생성자 인자 불일치/`recordHigh(.., category)` 미존재(컴파일 에러).

- [ ] **Step 4: 서비스 수정**

`AiMonitorService.java`에서 필드/생성자에 예측 prefilter 추가:

필드 선언부(`private final AiPrefilter prefilter;` 옆)에 추가:

```java
    private final AiPredictPrefilter predictPrefilter;
```

생성자를 다음으로 교체:

```java
    public AiMonitorService(AiPrefilter prefilter, AiOperatorClient client, AiFindingService findings,
                            AiOperatorProperties props, NodeRepository nodeRepo,
                            AiPredictPrefilter predictPrefilter) {
        this.prefilter = prefilter; this.client = client; this.findings = findings;
        this.props = props; this.nodeRepo = nodeRepo; this.predictPrefilter = predictPrefilter;
    }
```

`runScan()`을 다음으로 교체(반응형 로직을 헬퍼로 분리 + 예측 패스 추가):

```java
    public void runScan() {
        Set<String> active = new HashSet<>();
        scanPass(prefilter.evaluate(), active, AiFinding.REACTIVE);
        scanPass(predictPrefilter.evaluate(), active, AiFinding.PREDICTIVE);
        findings.reconcileResolved(active);
    }

    private void scanPass(List<Suspect> suspects, Set<String> active, String category) {
        for (Suspect s : suspects) {
            active.add(AiFinding.fingerprint(s.nodeId(), s.signalType()));
            boolean high = AiFinding.HIGH.equals(s.severity()) || AiFinding.CRITICAL.equals(s.severity());
            if (!high) { findings.recordWarn(s, category); continue; }
            ScanFinding sf = investigate(s);
            findings.recordHigh(s, sf, category);
        }
    }
```

(`investigate(Suspect)`와 `sshTarget(UUID)`는 그대로 둔다.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiMonitorServiceTest"`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiMonitorService.java backend/src/test/java/com/nemesis/domain/aiops/monitor/AiMonitorServiceTest.java
git commit -m "feat(aiops): SP5 AiMonitorService 예측 패스 통합(반응형+예측형 합집합 reconcile)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: findings API category 필터

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingRepository.java`
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingController.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingControllerTest.java` (케이스 추가)

**Interfaces:**
- Produces: `GET /api/ai/findings?status=&category=` (category 미지정 시 전체); `AiFindingRepository.findByStatusAndCategoryOrderByLastSeenAtDesc(String status, String category)`.

- [ ] **Step 1: 기존 컨트롤러 테스트 패턴 확인**

Run: `sed -n '1,60p' backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingControllerTest.java`
(테스트가 MockMvc인지 TestRestTemplate인지 확인 후 동일 패턴 사용.)

- [ ] **Step 2: 실패 테스트 추가**

`AiFindingControllerTest.java`에 category 필터 케이스를 기존 패턴과 동일 방식으로 추가한다. 컨트롤러가 `repo`를 직접 쓰므로(@RequiredArgsConstructor) 단위 스타일이면 다음을 추가:

```java
    @Test void listFiltersByCategoryWhenProvided() {
        AiFindingRepository repo = org.mockito.Mockito.mock(AiFindingRepository.class);
        AiFindingController c = new AiFindingController(repo);
        c.list("OPEN", "PREDICTIVE");
        org.mockito.Mockito.verify(repo)
                .findByStatusAndCategoryOrderByLastSeenAtDesc("OPEN", "PREDICTIVE");
    }

    @Test void listIgnoresBlankCategory() {
        AiFindingRepository repo = org.mockito.Mockito.mock(AiFindingRepository.class);
        AiFindingController c = new AiFindingController(repo);
        c.list("OPEN", null);
        org.mockito.Mockito.verify(repo).findByStatusOrderByLastSeenAtDesc("OPEN");
    }
```

(기존 테스트가 SpringBootTest+TestRestTemplate 방식이면, 동일 스타일로 `?category=PREDICTIVE` 요청이 200을 반환하는지 검증하는 케이스로 대체한다. 핵심은 category 분기가 동작함을 확인하는 것.)

- [ ] **Step 3: 테스트 실패 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiFindingControllerTest"`
Expected: FAIL — `list(String, String)` / 리포지토리 메서드 없음(컴파일 에러).

- [ ] **Step 4: 리포지토리 + 컨트롤러 수정**

`AiFindingRepository.java`에 메서드 추가(`findByStatusOrderByLastSeenAtDesc` 다음 줄):

```java
    List<AiFinding> findByStatusAndCategoryOrderByLastSeenAtDesc(String status, String category);
```

`AiFindingController.java`의 `list` 메서드를 다음으로 교체:

```java
    @GetMapping
    public List<AiFinding> list(@RequestParam(required = false) String status,
                               @RequestParam(required = false) String category) {
        String st = (status == null || status.isBlank()) ? AiFinding.OPEN : status;
        return (category == null || category.isBlank())
                ? repo.findByStatusOrderByLastSeenAtDesc(st)
                : repo.findByStatusAndCategoryOrderByLastSeenAtDesc(st, category);
    }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests "com.nemesis.domain.aiops.monitor.AiFindingControllerTest"`
Expected: PASS

- [ ] **Step 6: 전체 백엔드 테스트 회귀 확인 + 커밋**

Run: `docker run --rm -v "$(pwd)/backend":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon`
Expected: BUILD SUCCESSFUL (전체 통과)

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingRepository.java backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingController.java backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingControllerTest.java
git commit -m "feat(aiops): SP5 findings API category 필터

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 프론트 API 클라이언트 category 지원

**Files:**
- Modify: `frontend/src/api/client.js:126`

**Interfaces:**
- Produces: `getAiFindings(status, category)` — 둘 다 선택적. 기존 1-인자 호출(`getAiFindings('OPEN')`)과 호환.

- [ ] **Step 1: client.js 수정**

`frontend/src/api/client.js`의 기존 줄

```js
export const getAiFindings      = (status)  => client.get('/ai/findings', { params: status ? { status } : {} })
```

를 다음으로 교체:

```js
export const getAiFindings      = (status, category) => client.get('/ai/findings', {
  params: { ...(status ? { status } : {}), ...(category ? { category } : {}) },
})
```

- [ ] **Step 2: 빌드 검증**

Run: `cd frontend && npm run build`
Expected: 빌드 성공(에러 없음).

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/api/client.js
git commit -m "feat(aiops): SP5 getAiFindings category 파라미터 지원

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: AiOpsCenter 페이지(3탭)

**Files:**
- Create: `frontend/src/pages/AiOpsCenter.jsx`

**Interfaces:**
- Consumes: `getAiFindings(status, category)` (Task 7), `getAiProposals(status)`, `approveAiProposal(id)`, `rejectAiProposal(id)` (기존 client.js).
- Produces: `default export function AiOpsCenter()` — `/ai` 라우트에서 렌더.

- [ ] **Step 1: 페이지 작성**

Create `frontend/src/pages/AiOpsCenter.jsx`:

```jsx
import React, { useEffect, useState, useCallback } from 'react'
import { Bot, RefreshCw, AlertTriangle, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react'
import { getAiFindings, getAiProposals, approveAiProposal, rejectAiProposal } from '../api/client'

const SEV_CLS = {
  CRITICAL: 'border-red-600/50 bg-red-500/10 text-red-300',
  HIGH:     'border-red-500/40 bg-red-500/5 text-red-300',
  WARN:     'border-amber-500/40 bg-amber-500/5 text-amber-300',
  INFO:     'border-sky-500/40 bg-sky-500/5 text-sky-300',
}
const RISK_CLS = {
  HIGH:   'text-red-400 bg-red-500/10 border-red-500/20',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  LOW:    'text-green-400 bg-green-500/10 border-green-500/20',
}
const fmt = (w) => (w ? new Date(w).toLocaleString('ko-KR') : '—')

function etaText(detail) {
  try {
    const d = typeof detail === 'string' ? JSON.parse(detail) : (detail || {})
    if (d.etaMinutes == null) return ''
    const m = Number(d.etaMinutes)
    const when = m < 60 ? `약 ${m}분 내` : `약 ${Math.round(m / 60)}시간 내`
    const cur = d.current != null ? `현재 ${Number(d.current).toFixed(1)}% → ` : ''
    const tgt = d.target != null ? `${d.target}% 도달` : '임계 도달'
    return `${cur}${when} ${tgt}`
  } catch { return '' }
}

function SevBadge({ sev }) {
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${SEV_CLS[sev] || SEV_CLS.INFO}`}>{sev}</span>
}

function FindingCard({ f, predictive }) {
  return (
    <div className={`rounded-xl border p-4 ${SEV_CLS[f.severity] || SEV_CLS.INFO}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-white">{f.signalType}</span>
        <SevBadge sev={f.severity} />
      </div>
      {predictive && etaText(f.detail) && (
        <p className="text-xs text-amber-200 mb-1">⏳ {etaText(f.detail)}</p>
      )}
      {f.summary && <p className="text-xs text-gray-300 mb-1">{f.summary}</p>}
      {f.diagnosis && <p className="text-[11px] text-gray-400 mb-1">{f.diagnosis}</p>}
      <p className="text-[10px] text-gray-500">최근: {fmt(f.lastSeenAt)}</p>
    </div>
  )
}

function ProposalCard({ p, onDecide, busy }) {
  let actions = []
  try { actions = typeof p.proposedActions === 'string' ? JSON.parse(p.proposedActions) : (p.proposedActions || []) }
  catch { actions = [] }
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-white">{p.triggerType || '제안'}</span>
        <span className="text-[10px] text-gray-400">신뢰도 {Math.round((p.confidence || 0) * 100)}%</span>
      </div>
      {p.diagnosis && <p className="text-xs text-gray-300 mb-1">{p.diagnosis}</p>}
      {p.rootCause && <p className="text-[11px] text-gray-400 mb-2">근본원인: {p.rootCause}</p>}
      {actions.length > 0 && (
        <div className="space-y-1 mb-3">
          {actions.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[9px] border ${RISK_CLS[a.riskLevel] || RISK_CLS.LOW}`}>{a.riskLevel || 'LOW'}</span>
              <code className="text-[11px] text-green-400 font-mono break-all">{a.command}</code>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onDecide(p.id, true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600/80 hover:bg-green-600 text-white text-xs font-bold disabled:opacity-50">
          <CheckCircle size={14} /> 승인·실행
        </button>
        <button disabled={busy} onClick={() => onDecide(p.id, false)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-200 text-xs font-bold disabled:opacity-50">
          <XCircle size={14} /> 거부
        </button>
      </div>
    </div>
  )
}

const TABS = [
  { key: 'reactive',   label: '현황·에러',  Icon: AlertTriangle },
  { key: 'predictive', label: '장애 예측',  Icon: TrendingUp },
  { key: 'approval',   label: '검토 승인',  Icon: CheckCircle },
]

export default function AiOpsCenter() {
  const [tab, setTab] = useState('reactive')
  const [reactive, setReactive] = useState([])
  const [predictive, setPredictive] = useState([])
  const [proposals, setProposals] = useState([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    getAiFindings('OPEN', 'REACTIVE').then(r => setReactive(r.data || [])).catch(() => {})
    getAiFindings('OPEN', 'PREDICTIVE').then(r => setPredictive(r.data || [])).catch(() => {})
    getAiProposals('PENDING').then(r => setProposals(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  async function decide(id, approve) {
    setBusy(true)
    try { await (approve ? approveAiProposal(id) : rejectAiProposal(id)); load() }
    finally { setBusy(false) }
  }

  const count = { reactive: reactive.length, predictive: predictive.length, approval: proposals.length }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="text-sky-400" size={22} />
        <h1 className="text-lg font-bold text-white">AI 운영</h1>
        <button onClick={load} className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      <div className="flex gap-2">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition
              ${tab === key ? 'bg-sky-600/80 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
            <Icon size={15} /> {label}
            {count[key] > 0 && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-black/30">{count[key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'reactive' && (
        <div className="grid gap-3 md:grid-cols-2">
          {reactive.length === 0
            ? <p className="text-sm text-gray-500">열린 에러/이상 징후가 없습니다.</p>
            : reactive.map(f => <FindingCard key={f.id} f={f} />)}
        </div>
      )}
      {tab === 'predictive' && (
        <div className="grid gap-3 md:grid-cols-2">
          {predictive.length === 0
            ? <p className="text-sm text-gray-500">예측된 장애 위험이 없습니다.</p>
            : predictive.map(f => <FindingCard key={f.id} f={f} predictive />)}
        </div>
      )}
      {tab === 'approval' && (
        <div className="grid gap-3 md:grid-cols-2">
          {proposals.length === 0
            ? <p className="text-sm text-gray-500 flex items-center gap-1"><Clock size={14} /> 검토 대기 중인 제안이 없습니다.</p>
            : proposals.map(p => <ProposalCard key={p.id} p={p} onDecide={decide} busy={busy} />)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 빌드 검증**

Run: `cd frontend && npm run build`
Expected: 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/AiOpsCenter.jsx
git commit -m "feat(aiops): SP5 AI 운영 센터 페이지(현황·예측·승인 3탭)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 라우트 + 사이드바 메뉴 연결

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Sidebar.jsx`

**Interfaces:**
- Consumes: `AiOpsCenter` (Task 8).
- Produces: 라우트 `/ai` → AiOpsCenter, `/ai-analysis` → `/ai` redirect; 사이드바 'AI 운영' 항목(`/ai`).

- [ ] **Step 1: App.jsx 라우트 수정**

`frontend/src/App.jsx`에서 import 라인

```js
import AiAnalysis        from './pages/AiAnalysis'
```

를 다음으로 교체:

```js
import AiOpsCenter       from './pages/AiOpsCenter'
```

라우트 라인

```jsx
          <Route path="/ai-analysis"           element={<AiAnalysis />} />
```

를 다음 2줄로 교체:

```jsx
          <Route path="/ai"                    element={<AiOpsCenter />} />
          <Route path="/ai-analysis"           element={<Navigate to="/ai" replace />} />
```

(`Navigate`는 파일 상단에서 이미 import됨 — `import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'`.)

- [ ] **Step 2: Sidebar.jsx 메뉴 추가**

`frontend/src/components/Sidebar.jsx`의 아이콘 import에 `Bot` 추가:

```js
import {
  LayoutDashboard, GitBranch, Shield, Zap,
  Activity, Settings, Bot,
  ChevronDown, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
```

`MENU` 배열에서 대시보드 항목 다음 줄에 추가:

```js
  { label: '대시보드', icon: LayoutDashboard, path: '/' },

  { label: 'AI 운영', icon: Bot, path: '/ai' },
```

- [ ] **Step 3: 빌드 검증**

Run: `cd frontend && npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: 수동 확인**

`npm run dev`(또는 배포 nginx)로 띄워 사이드바 'AI 운영' 클릭 → `/ai` 진입, 3탭 전환, 폴링 동작, 제안 승인/거부 버튼 노출 확인.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/App.jsx frontend/src/components/Sidebar.jsx
git commit -m "feat(aiops): SP5 'AI 운영' 사이드바 메뉴 + /ai 라우트(/ai-analysis redirect 흡수)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10 (선택): 사이드카 예측 프롬프트 힌트

> 저장소 밖 배포본(`/opt/nemesis-aibot`)과 원본(`/root/aibot`)을 수정한다. 미적용해도 SP5는 동작하며(예측 신호도 기존 `/ai/scan`이 처리), 예측 품질 향상용 선택 작업이다. 두 곳 동기화 수동.

**Files:**
- Modify: `/root/aibot/nemesis_service.py` (그리고 동일 변경을 `/opt/nemesis-aibot/nemesis_service.py`에 복제)

- [ ] **Step 1: scan() 컨텍스트에 예측 의도 표기**

`nemesis_service.py`의 `/ai/scan` 핸들러에서 `signalType`이 `DISK_TREND`/`MEM_TREND`로 끝나는 경우, `inv = agent.run_investigation({...})` 호출의 컨텍스트에 예측 프레이밍을 추가한다. 기존 루프 내 `sig_type = sig.get("signalType", "OTHER")` 다음에:

```python
        is_predictive = sig_type in ("DISK_TREND", "MEM_TREND")
        focus = {**context, "focusSignal": sig_type}
        if is_predictive:
            focus["mode"] = "predict"
            focus["hint"] = "이 신호는 추세 기반 장애 예측이다. 향후 발생 가능성과 근거, 사전 예방 조치를 제시하라."
        inv = agent.run_investigation(focus, ssh_target) or {}
```

(`run_investigation`이 추가 키를 무시하더라도 안전. 기존 동작 보존.)

- [ ] **Step 2: 배포본 복제 + 사이드카 재기동**

```bash
cp /root/aibot/nemesis_service.py /opt/nemesis-aibot/nemesis_service.py
# 사이드카 재기동(운영 절차에 따름) 후 /health 확인
curl -s http://127.0.0.1:18900/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: 원본 저장소 커밋(/root/aibot)**

```bash
cd /root/aibot && git add nemesis_service.py && git commit -m "feat(nemesis): SP5 예측 신호(/ai/scan) 프롬프트 프레이밍

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 장애 예측(하이브리드): Task 3(규칙 prefilter+ETA) + Task 10(LLM 프레이밍) ✓
- 통합 1페이지 3탭: Task 8 ✓
- 'AI 운영' 메뉴 + /ai-analysis 흡수: Task 9 ✓
- 예측도 proposal 생성: Task 5(HIGH/CRIT → recordHigh → 기존 createFindingProposal 경로) ✓
- category 영속/필터: Task 1, 4, 6 ✓
- 예측 설정값: Task 2 ✓
- 에러 처리(사이드카/LLM 폴백): 기존 `client.scan` null 폴백 유지(Task 5의 investigate), 프론트 `.catch(()=>{})` ✓

**2. Placeholder scan:** 모든 스텝에 실제 코드/명령/기대결과 포함. TBD/TODO 없음. ✓

**3. Type consistency:**
- `recordWarn(Suspect)`/`recordWarn(Suspect,String)`, `recordHigh(Suspect,ScanFinding)`/`recordHigh(Suspect,ScanFinding,String)` — Task 4 정의, Task 5에서 3-인자 호출 일치 ✓
- `etaMinutes(double[],long,double)` — Task 3 정의/테스트 일치 ✓
- `findByStatusAndCategoryOrderByLastSeenAtDesc(String,String)` — Task 6 정의/사용 일치 ✓
- `AiFinding.DISK_TREND/MEM_TREND/REACTIVE/PREDICTIVE` — Task 1 정의, Task 3·4·5·8에서 사용 일치 ✓
- `getAiFindings(status, category)` — Task 7 정의, Task 8 사용 일치 ✓
- `new AiMonitorService(... , predictPrefilter)` — Task 5 생성자/테스트 일치 ✓

이상 없음.
