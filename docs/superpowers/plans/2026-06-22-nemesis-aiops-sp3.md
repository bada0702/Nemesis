# SP3 능동 로그/메트릭 모니터링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nemesis가 주기적으로 노드 메트릭/로그를 결정론 사전필터로 스캔하고, 의심·심각 건만 aibot 사이드카 LLM으로 조사해, 상태추적 Finding으로 알림(심각 시 SP1 승인 제안)을 만든다.

**Architecture:** Nemesis(Java) `@Scheduled` 스케줄러가 1차 결정론 필터(이미 캐시된 메트릭/로그프리뷰/이벤트, SSH·LLM 없음)로 의심 신호를 추리고, HIGH 이상만 사이드카 `POST /ai/scan`(읽기전용 LLM 조사)을 호출한다. 결과는 `AiFinding`(open/resolved)으로 upsert해 dedup하며, HIGH 이상은 SP1 `AiProposal` PENDING으로 합류한다. aibot 불통 시 2차 조사만 생략(HA 무영향).

**Tech Stack:** Spring Boot(Java 17), JPA/Flyway(PostgreSQL), Lombok, JUnit5+Mockito, RestTemplate; aibot FastAPI(Python)+pytest. 빌드/테스트는 호스트에 JDK 없음 → Docker Gradle.

## Global Constraints

- 패키지: `com.nemesis.domain.aiops.monitor` (신규 서브패키지). DTO는 기존 `com.nemesis.domain.aiops.dto.AiOpsDtos`에 추가.
- 상태/타입은 SP1 스타일대로 **String 상수**(enum 미사용). `AiProposal`이 선례.
- 설정 prefix `nemesis.aiops.monitor.*`, 기본 **`enabled=false`**(점진 활성). 모든 임계치/주기 config.
- aibot 사이드카 호출 실패는 항상 `null` 반환 → 상위에서 폴백(HA 무의존). SP1 `AiOperatorClient` 패턴 준수.
- 빌드/테스트 명령(backend 디렉터리에서): `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon`
- Flyway 다음 버전 = **V14**. 마이그레이션은 불변(수정 금지, 새 파일로만).
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 작업 브랜치: `feat/aiops-sp1`에서 이어가거나 `feat/aiops-sp3` 분기(실행 시 결정).

---

## 파일 구조

**신규 (Java, `backend/src/main/java/com/nemesis/domain/aiops/monitor/`):**
- `AiFinding.java` — 엔티티(table `ai_findings`), 상태추적(open/resolved).
- `AiFindingRepository.java` — 파생쿼리.
- `AiPrefilter.java` — 1차 결정론 필터. 메트릭/로그프리뷰/이벤트 → `List<Suspect>` + 예비 severity. CPU 연속지속 상태 보유.
- `AiFindingService.java` — finding upsert/resolve + 심각건 제안 연결.
- `AiMonitorService.java` — 조율: prefilter → HIGH만 사이드카 scan → findingService.
- `AiMonitorScheduler.java` — `@Scheduled` → `AiMonitorService.runScan()`.
- `AiFindingController.java` — `GET /api/ai/findings`.

**신규 (마이그레이션):** `backend/src/main/resources/db/migration/V14__ai_findings.sql`

**수정 (Java):**
- `dto/AiOpsDtos.java` — `Suspect`, `ScanFinding`, `ScanResponse` 레코드 추가.
- `AiOperatorProperties.java` — 중첩 `Monitor` 추가(prefix `nemesis.aiops.monitor`).
- `AiOperatorClient.java` — `scan(...)` 메서드 추가.
- `AiOperatorService.java` — `createFindingProposal(...)` 메서드 추가, `triggerType` "MONITOR".
- `AiNotificationController.java` — 벨 피드에 finding 포함.
- `resources/application.yml` — `nemesis.aiops.monitor.*` 블록.

**신규/수정 (aibot, 전제조건 Task 0 이후):**
- `/root/aibot/nemesis_service.py` — `POST /ai/scan` 추가.
- `/root/aibot/test_nemesis_service.py` — scan 테스트 추가.

**테스트 (Java, `backend/src/test/java/com/nemesis/domain/aiops/monitor/`):** 각 컴포넌트별 `*Test.java`.

---

## Task 0: 전제조건 — SP1 aibot 사이드카 복구 + 버전관리

> SP3는 SP1 사이드카(`nemesis_service.py`) 위에 `/ai/scan`을 더한다. 현재 `/root/aibot` 디스크에 SP1 사이드카 소스가 없음(2026-06-22 구버전 덮어쓰기로 소실). **이 Task 없이는 Task 12(aibot scan) 실행 불가.** Java Task(1~11)는 사이드카 없이도 폴백 경로로 독립 테스트 가능하므로 먼저 진행해도 된다.

**Files:**
- Restore: `/root/aibot/nemesis_service.py`, `/root/aibot/nemesis_ops_tools.py`, `/root/aibot/test_nemesis_service.py`
- Modify: `/root/aibot/requirements.txt`, `/root/aibot/langgraph_agent.py` (`run_investigation`)

- [ ] **Step 1: file-history에서 사이드카 소스 복원**

복구원: Claude file-history 세션 `c0788ec5-94cf-4866-bb78-ecff4a43586a` @ 2026-06-21 08:06.
```bash
H=/root/.claude/file-history/c0788ec5-94cf-4866-bb78-ecff4a43586a
cp "$H/06d650da0c7ca514@v2" /root/aibot/nemesis_service.py   # 90줄, FastAPI 사이드카
cp "$H/7c4124c9136a27b4@v2" /root/aibot/test_nemesis_service.py
# nemesis_ops_tools.py / langgraph_agent.run_investigation 도 같은 세션 디렉터리에서 식별해 복원
grep -l "def remote_exec\|def remote_tail\|def run_investigation" "$H"/*@v* 2>/dev/null
```
> 식별이 모호하면 실행 중 프로세스(pid `pgrep -f 'uvicorn nemesis_service'`)가 보유한 모듈을 참고하되, 디스크에 정본을 둔다.

- [ ] **Step 2: 의존성 설치 후 사이드카 재기동·검증**

```bash
cd /root/aibot && ./venv/bin/pip install -r requirements.txt
pkill -f 'uvicorn nemesis_service'
NEMESIS_AIBOT_TOKEN=$(grep NEMESIS_AIBOT_TOKEN /var/www/html/Nemesis_v100/.env | cut -d= -f2) \
  nohup ./venv/bin/uvicorn nemesis_service:app --host 0.0.0.0 --port 18900 >/root/aibot/logs/nemesis_service.log 2>&1 &
sleep 2 && curl -s http://127.0.0.1:18900/health
```
Expected: `{"status":"ok"}` — 그리고 **재기동 후에도** 떠야 한다(소스가 디스크에 있으므로).

- [ ] **Step 3: `/root/aibot` git 적용(재발 방지)**

```bash
cd /root/aibot
[ -d .git ] || git init
printf 'venv/\n__pycache__/\nlogs/\n*.log\ndata/\ntoken_google.json\ncredentials.json\n.env\n' >> .gitignore
git add -A && git commit -m "chore: restore SP1 nemesis sidecar + init version control

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: 커밋 생성. 이후 SP3 aibot 변경은 이 저장소에 커밋한다.

---

## Task 1: DTO + Monitor 설정

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/dto/AiOpsDtos.java`
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorProperties.java`
- Modify: `backend/src/main/resources/application.yml:53` (aiops 블록 내)
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorPropertiesTest.java`

**Interfaces:**
- Produces:
  - `AiOpsDtos.Suspect(UUID nodeId, UUID clusterId, String hostname, String role, String signalType, String severity, Map<String,Object> detail)`
  - `AiOpsDtos.ScanFinding(String signalType, String severity, String summary, String diagnosis, String rootCause, List<Action> proposedActions, double confidence)`
  - `AiOpsDtos.ScanResponse(List<ScanFinding> findings)`
  - `AiOperatorProperties.Monitor` getter `getMonitor()` with: `enabled`(false), `intervalMs`(300000), `diskThreshold`(90), `memThreshold`(90), `cpuThreshold`(90), `cpuSustainedCycles`(3), `criticalBandOffset`(5), `errorPatternCount`(3), `eventSpikeWindowMs`(600000), `eventSpikeCount`(5)

- [ ] **Step 1: 실패 테스트 작성 (Monitor 기본값)**

`AiOperatorPropertiesTest.java`:
```java
package com.nemesis.domain.aiops;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class AiOperatorPropertiesTest {
    @Test
    void monitorDefaults() {
        AiOperatorProperties.Monitor m = new AiOperatorProperties().getMonitor();
        assertThat(m.isEnabled()).isFalse();
        assertThat(m.getIntervalMs()).isEqualTo(300_000L);
        assertThat(m.getDiskThreshold()).isEqualTo(90);
        assertThat(m.getCpuSustainedCycles()).isEqualTo(3);
        assertThat(m.getCriticalBandOffset()).isEqualTo(5);
    }
}
```

- [ ] **Step 2: 컴파일 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiOperatorPropertiesTest'`
Expected: 컴파일 실패 — `getMonitor()` 없음.

- [ ] **Step 3: DTO 레코드 추가**

`AiOpsDtos.java`에 추가(기존 `Action` 재사용):
```java
import java.util.UUID;
// ...
public record Suspect(UUID nodeId, UUID clusterId, String hostname, String role,
                      String signalType, String severity, Map<String,Object> detail) {}
public record ScanFinding(String signalType, String severity, String summary,
                          String diagnosis, String rootCause,
                          List<Action> proposedActions, double confidence) {}
public record ScanResponse(List<ScanFinding> findings) {}
```

- [ ] **Step 4: Monitor 중첩 설정 추가**

`AiOperatorProperties.java`에 추가:
```java
private final Monitor monitor = new Monitor();
public Monitor getMonitor() { return monitor; }

@Getter @Setter
public static class Monitor {
    private boolean enabled = false;
    private long intervalMs = 300_000L;
    private int diskThreshold = 90;
    private int memThreshold = 90;
    private int cpuThreshold = 90;
    private int cpuSustainedCycles = 3;
    private int criticalBandOffset = 5;
    private int errorPatternCount = 3;
    private long eventSpikeWindowMs = 600_000L;
    private int eventSpikeCount = 5;
}
```

- [ ] **Step 5: application.yml 블록 추가**

`application.yml` `aiops:` 블록 끝(line 59 아래)에:
```yaml
    monitor:
      enabled: ${NEMESIS_AIOPS_MONITOR_ENABLED:false}
      interval-ms: ${NEMESIS_AIOPS_MONITOR_INTERVAL_MS:300000}
      disk-threshold: ${NEMESIS_AIOPS_MONITOR_DISK:90}
      mem-threshold: ${NEMESIS_AIOPS_MONITOR_MEM:90}
      cpu-threshold: ${NEMESIS_AIOPS_MONITOR_CPU:90}
      cpu-sustained-cycles: ${NEMESIS_AIOPS_MONITOR_CPU_CYCLES:3}
      critical-band-offset: ${NEMESIS_AIOPS_MONITOR_CRIT_OFFSET:5}
      error-pattern-count: ${NEMESIS_AIOPS_MONITOR_ERR_COUNT:3}
      event-spike-window-ms: ${NEMESIS_AIOPS_MONITOR_SPIKE_WINDOW_MS:600000}
      event-spike-count: ${NEMESIS_AIOPS_MONITOR_SPIKE_COUNT:5}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiOperatorPropertiesTest'`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/dto/AiOpsDtos.java \
        backend/src/main/java/com/nemesis/domain/aiops/AiOperatorProperties.java \
        backend/src/main/resources/application.yml \
        backend/src/test/java/com/nemesis/domain/aiops/AiOperatorPropertiesTest.java
git commit -m "feat(aiops): SP3 scan DTO + monitor 설정

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: AiFinding 엔티티 + 리포지토리 + V14 마이그레이션

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFinding.java`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingRepository.java`
- Create: `backend/src/main/resources/db/migration/V14__ai_findings.sql`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingTest.java`

**Interfaces:**
- Produces:
  - `AiFinding` 상수 `OPEN/RESOLVED`, signalType 상수 `DISK_FULL/MEM_HIGH/CPU_SUSTAINED/LOG_ERROR_PATTERN/EVENT_SPIKE/OTHER`, severity 상수 `INFO/WARN/HIGH/CRITICAL`. 빌더 + `prePersist`(id/createdAt/firstSeenAt/lastSeenAt/status 기본).
  - `AiFinding.fingerprint(UUID nodeId, String signalType)` static → `"<nodeId>:<signalType>"`.
  - `AiFindingRepository.findByFingerprintAndStatus(String fp, String status)` → `Optional<AiFinding>`
  - `findByStatusOrderByLastSeenAtDesc(String status)` → `List<AiFinding>`
  - `findTop50ByOrderByLastSeenAtDesc()` → `List<AiFinding>`
  - `countByStatus(String status)` → `long`

- [ ] **Step 1: 실패 테스트 작성**

`AiFindingTest.java`:
```java
package com.nemesis.domain.aiops.monitor;

import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

class AiFindingTest {
    @Test
    void prePersistSetsDefaults() {
        AiFinding f = AiFinding.builder()
                .nodeId(UUID.randomUUID()).signalType(AiFinding.DISK_FULL)
                .severity(AiFinding.WARN).summary("디스크 91%").build();
        f.prePersist();
        assertThat(f.getId()).isNotNull();
        assertThat(f.getStatus()).isEqualTo(AiFinding.OPEN);
        assertThat(f.getCreatedAt()).isNotNull();
        assertThat(f.getFirstSeenAt()).isNotNull();
        assertThat(f.getLastSeenAt()).isNotNull();
    }
    @Test
    void fingerprintIsNodeAndSignal() {
        UUID n = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
        assertThat(AiFinding.fingerprint(n, AiFinding.MEM_HIGH)).isEqualTo(n + ":MEM_HIGH");
    }
}
```

- [ ] **Step 2: 컴파일/테스트 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiFindingTest'`
Expected: 컴파일 실패 — `AiFinding` 없음.

- [ ] **Step 3: 엔티티 작성**

`AiFinding.java`:
```java
package com.nemesis.domain.aiops.monitor;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** SP3: 능동 모니터링이 발견한 이상 징후(상태추적 open/resolved). */
@Entity
@Table(name = "ai_findings")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiFinding {

    public static final String OPEN = "OPEN", RESOLVED = "RESOLVED";
    public static final String DISK_FULL = "DISK_FULL", MEM_HIGH = "MEM_HIGH",
            CPU_SUSTAINED = "CPU_SUSTAINED", LOG_ERROR_PATTERN = "LOG_ERROR_PATTERN",
            EVENT_SPIKE = "EVENT_SPIKE", OTHER = "OTHER";
    public static final String INFO = "INFO", WARN = "WARN", HIGH = "HIGH", CRITICAL = "CRITICAL";

    public static String fingerprint(UUID nodeId, String signalType) {
        return nodeId + ":" + signalType;
    }

    @Id private UUID id;
    @Column(name = "cluster_group_id") private UUID clusterId;
    @Column(name = "node_id") private UUID nodeId;

    @Column(name = "signal_type", nullable = false, length = 30) private String signalType;
    @Column(nullable = false, length = 200) private String fingerprint;
    @Column(nullable = false, length = 10) private String severity;
    @Column(nullable = false, length = 10) private String status;

    @Column(columnDefinition = "TEXT") private String summary;
    @Column(columnDefinition = "TEXT") private String diagnosis;
    @Column(name = "root_cause", columnDefinition = "TEXT") private String rootCause;
    @Column(name = "proposal_id") private UUID proposalId;
    @Column(columnDefinition = "TEXT") private String detail;  // JSON

    @Column(name = "first_seen_at") private OffsetDateTime firstSeenAt;
    @Column(name = "last_seen_at") private OffsetDateTime lastSeenAt;
    @Column(name = "resolved_at") private OffsetDateTime resolvedAt;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;

    @PrePersist void prePersist() {
        OffsetDateTime now = OffsetDateTime.now();
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = now;
        if (firstSeenAt == null) firstSeenAt = now;
        if (lastSeenAt == null) lastSeenAt = now;
        if (status == null) status = OPEN;
        if (fingerprint == null && nodeId != null && signalType != null)
            fingerprint = fingerprint(nodeId, signalType);
    }
}
```
> `prePersist`는 JPA 콜백이지만 단위 테스트에서 직접 호출 가능하도록 package-private 유지.

- [ ] **Step 4: 리포지토리 작성**

`AiFindingRepository.java`:
```java
package com.nemesis.domain.aiops.monitor;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AiFindingRepository extends JpaRepository<AiFinding, UUID> {
    Optional<AiFinding> findByFingerprintAndStatus(String fingerprint, String status);
    List<AiFinding> findByStatusOrderByLastSeenAtDesc(String status);
    List<AiFinding> findTop50ByOrderByLastSeenAtDesc();
    long countByStatus(String status);
}
```

- [ ] **Step 5: V14 마이그레이션 작성**

`V14__ai_findings.sql` (V11 `ai_proposals` 스타일 참조):
```sql
-- SP3: 능동 모니터링 finding (상태추적 open/resolved)
CREATE TABLE ai_findings (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID,
    node_id          UUID,
    signal_type      VARCHAR(30)  NOT NULL,
    fingerprint      VARCHAR(200) NOT NULL,
    severity         VARCHAR(10)  NOT NULL,
    status           VARCHAR(10)  NOT NULL,
    summary          TEXT,
    diagnosis        TEXT,
    root_cause       TEXT,
    proposal_id      UUID,
    detail           TEXT,
    first_seen_at    TIMESTAMPTZ,
    last_seen_at     TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 노드별 같은 신호의 OPEN은 동시에 1건만(부분 유니크)
CREATE UNIQUE INDEX ux_ai_findings_open ON ai_findings (node_id, signal_type) WHERE status = 'OPEN';
CREATE INDEX ix_ai_findings_status ON ai_findings (status, last_seen_at DESC);
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiFindingTest'`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFinding.java \
        backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingRepository.java \
        backend/src/main/resources/db/migration/V14__ai_findings.sql \
        backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingTest.java
git commit -m "feat(aiops): SP3 AiFinding 엔티티 + V14 마이그레이션

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: AiPrefilter (1차 결정론 필터)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiPrefilter.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiPrefilterTest.java`

**Interfaces:**
- Consumes: `MetricsCacheService` (`Map<UUID,MetricsPushRequest> getAll()`), `NodeRepository` (`findAll()`), `AiOperatorProperties` (`getMonitor()`). `MetricsPushRequest` 게터: `getCpuPercent()/getMemoryPercent()/getDiskPercent()` (double), `getErrorLogPreview()` (List<String>).
- Produces: `AiPrefilter.evaluate()` → `List<Suspect>`. 예비 severity 밴딩: 임계 도달=`WARN`, 임계+`criticalBandOffset` 이상=`HIGH`. CPU는 `cpuSustainedCycles`회 연속 임계 초과 시에만 발생(연속 카운트는 컴포넌트 내부 `Map<UUID,Integer>` 상태). LOG_ERROR_PATTERN: `errorLogPreview` 크기 ≥ `errorPatternCount`이면 발생(severity WARN).

- [ ] **Step 1: 실패 테스트 작성**

`AiPrefilterTest.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiPrefilterTest {
    MetricsCacheService metrics; NodeRepository nodeRepo; AiOperatorProperties props; AiPrefilter prefilter;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        metrics = mock(MetricsCacheService.class);
        nodeRepo = mock(NodeRepository.class);
        props = new AiOperatorProperties();
        Node node = mock(Node.class);
        when(node.getId()).thenReturn(nodeId);
        when(node.getHostname()).thenReturn("db2");
        com.nemesis.domain.cluster.Cluster c = mock(com.nemesis.domain.cluster.Cluster.class);
        when(c.getId()).thenReturn(clusterId);
        when(node.getCluster()).thenReturn(c);
        when(node.getRole()).thenReturn(Node.Role.active);
        when(nodeRepo.findAll()).thenReturn(List.of(node));
        prefilter = new AiPrefilter(metrics, nodeRepo, props);
    }
    private MetricsPushRequest m(double cpu, double mem, double disk) {
        MetricsPushRequest r = new MetricsPushRequest();
        r.setCpuPercent(cpu); r.setMemoryPercent(mem); r.setDiskPercent(disk);
        return r;
    }

    @Test void diskAtThresholdIsWarn() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(10, 10, 91)));
        List<Suspect> s = prefilter.evaluate();
        assertThat(s).hasSize(1);
        assertThat(s.get(0).signalType()).isEqualTo(AiFinding.DISK_FULL);
        assertThat(s.get(0).severity()).isEqualTo(AiFinding.WARN);
    }
    @Test void diskInCriticalBandIsHigh() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(10, 10, 96))); // 90+5 이상
        assertThat(prefilter.evaluate().get(0).severity()).isEqualTo(AiFinding.HIGH);
    }
    @Test void normalMetricsNoSuspect() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(10, 10, 10)));
        assertThat(prefilter.evaluate()).isEmpty();
    }
    @Test void cpuRequiresSustainedCycles() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(95, 10, 10)));
        assertThat(prefilter.evaluate()).isEmpty();           // 1회
        assertThat(prefilter.evaluate()).isEmpty();           // 2회
        List<Suspect> third = prefilter.evaluate();           // 3회 → 발생
        assertThat(third).anyMatch(x -> x.signalType().equals(AiFinding.CPU_SUSTAINED));
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiPrefilterTest'`
Expected: 컴파일 실패 — `AiPrefilter` 없음.

- [ ] **Step 3: 구현 작성**

`AiPrefilter.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** SP3 1차 결정론 필터: 이미 캐시된 메트릭/로그프리뷰로 의심 신호 추출(SSH·LLM 없음). */
@Component
public class AiPrefilter {
    private final MetricsCacheService metrics;
    private final NodeRepository nodeRepo;
    private final AiOperatorProperties props;
    private final Map<UUID, Integer> cpuStreak = new ConcurrentHashMap<>();

    public AiPrefilter(MetricsCacheService metrics, NodeRepository nodeRepo, AiOperatorProperties props) {
        this.metrics = metrics; this.nodeRepo = nodeRepo; this.props = props;
    }

    public List<Suspect> evaluate() {
        AiOperatorProperties.Monitor cfg = props.getMonitor();
        Map<UUID, MetricsPushRequest> all = metrics.getAll();
        List<Suspect> out = new ArrayList<>();
        for (Node node : nodeRepo.findAll()) {
            MetricsPushRequest mx = all.get(node.getId());
            if (mx == null) continue;
            UUID cid = node.getCluster() != null ? node.getCluster().getId() : null;
            String role = node.getRole() != null ? node.getRole().name() : "?";

            band(mx.getDiskPercent(), cfg.getDiskThreshold(), cfg.getCriticalBandOffset())
                .ifPresent(sev -> out.add(suspect(node, cid, role, AiFinding.DISK_FULL, sev,
                        Map.of("disk", mx.getDiskPercent()))));
            band(mx.getMemoryPercent(), cfg.getMemThreshold(), cfg.getCriticalBandOffset())
                .ifPresent(sev -> out.add(suspect(node, cid, role, AiFinding.MEM_HIGH, sev,
                        Map.of("mem", mx.getMemoryPercent()))));

            if (mx.getCpuPercent() >= cfg.getCpuThreshold()) {
                int streak = cpuStreak.merge(node.getId(), 1, Integer::sum);
                if (streak >= cfg.getCpuSustainedCycles()) {
                    String sev = band(mx.getCpuPercent(), cfg.getCpuThreshold(), cfg.getCriticalBandOffset())
                            .orElse(AiFinding.WARN);
                    out.add(suspect(node, cid, role, AiFinding.CPU_SUSTAINED, sev,
                            Map.of("cpu", mx.getCpuPercent(), "cycles", streak)));
                }
            } else {
                cpuStreak.remove(node.getId());
            }

            List<String> errs = mx.getErrorLogPreview();
            if (errs != null && errs.size() >= cfg.getErrorPatternCount()) {
                out.add(suspect(node, cid, role, AiFinding.LOG_ERROR_PATTERN, AiFinding.WARN,
                        Map.of("errorCount", errs.size())));
            }
        }
        return out;
    }

    private Optional<String> band(double value, int threshold, int offset) {
        if (value >= threshold + offset) return Optional.of(AiFinding.HIGH);
        if (value >= threshold) return Optional.of(AiFinding.WARN);
        return Optional.empty();
    }
    private Suspect suspect(Node n, UUID cid, String role, String type, String sev, Map<String,Object> d) {
        return new Suspect(n.getId(), cid, n.getHostname(), role, type, sev, d);
    }
}
```
> EVENT_SPIKE는 Task 8에서 이벤트 소스 결선 시 추가(여기선 메트릭 기반 신호만). YAGNI: 이벤트 급증은 후속 보강으로 분리.

- [ ] **Step 4: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiPrefilterTest'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiPrefilter.java \
        backend/src/test/java/com/nemesis/domain/aiops/monitor/AiPrefilterTest.java
git commit -m "feat(aiops): SP3 1차 결정론 사전필터

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: AiOperatorClient.scan() + AiOperatorService.createFindingProposal()

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorClient.java`
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorService.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientScanTest.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorServiceProposalTest.java`

**Interfaces:**
- Produces:
  - `AiOperatorClient.scan(Map<String,Object> ctx, Map<String,Object> sshTarget)` → `ScanResponse` (실패 시 `null`)
  - `AiOperatorService.createFindingProposal(UUID clusterId, UUID nodeId, String triggerReason, ScanFinding f)` → `AiProposal` (PENDING 저장, `triggerType="MONITOR"`)

- [ ] **Step 1: 실패 테스트 작성 (client.scan)**

`AiOperatorClientScanTest.java`:
```java
package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanResponse;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiOperatorClientScanTest {
    @Test void scanReturnsNullOnError() {
        RestTemplate rt = mock(RestTemplate.class);
        AiOperatorProperties props = new AiOperatorProperties();
        when(rt.postForObject(anyString(), any(), eq(ScanResponse.class)))
                .thenThrow(new RuntimeException("down"));
        AiOperatorClient client = new AiOperatorClient(rt, props);
        assertThat(client.scan(Map.of(), Map.of())).isNull();   // 폴백
    }
    @Test void scanPostsToScanEndpoint() {
        RestTemplate rt = mock(RestTemplate.class);
        AiOperatorProperties props = new AiOperatorProperties();
        ScanResponse resp = new ScanResponse(java.util.List.of());
        when(rt.postForObject(contains("/ai/scan"), any(), eq(ScanResponse.class))).thenReturn(resp);
        AiOperatorClient client = new AiOperatorClient(rt, props);
        assertThat(client.scan(Map.of(), Map.of())).isSameAs(resp);
    }
}
```

- [ ] **Step 2: 실패 테스트 작성 (service.createFindingProposal)**

`AiOperatorServiceProposalTest.java`:
```java
package com.nemesis.domain.aiops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Action;
import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanFinding;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class AiOperatorServiceProposalTest {
    @Test void createsPendingProposalFromFinding() {
        AiProposalRepository repo = mock(AiProposalRepository.class);
        when(repo.save(any(AiProposal.class))).thenAnswer(i -> i.getArgument(0));
        AiOperatorService svc = new AiOperatorService(repo, mock(AiOperatorClient.class),
                new AiOperatorProperties(), mock(NodeRepository.class), new ObjectMapper());

        ScanFinding f = new ScanFinding(com.nemesis.domain.aiops.monitor.AiFinding.DISK_FULL,
                "HIGH", "/u01 96%", "진단", "원인",
                List.of(new Action("정리", "rm ...", "db2", "MEDIUM")), 0.8);
        AiProposal p = svc.createFindingProposal(UUID.randomUUID(), UUID.randomUUID(), "DISK_FULL 96%", f);

        assertThat(p.getStatus()).isEqualTo(AiProposal.PENDING);
        assertThat(p.getTriggerType()).isEqualTo("MONITOR");
        assertThat(p.getProposedActions()).contains("rm ...");
        verify(repo).save(any(AiProposal.class));
    }
}
```

- [ ] **Step 3: 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiOperatorClientScanTest' --tests '*AiOperatorServiceProposalTest'`
Expected: 컴파일 실패 — `scan`/`createFindingProposal` 없음.

- [ ] **Step 4: client.scan 구현**

`AiOperatorClient.java`에 추가(import `ScanResponse`):
```java
public ScanResponse scan(Map<String, Object> ctx, Map<String, Object> sshTarget) {
    try {
        HttpEntity<Map<String, Object>> req =
                new HttpEntity<>(Map.of("context", ctx, "sshTarget", sshTarget), headers());
        return rt.postForObject(props.getBaseUrl() + "/ai/scan", req, ScanResponse.class);
    } catch (Exception e) {
        log.warn("aibot scan 실패(폴백): {}", e.getMessage());
        return null;
    }
}
```

- [ ] **Step 5: service.createFindingProposal 구현**

`AiOperatorService.java`에 추가(`ScanFinding` import):
```java
@Transactional
public AiProposal createFindingProposal(UUID clusterId, UUID nodeId, String triggerReason, ScanFinding f) {
    AiProposal p = AiProposal.builder()
            .id(UUID.randomUUID()).clusterId(clusterId).nodeId(nodeId)
            .triggerType("MONITOR").triggerReason(triggerReason)
            .diagnosis(f.diagnosis()).rootCause(f.rootCause()).confidence(f.confidence())
            .proposedActions(toJson(f.proposedActions()))
            .status(AiProposal.PENDING)
            .expiresAt(OffsetDateTime.now().plusMinutes(props.getProposalTtlMinutes()))
            .build();
    return repo.save(p);
}
```
> 기존 private `toJson(List<Action>)` 재사용.

- [ ] **Step 6: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiOperatorClientScanTest' --tests '*AiOperatorServiceProposalTest'`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/AiOperatorClient.java \
        backend/src/main/java/com/nemesis/domain/aiops/AiOperatorService.java \
        backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientScanTest.java \
        backend/src/test/java/com/nemesis/domain/aiops/AiOperatorServiceProposalTest.java
git commit -m "feat(aiops): SP3 client.scan + finding 제안 생성

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: AiFindingService (upsert / resolve / 제안 연결)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingService.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingServiceTest.java`

**Interfaces:**
- Consumes: `AiFindingRepository`, `AiOperatorService` (`createFindingProposal(...)`), `ObjectMapper`.
- Produces:
  - `recordWarn(Suspect s)` — WARN 이하: 신규면 OPEN 저장, 기존 OPEN이면 `lastSeenAt`만 갱신(중복/재알림 없음).
  - `recordHigh(Suspect s, ScanFinding f)` — HIGH 이상: 신규면 OPEN 저장 + `createFindingProposal` → `proposalId` 연결; 기존 OPEN이면 `lastSeenAt` 갱신(제안 중복 생성 안 함).
  - `reconcileResolved(Set<String> activeFingerprints)` — 현재 스캔에 없는 OPEN finding을 RESOLVED + `resolvedAt`.

- [ ] **Step 1: 실패 테스트 작성**

`AiFindingServiceTest.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.AiOperatorService;
import com.nemesis.domain.aiops.AiProposal;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Action;
import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanFinding;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiFindingServiceTest {
    AiFindingRepository repo; AiOperatorService ops; AiFindingService svc;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        repo = mock(AiFindingRepository.class);
        ops = mock(AiOperatorService.class);
        when(repo.save(any(AiFinding.class))).thenAnswer(i -> i.getArgument(0));
        svc = new AiFindingService(repo, ops, new ObjectMapper());
    }
    private Suspect warn() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.MEM_HIGH, AiFinding.WARN, Map.of("mem", 91.0));
    }
    private Suspect high() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.DISK_FULL, AiFinding.HIGH, Map.of("disk", 96.0));
    }

    @Test void newWarnCreatesOpenFinding() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        svc.recordWarn(warn());
        verify(repo).save(argThat(f -> f.getStatus().equals(AiFinding.OPEN)
                && f.getSignalType().equals(AiFinding.MEM_HIGH)));
    }
    @Test void existingOpenWarnUpdatesLastSeenOnly() {
        AiFinding existing = AiFinding.builder().id(UUID.randomUUID()).nodeId(nodeId)
                .signalType(AiFinding.MEM_HIGH).severity(AiFinding.WARN).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(nodeId, AiFinding.MEM_HIGH))
                .firstSeenAt(java.time.OffsetDateTime.now().minusHours(1)).build();
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.of(existing));
        svc.recordWarn(warn());
        verify(repo).save(argThat(f -> f.getLastSeenAt() != null));
        verifyNoInteractions(ops);   // 제안 안 만듦
    }
    @Test void newHighCreatesFindingAndProposal() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        AiProposal p = AiProposal.builder().id(UUID.randomUUID()).status(AiProposal.PENDING).build();
        when(ops.createFindingProposal(any(), any(), anyString(), any())).thenReturn(p);
        ScanFinding f = new ScanFinding(AiFinding.DISK_FULL, "HIGH", "/u01 96%", "진단", "원인",
                List.of(new Action("정리", "rm", "db2", "MEDIUM")), 0.8);
        svc.recordHigh(high(), f);
        verify(ops).createFindingProposal(eq(clusterId), eq(nodeId), anyString(), eq(f));
        verify(repo).save(argThat(x -> p.getId().equals(x.getProposalId())));
    }
    @Test void reconcileResolvesMissingOpen() {
        AiFinding open = AiFinding.builder().id(UUID.randomUUID()).nodeId(nodeId)
                .signalType(AiFinding.MEM_HIGH).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(nodeId, AiFinding.MEM_HIGH)).build();
        when(repo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN)).thenReturn(List.of(open));
        svc.reconcileResolved(Set.of());   // 활성 지문 없음 → 해소
        verify(repo).save(argThat(f -> f.getStatus().equals(AiFinding.RESOLVED) && f.getResolvedAt() != null));
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiFindingServiceTest'`
Expected: 컴파일 실패 — `AiFindingService` 없음.

- [ ] **Step 3: 구현 작성**

`AiFindingService.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.AiOperatorService;
import com.nemesis.domain.aiops.AiProposal;
import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanFinding;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

/** SP3: finding 상태추적(open/resolved) + 심각건 제안 연결. */
@Slf4j
@Service
public class AiFindingService {
    private final AiFindingRepository repo;
    private final AiOperatorService ops;
    private final ObjectMapper mapper;

    public AiFindingService(AiFindingRepository repo, AiOperatorService ops, ObjectMapper mapper) {
        this.repo = repo; this.ops = ops; this.mapper = mapper;
    }

    @Transactional
    public void recordWarn(Suspect s) {
        AiFinding f = touchOrCreate(s);
        f.setSummary(summary(s));
        repo.save(f);
    }

    @Transactional
    public void recordHigh(Suspect s, ScanFinding sf) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        Optional<AiFinding> open = repo.findByFingerprintAndStatus(fp, AiFinding.OPEN);
        if (open.isPresent()) {                 // 이미 열림 → 갱신만(제안 중복 방지)
            AiFinding f = open.get();
            f.setLastSeenAt(OffsetDateTime.now());
            if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
            repo.save(f);
            return;
        }
        AiFinding f = newFinding(s);
        f.setSeverity(sf != null ? sf.severity() : s.severity());
        f.setSummary(sf != null ? sf.summary() : summary(s));
        if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
        if (sf != null && sf.proposedActions() != null && !sf.proposedActions().isEmpty()) {
            AiProposal p = ops.createFindingProposal(s.clusterId(), s.nodeId(), summary(s), sf);
            if (p != null) f.setProposalId(p.getId());
        }
        repo.save(f);
    }

    @Transactional
    public void reconcileResolved(Set<String> activeFingerprints) {
        for (AiFinding f : repo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN)) {
            if (!activeFingerprints.contains(f.getFingerprint())) {
                f.setStatus(AiFinding.RESOLVED);
                f.setResolvedAt(OffsetDateTime.now());
                repo.save(f);
            }
        }
    }

    private AiFinding touchOrCreate(Suspect s) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        return repo.findByFingerprintAndStatus(fp, AiFinding.OPEN).map(f -> {
            f.setLastSeenAt(OffsetDateTime.now());
            return f;
        }).orElseGet(() -> newFinding(s));
    }
    private AiFinding newFinding(Suspect s) {
        AiFinding f = AiFinding.builder()
                .id(UUID.randomUUID()).clusterId(s.clusterId()).nodeId(s.nodeId())
                .signalType(s.signalType()).severity(s.severity()).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(s.nodeId(), s.signalType()))
                .detail(toJson(s.detail()))
                .firstSeenAt(OffsetDateTime.now()).lastSeenAt(OffsetDateTime.now())
                .createdAt(OffsetDateTime.now())
                .build();
        return f;
    }
    private String summary(Suspect s) { return s.signalType() + " @ " + s.hostname() + " " + s.detail(); }
    private String toJson(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiFindingServiceTest'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingService.java \
        backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingServiceTest.java
git commit -m "feat(aiops): SP3 AiFindingService (upsert/resolve/제안연결)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: AiMonitorService (조율)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiMonitorService.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiMonitorServiceTest.java`

**Interfaces:**
- Consumes: `AiPrefilter` (`evaluate()`), `AiOperatorClient` (`scan(...)`), `AiFindingService` (`recordWarn/recordHigh/reconcileResolved`), `AiOperatorProperties`, `NodeRepository`.
- Produces: `runScan()` — prefilter → WARN은 `recordWarn`; HIGH 이상은 `scan` 호출 후 매칭 ScanFinding으로 `recordHigh`(scan null/미매칭이면 1차 정보로 `recordHigh(s, null)` 폴백) → `reconcileResolved(활성 지문 집합)`.

- [ ] **Step 1: 실패 테스트 작성**

`AiMonitorServiceTest.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorClient;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiMonitorServiceTest {
    AiPrefilter prefilter; AiOperatorClient client; AiFindingService findings;
    AiOperatorProperties props; NodeRepository nodeRepo; AiMonitorService svc;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        prefilter = mock(AiPrefilter.class); client = mock(AiOperatorClient.class);
        findings = mock(AiFindingService.class); nodeRepo = mock(NodeRepository.class);
        props = new AiOperatorProperties();
        Node node = mock(Node.class);
        when(node.getId()).thenReturn(nodeId);
        when(node.getServiceIp()).thenReturn("10.0.0.12");
        when(nodeRepo.findById(nodeId)).thenReturn(Optional.of(node));
        svc = new AiMonitorService(prefilter, client, findings, props, nodeRepo);
    }
    private Suspect warn() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.MEM_HIGH, AiFinding.WARN, Map.of());
    }
    private Suspect high() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.DISK_FULL, AiFinding.HIGH, Map.of());
    }

    @Test void warnGoesStraightToFindingNoScan() {
        when(prefilter.evaluate()).thenReturn(List.of(warn()));
        svc.runScan();
        verify(findings).recordWarn(any(Suspect.class));
        verify(client, never()).scan(any(), any());
    }
    @Test void highCallsScanThenRecordHigh() {
        when(prefilter.evaluate()).thenReturn(List.of(high()));
        ScanFinding sf = new ScanFinding(AiFinding.DISK_FULL, "HIGH", "s", "d", "r", List.of(), 0.8);
        when(client.scan(any(), any())).thenReturn(new ScanResponse(List.of(sf)));
        svc.runScan();
        verify(findings).recordHigh(any(Suspect.class), eq(sf));
    }
    @Test void aibotDownFallsBackToPrefilterInfo() {
        when(prefilter.evaluate()).thenReturn(List.of(high()));
        when(client.scan(any(), any())).thenReturn(null);   // 사이드카 불통
        svc.runScan();
        verify(findings).recordHigh(any(Suspect.class), isNull());   // 1차 정보만
    }
    @Test void reconcileCalledWithActiveFingerprints() {
        when(prefilter.evaluate()).thenReturn(List.of(warn()));
        svc.runScan();
        verify(findings).reconcileResolved(argThat(set ->
                set.contains(AiFinding.fingerprint(nodeId, AiFinding.MEM_HIGH))));
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiMonitorServiceTest'`
Expected: 컴파일 실패 — `AiMonitorService` 없음.

- [ ] **Step 3: 구현 작성**

`AiMonitorService.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorClient;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/** SP3 조율: 1차 필터 → HIGH만 사이드카 조사 → finding upsert/resolve. */
@Slf4j
@Service
public class AiMonitorService {
    private final AiPrefilter prefilter;
    private final AiOperatorClient client;
    private final AiFindingService findings;
    private final AiOperatorProperties props;
    private final NodeRepository nodeRepo;

    public AiMonitorService(AiPrefilter prefilter, AiOperatorClient client, AiFindingService findings,
                            AiOperatorProperties props, NodeRepository nodeRepo) {
        this.prefilter = prefilter; this.client = client; this.findings = findings;
        this.props = props; this.nodeRepo = nodeRepo;
    }

    public void runScan() {
        List<Suspect> suspects = prefilter.evaluate();
        Set<String> active = new HashSet<>();
        for (Suspect s : suspects) {
            active.add(AiFinding.fingerprint(s.nodeId(), s.signalType()));
            boolean high = AiFinding.HIGH.equals(s.severity()) || AiFinding.CRITICAL.equals(s.severity());
            if (!high) { findings.recordWarn(s); continue; }
            ScanFinding sf = investigate(s);
            findings.recordHigh(s, sf);
        }
        findings.reconcileResolved(active);
    }

    private ScanFinding investigate(Suspect s) {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("clusterId", s.clusterId()); ctx.put("nodeId", s.nodeId());
        ctx.put("hostname", s.hostname()); ctx.put("role", s.role());
        ctx.put("suspectSignals", List.of(Map.of("signalType", s.signalType(), "detail", s.detail())));
        ScanResponse r = client.scan(ctx, sshTarget(s.nodeId()));
        if (r == null || r.findings() == null) return null;   // 폴백: 1차 정보만
        return r.findings().stream()
                .filter(f -> s.signalType().equals(f.signalType()))
                .findFirst().orElse(null);
    }

    private Map<String, Object> sshTarget(UUID nodeId) {
        Node node = nodeId != null ? nodeRepo.findById(nodeId).orElse(null) : null;
        Map<String, Object> t = new HashMap<>();
        t.put("host", node != null ? node.getServiceIp() : null);
        t.put("port", 22);
        t.put("user", props.getSshUser());
        return t;
    }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiMonitorServiceTest'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiMonitorService.java \
        backend/src/test/java/com/nemesis/domain/aiops/monitor/AiMonitorServiceTest.java
git commit -m "feat(aiops): SP3 AiMonitorService 조율(prefilter→scan→finding)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: AiMonitorScheduler (@Scheduled)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiMonitorScheduler.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiMonitorSchedulerTest.java`

**Interfaces:**
- Consumes: `AiMonitorService` (`runScan()`), `AiOperatorProperties` (`getMonitor().isEnabled()`).
- Produces: `tick()` — `@Scheduled(fixedDelayString="${nemesis.aiops.monitor.interval-ms:300000}")`; `enabled=false`면 즉시 return.

> `@Scheduled`는 메인 앱에 `@EnableScheduling`이 이미 있어야 동작한다(HealthMonitorService가 쓰므로 존재). 새로 추가하지 말 것.

- [ ] **Step 1: 실패 테스트 작성**

`AiMonitorSchedulerTest.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorProperties;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;

class AiMonitorSchedulerTest {
    @Test void skipsWhenDisabled() {
        AiMonitorService svc = mock(AiMonitorService.class);
        AiOperatorProperties props = new AiOperatorProperties();   // monitor.enabled=false 기본
        new AiMonitorScheduler(svc, props).tick();
        verifyNoInteractions(svc);
    }
    @Test void runsWhenEnabled() {
        AiMonitorService svc = mock(AiMonitorService.class);
        AiOperatorProperties props = new AiOperatorProperties();
        props.getMonitor().setEnabled(true);
        new AiMonitorScheduler(svc, props).tick();
        verify(svc).runScan();
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiMonitorSchedulerTest'`
Expected: 컴파일 실패 — `AiMonitorScheduler` 없음.

- [ ] **Step 3: 구현 작성**

`AiMonitorScheduler.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** SP3: 주기적 능동 스캔 트리거. enabled=false면 즉시 return(점진 활성). */
@Slf4j
@Component
public class AiMonitorScheduler {
    private final AiMonitorService svc;
    private final AiOperatorProperties props;

    public AiMonitorScheduler(AiMonitorService svc, AiOperatorProperties props) {
        this.svc = svc; this.props = props;
    }

    @Scheduled(fixedDelayString = "${nemesis.aiops.monitor.interval-ms:300000}")
    public void tick() {
        if (!props.getMonitor().isEnabled()) return;
        try { svc.runScan(); }
        catch (Exception e) { log.warn("능동 스캔 실패: {}", e.getMessage()); }
    }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiMonitorSchedulerTest'`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiMonitorScheduler.java \
        backend/src/test/java/com/nemesis/domain/aiops/monitor/AiMonitorSchedulerTest.java
git commit -m "feat(aiops): SP3 @Scheduled 능동 스캔 트리거

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: AiFindingController + 벨 피드 확장

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingController.java`
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/AiNotificationController.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingControllerTest.java`

**Interfaces:**
- Produces:
  - `GET /api/ai/findings?status=OPEN` → `List<AiFinding>` (status 미지정 시 OPEN). 조회는 viewer+(기존 RBAC 필터가 GET 허용 — SP1 `AiNotificationController`와 동일 노출 수준).
  - `AiNotificationController.feed()` 응답에 `openFindings`(long) + `recentFindings`(목록) 추가.

- [ ] **Step 1: 실패 테스트 작성 (컨트롤러 단위)**

`AiFindingControllerTest.java` (standalone, DB 불요):
```java
package com.nemesis.domain.aiops.monitor;

import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiFindingControllerTest {
    @Test void listDefaultsToOpen() {
        AiFindingRepository repo = mock(AiFindingRepository.class);
        AiFinding f = AiFinding.builder().id(UUID.randomUUID()).status(AiFinding.OPEN)
                .signalType(AiFinding.DISK_FULL).build();
        when(repo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN)).thenReturn(List.of(f));
        AiFindingController c = new AiFindingController(repo);
        assertThat(c.list(null)).containsExactly(f);
        verify(repo).findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN);
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiFindingControllerTest'`
Expected: 컴파일 실패 — `AiFindingController` 없음.

- [ ] **Step 3: 컨트롤러 작성**

`AiFindingController.java`:
```java
package com.nemesis.domain.aiops.monitor;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/ai/findings")
@RequiredArgsConstructor
public class AiFindingController {
    private final AiFindingRepository repo;

    @GetMapping
    public List<AiFinding> list(@RequestParam(required = false) String status) {
        String st = (status == null || status.isBlank()) ? AiFinding.OPEN : status;
        return repo.findByStatusOrderByLastSeenAtDesc(st);
    }
}
```

- [ ] **Step 4: 벨 피드 확장**

`AiNotificationController.java` 수정 — 생성자 주입에 `AiFindingRepository` 추가, feed에 finding 합류:
```java
@RestController
@RequestMapping("/api/ai/notifications")
@RequiredArgsConstructor
public class AiNotificationController {
    private final AiProposalRepository repo;
    private final com.nemesis.domain.aiops.monitor.AiFindingRepository findingRepo;

    @GetMapping
    public Map<String, Object> feed() {
        return Map.of(
            "pending", repo.countByStatus(AiProposal.PENDING),
            "openFindings", findingRepo.countByStatus(
                    com.nemesis.domain.aiops.monitor.AiFinding.OPEN),
            "recent", repo.findTop50ByOrderByCreatedAtDesc().stream().limit(10)
                .map(p -> Map.of("id", p.getId(), "status", p.getStatus(),
                        "triggerReason", p.getTriggerReason() == null ? "" : p.getTriggerReason(),
                        "createdAt", p.getCreatedAt())).toList(),
            "recentFindings", findingRepo.findTop50ByOrderByLastSeenAtDesc().stream().limit(10)
                .map(f -> Map.of("id", f.getId(), "signalType", f.getSignalType(),
                        "severity", f.getSeverity(), "status", f.getStatus(),
                        "summary", f.getSummary() == null ? "" : f.getSummary(),
                        "proposalId", f.getProposalId(), "lastSeenAt", f.getLastSeenAt())).toList());
    }
}
```
> `Map.of`는 null 값 불가 — `proposalId`가 null일 수 있으므로 `HashMap`으로 바꾸거나 `String.valueOf`로 감싼다. 구현 시 finding 매핑은 `new HashMap<>()`에 put 방식으로 작성(아래 주의).

- [ ] **Step 5: null-안전 매핑으로 보정**

finding 매핑 람다를 null 허용 맵으로:
```java
"recentFindings", findingRepo.findTop50ByOrderByLastSeenAtDesc().stream().limit(10)
    .map(f -> {
        java.util.Map<String,Object> mm = new java.util.HashMap<>();
        mm.put("id", f.getId()); mm.put("signalType", f.getSignalType());
        mm.put("severity", f.getSeverity()); mm.put("status", f.getStatus());
        mm.put("summary", f.getSummary()); mm.put("proposalId", f.getProposalId());
        mm.put("lastSeenAt", f.getLastSeenAt());
        return mm;
    }).toList()
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon --tests '*AiFindingControllerTest'`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingController.java \
        backend/src/main/java/com/nemesis/domain/aiops/AiNotificationController.java \
        backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingControllerTest.java
git commit -m "feat(aiops): SP3 findings API + 벨 피드 확장

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 프론트엔드 — "열린 이슈" 패널 + 벨 finding 표시

**Files:**
- Modify: `frontend/src/components/dashboard/AiPanel.jsx` (또는 SP1에서 만든 알림 컴포넌트 — 실제 경로 확인)
- Modify: 헤더 벨 컴포넌트 (`frontend/src/components/layout/Navbar.jsx` 또는 SP1 NotificationBell — 실제 경로 확인)
- Test: 수동/E2E (Task 10)

> 프론트는 단위테스트 인프라가 약하므로 E2E(Task 10)로 검증. 먼저 SP1이 만든 실제 알림/벨 컴포넌트 경로를 `grep -rl "api/ai/notifications\|api/ai/proposals" frontend/src`로 확인하고 거기에 붙인다.

- [ ] **Step 1: 알림/벨 소비 지점 확인**

```bash
grep -rl "api/ai/notifications\|api/ai/proposals\|NotificationBell\|AiPanel" /var/www/html/Nemesis_v100/frontend/src
```
확인된 파일을 수정 대상으로 삼는다.

- [ ] **Step 2: "열린 이슈" 목록 패널 추가**

대시보드 AI 패널에 `GET /api/ai/findings`(OPEN) 호출 섹션 추가 — 각 항목 `signalType · severity · summary`와 `proposalId` 있으면 해당 제안 카드로 연결(기존 axios 인스턴스/Bearer 재사용). severity 색상 배지(INFO/WARN/HIGH/CRITICAL).

- [ ] **Step 3: 벨에 finding 카운트 반영**

기존 벨이 `pending`을 쓰던 것을 `pending + openFindings` 합산 배지로, 드롭다운에 `recentFindings` 표시(클릭 시 패널 포커스).

- [ ] **Step 4: 빌드 확인**

```bash
cd /var/www/html/Nemesis_v100/frontend && npm run build
```
Expected: 빌드 성공(에러 0).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src
git commit -m "feat(aiops): SP3 대시보드 열린 이슈 패널 + 벨 finding 표시

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: aibot 사이드카 `POST /ai/scan` (전제조건: Task 0)

**Files:**
- Modify: `/root/aibot/nemesis_service.py`
- Modify: `/root/aibot/test_nemesis_service.py`

**Interfaces:**
- Produces: `POST /ai/scan` — 요청 `{context:{...,suspectSignals:[...]}, sshTarget:{...}}` → 응답 `{findings:[{signalType,severity,summary,diagnosis,rootCause,proposedActions,confidence}]}`. 읽기전용 그래프(`run_investigation`) 재사용. severity HIGH 미만이면 `proposedActions` 생략.

- [ ] **Step 1: 실패 테스트 작성 (pytest)**

`test_nemesis_service.py`에 추가:
```python
def test_scan_returns_findings_schema(monkeypatch):
    # run_investigation을 결정성 있게 가짜로 대체
    import nemesis_service
    def fake_investigation(context, ssh):
        return {"diagnosis": "d", "rootCause": "r",
                "proposedActions": [{"description":"x","command":"c","target":"db2","riskLevel":"MEDIUM"}],
                "confidence": 0.8}
    monkeypatch.setattr(nemesis_service.get_agent(), "run_investigation", fake_investigation, raising=False)
    r = client.post("/ai/scan",
        headers={"Authorization": "Bearer test-secret"},
        json={"context": {"nodeId": "n1", "hostname": "db2",
                          "suspectSignals": [{"signalType": "DISK_FULL", "detail": {"disk": 96}}]},
              "sshTarget": {"host": "10.0.0.12", "port": 22, "user": "root"}})
    assert r.status_code == 200
    body = r.json()
    assert "findings" in body and isinstance(body["findings"], list)
    f = body["findings"][0]
    assert f["signalType"] == "DISK_FULL"
    assert "severity" in f
```

- [ ] **Step 2: 실패 확인**

```bash
cd /root/aibot && NEMESIS_AIBOT_TOKEN=test-secret ./venv/bin/python -m pytest test_nemesis_service.py::test_scan_returns_findings_schema -q
```
Expected: FAIL — `/ai/scan` 404.

- [ ] **Step 3: 엔드포인트 구현**

`nemesis_service.py`에 추가:
```python
@app.post("/ai/scan")
def scan(body: dict, _: bool = Depends(require_token)):
    context = body.get("context") or {}
    ssh_target = body.get("sshTarget") or {}
    suspects = context.get("suspectSignals") or []
    agent = get_agent()
    findings = []
    for sig in suspects:
        sig_type = sig.get("signalType", "OTHER")
        # 읽기전용 조사 그래프 재사용(로그 tail·진단). 변경도구 미바인드.
        inv = agent.run_investigation({**context, "focusSignal": sig_type}, ssh_target) or {}
        sev = sig.get("detail", {}).get("severity") or "HIGH"
        f = {
            "signalType": sig_type, "severity": sev,
            "summary": inv.get("diagnosis", "")[:200],
            "diagnosis": inv.get("diagnosis", ""), "rootCause": inv.get("rootCause", ""),
            "confidence": inv.get("confidence", 0.0),
        }
        if sev in ("HIGH", "CRITICAL"):
            f["proposedActions"] = inv.get("proposedActions", [])
        findings.append(f)
    return {"findings": findings}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /root/aibot && NEMESIS_AIBOT_TOKEN=test-secret ./venv/bin/python -m pytest test_nemesis_service.py -q
```
Expected: PASS

- [ ] **Step 5: 사이드카 재기동 + 커밋(/root/aibot git)**

```bash
pkill -f 'uvicorn nemesis_service'
cd /root/aibot && NEMESIS_AIBOT_TOKEN=$(grep NEMESIS_AIBOT_TOKEN /var/www/html/Nemesis_v100/.env | cut -d= -f2) \
  nohup ./venv/bin/uvicorn nemesis_service:app --host 0.0.0.0 --port 18900 >logs/nemesis_service.log 2>&1 &
sleep 2 && curl -s http://127.0.0.1:18900/health
git add nemesis_service.py test_nemesis_service.py
git commit -m "feat: SP3 /ai/scan 엔드포인트(읽기전용 조사 재사용)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: 통합 빌드 + e2e 스모크

**Files:**
- 없음(검증 전용). 필요 시 e2e 스크립트 추가: `frontend/` 내 기존 playwright 패턴 사용.

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd /var/www/html/Nemesis_v100/backend
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon
```
Expected: BUILD SUCCESSFUL, 신규 SP3 테스트 전부 PASS.

- [ ] **Step 2: 백엔드 컨테이너 재기동(마이그레이션 V14 적용 확인)**

memory `nemesis-deploy-topology` 참조 — 운영 컨테이너는 `docker run`으로 기동.
```bash
# 이미지 재빌드 후 운영 컨테이너 재생성(실제 명령은 배포 토폴로지 메모 따름)
docker logs nemesis-server-e2e 2>&1 | grep -i "V14__ai_findings\|Flyway" | tail
```
Expected: V14 마이그레이션 적용 로그.

- [ ] **Step 3: e2e 스모크 (모니터 활성 + 디스크 가득 모의)**

```bash
# .env에서 NEMESIS_AIOPS_MONITOR_ENABLED=true 로 켜고 백엔드 재생성
# 메트릭 푸시로 디스크 96% 모의 → 스캔 주기 후
curl -s -H "Authorization: Bearer <op-token>" http://localhost:18090/api/ai/findings | head
```
Expected: `DISK_FULL` finding(OPEN) 등장. HIGH면 `/api/ai/proposals`에 연결 PENDING 제안 등장. 디스크 정상화 후 다음 스캔에서 finding `RESOLVED`.

- [ ] **Step 4: 최종 커밋(있으면) + 플랜 완료 보고**

```bash
git add -A && git commit -m "test(aiops): SP3 통합 스모크 검증

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "변경 없음"
```

---

## 자가 검토 메모 (스펙 대비)

- 스펙 §3 데이터 모델 → Task 2(엔티티/마이그레이션). ✅
- §4.1 1차 필터(DISK/MEM/CPU지속/LOG_ERROR/EVENT_SPIKE) → Task 3. **EVENT_SPIKE는 메트릭 외 이벤트 소스 필요** → Task 3에서 메트릭 신호만 구현, EVENT_SPIKE는 후속 보강(스펙 enum엔 남김, YAGNI 분리 명시).
- §4.2/4.3 조율·심각도 게이트 → Task 6 + Task 5. ✅
- §4.4 findings API → Task 8. ✅
- §4.5 사이드카 /ai/scan → Task 10. ✅
- §4.6 프론트 → Task 9. ✅
- §6 폴백(aibot 다운) → Task 6 테스트 `aibotDownFallsBackToPrefilterInfo`. ✅
- §7 설정 → Task 1. ✅
- §7 전제조건(복구+git) → Task 0. ✅
- §8 테스트 전략 → 각 Task TDD + Task 11 e2e. ✅
- **알려진 단순화:** EVENT_SPIKE 1차 신호는 후속, RESOLVED 알림은 별도 push 없이 폴링 피드의 상태변화로 표현(스펙의 "복구 알림"을 피드 기반으로 해석).
