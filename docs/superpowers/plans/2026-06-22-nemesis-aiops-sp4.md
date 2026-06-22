# SP4 똑똑한 페일오버 판단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단발 LLM 페일오버 판단(`AiDecisionService`)을 [Nemesis 독립 TCP 프로브 → (애매할 때만) aibot 다단 추론] 결정 파이프라인으로 교체해 *살아있는 active 위에 페일오버하지 않기(스플릿브레인 방지)*를 달성한다.

**Architecture:** active 무응답 감지 시 Nemesis가 독립 TCP 프로브(host 포트 + 서비스 포트)를 수행한다. host 불도달이면 확정 사망으로 즉시 자동 페일오버, 도달되면 파티션 의심이므로 aibot `/ai/decide`로 다단 추론해 FAILOVER/HOLD를 받는다. HOLD면 `FailoverHold`로 등록하고 재평가 스케줄러가 주기적으로 재프로브해 진짜 죽으면 페일오버한다. 서비스 포트는 에이전트가 리스닝 포트를 보고하면 `managed_services.port`에 영속 upsert된다.

**Tech Stack:** Java 17 / Spring Boot, JPA/Flyway(PostgreSQL, 테스트는 H2), JUnit5+Mockito, Python(FastAPI 사이드카 + POSIX sh 에이전트), React(Vite).

## Global Constraints

- 빌드/테스트는 로컬 JDK 없음 → Docker `gradle:8.7-jdk17` 사용: `docker run --rm -v /var/www/html/Nemesis_v100/backend:/app -v gradle-cache:/home/gradle/.gradle -w /app gradle:8.7-jdk17 gradle <task> --console=plain`
- 신규 백엔드 코드는 패키지 `com.nemesis.domain.aiops.failover`(SP3 `...aiops.monitor`와 형제).
- 설정 prefix `nemesis.aiops.failover.*`, 기본 `enabled=false`(opt-in 점진 활성). HA는 aibot/LLM에 무의존 — 불통 시에도 결정론이 판단을 끝낸다.
- JSON 컬럼은 TEXT + Jackson(기존 패턴). Flyway 다음 번호: **V16**(failover_holds), **V17**(managed_services.port). V15까지 사용 중.
- TDD 필수: 모든 production 코드는 실패 테스트 먼저. Mockito 순수 단위 테스트(스프링 컨텍스트 불요)가 기존 패턴.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 기존 자산(변경 금지): 서비스 카탈로그 영속 레지스트리·시작/중지/재시작·삭제는 이미 구현됨. SP4는 *포트*만 추가.

---

### Task 1: managed_services.port 컬럼 + 엔티티 필드 + 카탈로그 노출

**Files:**
- Create: `backend/src/main/resources/db/migration/V17__managed_services_port.sql`
- Modify: `backend/src/main/java/com/nemesis/domain/catalog/ManagedService.java`
- Modify: `backend/src/main/java/com/nemesis/domain/catalog/ServiceCatalogService.java` (catalog 출력에 port, update에서 port 수동보정)
- Test: `backend/src/test/java/com/nemesis/domain/catalog/ServiceCatalogPortTest.java`

**Interfaces:**
- Produces: `ManagedService.getPort(): Integer` / `setPort(Integer)` (nullable). `catalog()` 항목 맵에 `"port"` 키 추가. `update()` body의 `"port"`(숫자 또는 null)로 수동 보정.

- [ ] **Step 1: Flyway 마이그레이션 작성**

`V17__managed_services_port.sql`:
```sql
ALTER TABLE managed_services ADD COLUMN port INT;
```

- [ ] **Step 2: 엔티티 필드 추가**

`ManagedService.java` — `private boolean haManaged = false;` 아래에 추가:
```java
    @Column(name = "port")
    private Integer port;   // SP4: 영속 서비스 리스닝 포트(자동 캡처, null 가능)
```

- [ ] **Step 3: 실패 테스트 작성**

`ServiceCatalogPortTest.java`:
```java
package com.nemesis.domain.catalog;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ServiceCatalogPortTest {
    ManagedServiceRepository serviceRepo; ClusterRepository clusterRepo;
    NodeRepository nodeRepo; MetricsCacheService metrics; DetectionProperties detProps;
    ServiceCatalogService svc;
    UUID clusterId = UUID.randomUUID(); UUID serviceId = UUID.randomUUID();

    @BeforeEach void setup() {
        serviceRepo = mock(ManagedServiceRepository.class);
        clusterRepo = mock(ClusterRepository.class);
        nodeRepo = mock(NodeRepository.class);
        metrics = mock(MetricsCacheService.class);
        detProps = mock(DetectionProperties.class);
        Cluster c = mock(Cluster.class); when(c.getId()).thenReturn(clusterId);
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(c));
        when(nodeRepo.findByClusterId(clusterId)).thenReturn(List.of());
        svc = new ServiceCatalogService(serviceRepo, clusterRepo, nodeRepo, metrics, detProps);
    }

    @Test void updateSetsPortManualOverride() {
        ManagedService m = ManagedService.builder().id(serviceId).cluster(
                mockClusterWithId(clusterId)).name("oracle").displayName("Oracle DB")
                .type(ManagedService.Type.DB).build();
        when(serviceRepo.findById(serviceId)).thenReturn(Optional.of(m));
        when(serviceRepo.save(any())).thenAnswer(i -> i.getArgument(0));

        svc.update(clusterId, serviceId, Map.of("port", 1521));

        verify(serviceRepo).save(argThat(s -> Integer.valueOf(1521).equals(s.getPort())));
    }

    private Cluster mockClusterWithId(UUID id) {
        Cluster c = mock(Cluster.class); when(c.getId()).thenReturn(id); return c;
    }
}
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.catalog.ServiceCatalogPortTest" --console=plain`
Expected: FAIL — `update`가 port를 set하지 않음(save 인자에 port=null).

- [ ] **Step 5: ServiceCatalogService 구현**

`catalog()`의 결과 맵 빌드(현재 `m.put("haManaged", ...)` 다음)에 추가:
```java
            m.put("port",         svc.getPort());
```
`update()`에 추가(현재 `if (body.get("haManaged") != null) ...` 다음):
```java
        if (body.containsKey("port")) {
            Object p = body.get("port");
            svc.setPort(p == null ? null : ((Number) p).intValue());
        }
```
`update()`의 반환 맵에도 `m.put("port", svc.getPort());` 추가.

- [ ] **Step 6: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.catalog.ServiceCatalogPortTest" --console=plain`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/src/main/resources/db/migration/V17__managed_services_port.sql \
  backend/src/main/java/com/nemesis/domain/catalog/ManagedService.java \
  backend/src/main/java/com/nemesis/domain/catalog/ServiceCatalogService.java \
  backend/src/test/java/com/nemesis/domain/catalog/ServiceCatalogPortTest.java
git commit -m "feat(sp4): managed_services.port 컬럼 + 카탈로그 노출/수동보정

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 에이전트 collect.sh 리스닝 포트 보고

**Files:**
- Modify: `agent/collect.sh:41-54` (프로세스 루프)
- Modify: `agent/collect_aix.sh:36-40` (AIX 병행)

**Interfaces:**
- Produces: 메트릭 JSON의 각 process 객체에 `"port":"<int>"`(미상이면 `"0"`). `MetricsPushRequest.processes`는 `List<Map<String,String>>`이라 DTO 변경 불필요 — 소비측은 `proc.get("port")`.

- [ ] **Step 1: collect.sh 포트 추출 추가**

`collect.sh` 프로세스 루프(현재 line 52 PROCESSES 라인)를 다음으로 교체:
```sh
  PCPU=$(echo "$USAGE" | cut -d'|' -f1); [ -z "$PCPU" ] && PCPU=0
  PMEM=$(echo "$USAGE" | cut -d'|' -f2); [ -z "$PMEM" ] && PMEM=0
  # 리스닝 포트(best-effort): FIRST pid가 LISTEN 중인 첫 TCP 포트
  PORT=$(ss -ltnH 2>/dev/null | awk -v p="pid=$FIRST," '$0 ~ p {n=split($4,a,":"); print a[n]; exit}')
  [ -z "$PORT" ] && PORT=0
  PROCESSES="${PROCESSES},{\"name\":\"$P\",\"pid\":\"$FIRST\",\"status\":\"running\",\"cpuPercent\":$PCPU,\"memPercent\":$PMEM,\"port\":\"$PORT\"}"
```

- [ ] **Step 2: collect_aix.sh 포트 추출 추가(병행)**

`collect_aix.sh`의 process 라인(현재 line 39)을 다음으로 교체:
```sh
  PID=$(ps -ef 2>/dev/null | grep "$P" | grep -v grep | awk '{print $2}' | head -1)
  if [ -n "$PID" ]; then
    PORT=$(netstat -Aan 2>/dev/null | awk '/LISTEN/ {n=split($5,a,"."); print a[n]; exit}')
    [ -z "$PORT" ] && PORT=0
    PROCESSES="${PROCESSES},{\"name\":\"$P\",\"pid\":\"$PID\",\"status\":\"running\",\"port\":\"$PORT\"}"
  fi
```
(AIX netstat은 pid 매핑이 제한적 → 포트 미상이면 0. 소비측은 0을 "미확보"로 처리한다.)

- [ ] **Step 3: 로컬 수동 검증**

Run: `sh agent/collect.sh | python3 -m json.tool | grep -A1 -i port | head`
Expected: 유효 JSON, process 객체에 `"port"` 키 존재(서비스가 떠 있으면 포트 숫자, 아니면 "0").

- [ ] **Step 4: 커밋**

```bash
git add agent/collect.sh agent/collect_aix.sh
git commit -m "feat(sp4): 에이전트가 프로세스 리스닝 포트 보고(ss/netstat)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> ⚠️ 노드 재배포 필요: 변경된 collect.sh를 각 노드에 배포해야 실데이터 반영(로컬개발 함정 메모 참고). 코드/테스트는 무관하게 진행 가능.

---

### Task 3: ServicePortCapture — 메트릭에서 포트 영속 upsert

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/ServicePortCapture.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/failover/ServicePortCaptureTest.java`

**Interfaces:**
- Consumes: `ManagedServiceRepository.findByClusterIdOrderByTypeAscDisplayNameAsc(UUID)`, `NodeRepository.findByClusterId(UUID)`, `MetricsCacheService.getFresh(UUID, long)`, `ManagedService.getName()/getPort()/setPort()`.
- Produces: `ServicePortCapture.capture()` — 등록 서비스 프로세스가 노드에서 관측되고 포트>0이면 `ManagedService.port` upsert(있을 때만, null/0으로 덮어쓰지 않음).

- [ ] **Step 1: 실패 테스트 작성**

`ServicePortCaptureTest.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ServicePortCaptureTest {
    ManagedServiceRepository serviceRepo; ClusterRepository clusterRepo;
    NodeRepository nodeRepo; MetricsCacheService metrics; DetectionProperties detProps;
    ServicePortCapture svc;
    UUID clusterId = UUID.randomUUID(); UUID nodeId = UUID.randomUUID();

    @BeforeEach void setup() {
        serviceRepo = mock(ManagedServiceRepository.class);
        clusterRepo = mock(ClusterRepository.class);
        nodeRepo = mock(NodeRepository.class);
        metrics = mock(MetricsCacheService.class);
        detProps = mock(DetectionProperties.class);
        when(detProps.metricsFreshMillis()).thenReturn(60_000L);
        Cluster c = mock(Cluster.class); when(c.getId()).thenReturn(clusterId);
        when(clusterRepo.findAll()).thenReturn(List.of(c));
        Node n = mock(Node.class); when(n.getId()).thenReturn(nodeId);
        when(nodeRepo.findByClusterId(clusterId)).thenReturn(List.of(n));
        when(serviceRepo.save(any())).thenAnswer(i -> i.getArgument(0));
        svc = new ServicePortCapture(serviceRepo, clusterRepo, nodeRepo, metrics, detProps);
    }
    private MetricsPushRequest withProc(String name, String port) {
        MetricsPushRequest m = new MetricsPushRequest();
        m.setProcesses(List.of(Map.of("name", name, "pid", "100", "port", port)));
        return m;
    }
    private ManagedService service(String name, Integer port) {
        return ManagedService.builder().id(UUID.randomUUID()).name(name)
                .displayName(name).type(ManagedService.Type.DB).port(port).build();
    }

    @Test void capturesObservedPort() {
        when(serviceRepo.findByClusterIdOrderByTypeAscDisplayNameAsc(clusterId))
                .thenReturn(List.of(service("oracle", null)));
        when(metrics.getFresh(eq(nodeId), anyLong())).thenReturn(Optional.of(withProc("oracle", "1521")));
        svc.capture();
        verify(serviceRepo).save(argThat(s -> Integer.valueOf(1521).equals(s.getPort())));
    }
    @Test void doesNotOverwriteWithZeroWhenStopped() {
        when(serviceRepo.findByClusterIdOrderByTypeAscDisplayNameAsc(clusterId))
                .thenReturn(List.of(service("oracle", 1521)));
        when(metrics.getFresh(eq(nodeId), anyLong())).thenReturn(Optional.empty()); // 중지
        svc.capture();
        verify(serviceRepo, never()).save(any());   // 기존 포트 유지
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.ServicePortCaptureTest" --console=plain`
Expected: FAIL — `ServicePortCapture` 클래스 없음(컴파일 에러).

- [ ] **Step 3: 구현**

`ServicePortCapture.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.dto.MetricsPushRequest;
import com.nemesis.domain.node.NodeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/** SP4: 에이전트가 보고한 리스닝 포트를 등록 서비스에 매칭해 managed_services.port upsert. */
@Slf4j
@Component
public class ServicePortCapture {
    private final ManagedServiceRepository serviceRepo;
    private final ClusterRepository clusterRepo;
    private final NodeRepository nodeRepo;
    private final MetricsCacheService metrics;
    private final DetectionProperties detProps;

    public ServicePortCapture(ManagedServiceRepository serviceRepo, ClusterRepository clusterRepo,
                              NodeRepository nodeRepo, MetricsCacheService metrics, DetectionProperties detProps) {
        this.serviceRepo = serviceRepo; this.clusterRepo = clusterRepo;
        this.nodeRepo = nodeRepo; this.metrics = metrics; this.detProps = detProps;
    }

    @Transactional
    public void capture() {
        for (Cluster c : clusterRepo.findAll()) {
            List<Node> nodes = nodeRepo.findByClusterId(c.getId());
            for (ManagedService svc : serviceRepo.findByClusterIdOrderByTypeAscDisplayNameAsc(c.getId())) {
                Integer found = observedPort(nodes, svc.getName());
                if (found != null && found > 0 && !found.equals(svc.getPort())) {
                    svc.setPort(found);
                    serviceRepo.save(svc);   // 있을 때만 갱신 — null/0으로 덮어쓰지 않음(중지 시 유지)
                }
            }
        }
    }

    private Integer observedPort(List<Node> nodes, String pattern) {
        String p = pattern == null ? "" : pattern.toLowerCase();
        for (Node node : nodes) {
            Optional<MetricsPushRequest> m = metrics.getFresh(node.getId(), detProps.metricsFreshMillis());
            if (m.isEmpty() || m.get().getProcesses() == null) continue;
            for (Map<String, String> proc : m.get().getProcesses()) {
                if (proc.getOrDefault("name", "").toLowerCase().contains(p)) {
                    try { return Integer.parseInt(proc.getOrDefault("port", "0").trim()); }
                    catch (NumberFormatException e) { return null; }
                }
            }
        }
        return null;
    }
}
```

> 참고: `@Scheduled` 트리거는 Task 12(스케줄러)에서 추가하지 않고 여기서 바로 붙인다. 메서드 상단에 다음 스케줄 진입점을 추가:
```java
    private final AiOperatorProperties props;   // 생성자에 추가 주입
    @Scheduled(fixedDelayString = "${nemesis.aiops.failover.capture-interval-ms:60000}")
    public void tick() {
        try { capture(); } catch (Exception e) { log.warn("포트 캡처 실패: {}", e.getMessage()); }
    }
```
> 단, `props`/`capture-interval-ms`는 Task 6에서 `Failover` 설정을 추가한 뒤 주입한다. **이 태스크에서는 `capture()`만 구현·테스트**하고 `@Scheduled`/`props`는 Task 6 완료 후 붙인다(아래 Step 4 주석 참조). 지금은 생성자에 `props` 없이 둔다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.ServicePortCaptureTest" --console=plain`
Expected: PASS (capture() 단독 검증; 스케줄링은 Task 6에서 결선)

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/failover/ServicePortCapture.java \
  backend/src/test/java/com/nemesis/domain/aiops/failover/ServicePortCaptureTest.java
git commit -m "feat(sp4): ServicePortCapture — 관측 포트 영속 upsert

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: FailoverDtos + NodeReachabilityProbe

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverDtos.java`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/NodeReachabilityProbe.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/failover/NodeReachabilityProbeTest.java`

**Interfaces:**
- Produces:
  - `FailoverDtos.ProbeResult(boolean hostReachable, boolean serviceReachable, List<PortProbe> details)`
  - `FailoverDtos.PortProbe(int port, String kind /* HOST|SERVICE */, boolean open, long latencyMs)`
  - `FailoverDtos.DecideResponse(String action, double confidence, String reasoning)`
  - `FailoverDtos.Verdict(boolean proceed, boolean held, String reason)`
  - `NodeReachabilityProbe.probe(String host, List<Integer> hostPorts, List<Integer> servicePorts, int timeoutMs): ProbeResult`

- [ ] **Step 1: DTO 작성(테스트 전, 타입만 — 동작 없음)**

`FailoverDtos.java`:
```java
package com.nemesis.domain.aiops.failover;

import java.util.List;

public class FailoverDtos {
    public record PortProbe(int port, String kind, boolean open, long latencyMs) {}
    public record ProbeResult(boolean hostReachable, boolean serviceReachable, List<PortProbe> details) {}
    public record DecideResponse(String action, double confidence, String reasoning) {}
    public record Verdict(boolean proceed, boolean held, String reason) {}
}
```

- [ ] **Step 2: 실패 테스트 작성**

`NodeReachabilityProbeTest.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.aiops.failover.FailoverDtos.ProbeResult;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.ServerSocket;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class NodeReachabilityProbeTest {
    NodeReachabilityProbe probe = new NodeReachabilityProbe();

    @Test void openServicePortIsReachable() throws IOException {
        try (ServerSocket s = new ServerSocket(0)) {
            int port = s.getLocalPort();
            ProbeResult r = probe.probe("127.0.0.1", List.of(), List.of(port), 500);
            assertThat(r.serviceReachable()).isTrue();
        }
    }
    @Test void closedPortsAreUnreachable() {
        ProbeResult r = probe.probe("127.0.0.1", List.of(1), List.of(1), 300); // 1번 포트(닫힘 가정)
        assertThat(r.hostReachable()).isFalse();
        assertThat(r.serviceReachable()).isFalse();
    }
    @Test void openHostPortSetsHostReachable() throws IOException {
        try (ServerSocket s = new ServerSocket(0)) {
            int port = s.getLocalPort();
            ProbeResult r = probe.probe("127.0.0.1", List.of(port), List.of(), 500);
            assertThat(r.hostReachable()).isTrue();
        }
    }
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.NodeReachabilityProbeTest" --console=plain`
Expected: FAIL — `NodeReachabilityProbe` 없음.

- [ ] **Step 4: 구현**

`NodeReachabilityProbe.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.aiops.failover.FailoverDtos.PortProbe;
import com.nemesis.domain.aiops.failover.FailoverDtos.ProbeResult;
import org.springframework.stereotype.Component;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;

/** SP4: active 노드의 host/서비스 포트에 독립 TCP connect로 도달성 검증(에이전트 경로와 무관). */
@Component
public class NodeReachabilityProbe {

    public ProbeResult probe(String host, List<Integer> hostPorts, List<Integer> servicePorts, int timeoutMs) {
        List<PortProbe> details = new ArrayList<>();
        boolean hostReachable = false, serviceReachable = false;
        for (Integer p : hostPorts) {
            PortProbe pp = connect(host, p, "HOST", timeoutMs);
            details.add(pp);
            if (pp.open()) hostReachable = true;
        }
        for (Integer p : servicePorts) {
            PortProbe pp = connect(host, p, "SERVICE", timeoutMs);
            details.add(pp);
            if (pp.open()) { serviceReachable = true; hostReachable = true; }
        }
        return new ProbeResult(hostReachable, serviceReachable, details);
    }

    private PortProbe connect(String host, int port, String kind, int timeoutMs) {
        long t0 = System.currentTimeMillis();
        try (Socket sock = new Socket()) {
            sock.connect(new InetSocketAddress(host, port), timeoutMs);
            return new PortProbe(port, kind, true, System.currentTimeMillis() - t0);
        } catch (Exception e) {
            return new PortProbe(port, kind, false, System.currentTimeMillis() - t0);
        }
    }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.NodeReachabilityProbeTest" --console=plain`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverDtos.java \
  backend/src/main/java/com/nemesis/domain/aiops/failover/NodeReachabilityProbe.java \
  backend/src/test/java/com/nemesis/domain/aiops/failover/NodeReachabilityProbeTest.java
git commit -m "feat(sp4): NodeReachabilityProbe + FailoverDtos(host/service 도달성)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: ServicePortResolver

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/ServicePortResolver.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/failover/ServicePortResolverTest.java`

**Interfaces:**
- Consumes: `ManagedServiceRepository.findByClusterIdOrderByTypeAscDisplayNameAsc(UUID)`, `ManagedService.isHaManaged()/getPort()`.
- Produces: `ServicePortResolver.servicePorts(UUID clusterId): List<Integer>` — haManaged + port!=null인 서비스의 포트 목록(중복 제거).

- [ ] **Step 1: 실패 테스트 작성**

`ServicePortResolverTest.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ServicePortResolverTest {
    ManagedServiceRepository repo = mock(ManagedServiceRepository.class);
    ServicePortResolver resolver = new ServicePortResolver(repo);
    UUID clusterId = UUID.randomUUID();

    private ManagedService svc(boolean ha, Integer port) {
        return ManagedService.builder().id(UUID.randomUUID()).name("oracle").displayName("Oracle")
                .type(ManagedService.Type.DB).haManaged(ha).port(port).build();
    }

    @Test void collectsHaManagedPortsOnly() {
        when(repo.findByClusterIdOrderByTypeAscDisplayNameAsc(clusterId))
                .thenReturn(List.of(svc(true, 1521), svc(false, 5432), svc(true, null)));
        assertThat(resolver.servicePorts(clusterId)).containsExactly(1521);
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.ServicePortResolverTest" --console=plain`
Expected: FAIL — `ServicePortResolver` 없음.

- [ ] **Step 3: 구현**

`ServicePortResolver.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import org.springframework.stereotype.Component;

import java.util.*;

/** SP4: 클러스터의 haManaged 서비스 리스닝 포트 해석(probe SERVICE 포트 소스). */
@Component
public class ServicePortResolver {
    private final ManagedServiceRepository repo;
    public ServicePortResolver(ManagedServiceRepository repo) { this.repo = repo; }

    public List<Integer> servicePorts(UUID clusterId) {
        LinkedHashSet<Integer> ports = new LinkedHashSet<>();
        for (ManagedService s : repo.findByClusterIdOrderByTypeAscDisplayNameAsc(clusterId)) {
            if (s.isHaManaged() && s.getPort() != null && s.getPort() > 0) ports.add(s.getPort());
        }
        return new ArrayList<>(ports);
    }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.ServicePortResolverTest" --console=plain`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/failover/ServicePortResolver.java \
  backend/src/test/java/com/nemesis/domain/aiops/failover/ServicePortResolverTest.java
git commit -m "feat(sp4): ServicePortResolver — haManaged 포트 해석

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: nemesis.aiops.failover 설정 + ServicePortCapture 스케줄 결선

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorProperties.java`
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/failover/ServicePortCapture.java` (props 주입 + @Scheduled)
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorPropertiesFailoverTest.java`

**Interfaces:**
- Produces: `AiOperatorProperties.getFailover(): Failover`. `Failover{enabled, probePorts(List<Integer>, 기본 [22]), probeTimeoutMs(1000), decideDeadlineMs(10000), reevalIntervalMs(20000), captureIntervalMs(60000)}`.

- [ ] **Step 1: 실패 테스트 작성**

`AiOperatorPropertiesFailoverTest.java`:
```java
package com.nemesis.domain.aiops;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class AiOperatorPropertiesFailoverTest {
    @Test void failoverDefaults() {
        AiOperatorProperties.Failover f = new AiOperatorProperties().getFailover();
        assertThat(f.isEnabled()).isFalse();
        assertThat(f.getProbePorts()).containsExactly(22);
        assertThat(f.getProbeTimeoutMs()).isEqualTo(1000);
        assertThat(f.getDecideDeadlineMs()).isEqualTo(10000);
        assertThat(f.getReevalIntervalMs()).isEqualTo(20000);
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.AiOperatorPropertiesFailoverTest" --console=plain`
Expected: FAIL — `getFailover()` 없음.

- [ ] **Step 3: 설정 클래스 추가**

`AiOperatorProperties.java` — `monitor` 블록 아래에 추가:
```java
    /** SP4: 똑똑한 페일오버 판단 설정. nemesis.aiops.failover.* */
    private final Failover failover = new Failover();
    public Failover getFailover() { return failover; }

    @Getter @Setter
    public static class Failover {
        private boolean enabled = false;
        private java.util.List<Integer> probePorts = new java.util.ArrayList<>(java.util.List.of(22));
        private int probeTimeoutMs = 1000;
        private int decideDeadlineMs = 10000;
        private long reevalIntervalMs = 20000L;
        private long captureIntervalMs = 60000L;
    }
```

- [ ] **Step 4: ServicePortCapture에 스케줄 결선**

`ServicePortCapture.java` 생성자에 `AiOperatorProperties props` 주입(필드 추가), 메서드 추가:
```java
    @Scheduled(fixedDelayString = "${nemesis.aiops.failover.capture-interval-ms:60000}")
    public void tick() {
        if (!props.getFailover().isEnabled()) return;
        try { capture(); } catch (Exception e) { log.warn("포트 캡처 실패: {}", e.getMessage()); }
    }
```
`ServicePortCaptureTest` setup의 생성자 호출에 `new AiOperatorProperties()` 인자 추가.

- [ ] **Step 5: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.AiOperatorPropertiesFailoverTest" --tests "com.nemesis.domain.aiops.failover.ServicePortCaptureTest" --console=plain`
Expected: PASS (둘 다)

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/AiOperatorProperties.java \
  backend/src/main/java/com/nemesis/domain/aiops/failover/ServicePortCapture.java \
  backend/src/test/java/com/nemesis/domain/aiops/AiOperatorPropertiesFailoverTest.java \
  backend/src/test/java/com/nemesis/domain/aiops/failover/ServicePortCaptureTest.java
git commit -m "feat(sp4): nemesis.aiops.failover 설정 + 포트 캡처 스케줄 결선

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: FailoverHold 엔티티 + 마이그레이션 V16 + Repository

**Files:**
- Create: `backend/src/main/resources/db/migration/V16__failover_holds.sql`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverHold.java`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverHoldRepository.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/failover/FailoverHoldTest.java`

**Interfaces:**
- Produces: `FailoverHold` 엔티티(상수 `HELD/RESOLVED_FAILOVER/RESOLVED_RECOVERED`), `FailoverHoldRepository.findByStatus(String)`, `findByNodeIdAndStatus(UUID,String)`.

- [ ] **Step 1: 마이그레이션 작성**

`V16__failover_holds.sql`:
```sql
CREATE TABLE failover_holds (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID,
    node_id          UUID NOT NULL,
    reason           TEXT,
    probe_result     TEXT,
    status           VARCHAR(24) NOT NULL,
    finding_id       UUID,
    last_probed_at   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_failover_holds_node_held ON failover_holds (node_id) WHERE status = 'HELD';
```

- [ ] **Step 2: 실패 테스트 작성**

`FailoverHoldTest.java`:
```java
package com.nemesis.domain.aiops.failover;

import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

class FailoverHoldTest {
    @Test void prePersistDefaultsStatusAndTimestamps() {
        FailoverHold h = FailoverHold.builder().nodeId(UUID.randomUUID()).build();
        h.prePersist();
        assertThat(h.getStatus()).isEqualTo(FailoverHold.HELD);
        assertThat(h.getCreatedAt()).isNotNull();
        assertThat(h.getId()).isNotNull();
    }
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.FailoverHoldTest" --console=plain`
Expected: FAIL — `FailoverHold` 없음.

- [ ] **Step 4: 엔티티 + 리포지토리 구현**

`FailoverHold.java`:
```java
package com.nemesis.domain.aiops.failover;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** SP4: 페일오버 보류(held) 노드 추적. 재평가 스케줄러가 해소한다. */
@Entity
@Table(name = "failover_holds")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class FailoverHold {
    public static final String HELD = "HELD",
            RESOLVED_FAILOVER = "RESOLVED_FAILOVER", RESOLVED_RECOVERED = "RESOLVED_RECOVERED";

    @Id private UUID id;
    @Column(name = "cluster_group_id") private UUID clusterId;
    @Column(name = "node_id", nullable = false) private UUID nodeId;
    @Column(columnDefinition = "TEXT") private String reason;
    @Column(name = "probe_result", columnDefinition = "TEXT") private String probeResult;
    @Column(nullable = false, length = 24) private String status;
    @Column(name = "finding_id") private UUID findingId;
    @Column(name = "last_probed_at") private OffsetDateTime lastProbedAt;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;
    @Column(name = "resolved_at") private OffsetDateTime resolvedAt;

    @PrePersist void prePersist() {
        OffsetDateTime now = OffsetDateTime.now();
        if (id == null) id = UUID.randomUUID();
        if (status == null) status = HELD;
        if (createdAt == null) createdAt = now;
        if (lastProbedAt == null) lastProbedAt = now;
    }
}
```

`FailoverHoldRepository.java`:
```java
package com.nemesis.domain.aiops.failover;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FailoverHoldRepository extends JpaRepository<FailoverHold, UUID> {
    List<FailoverHold> findByStatus(String status);
    Optional<FailoverHold> findByNodeIdAndStatus(UUID nodeId, String status);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.FailoverHoldTest" --console=plain`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/resources/db/migration/V16__failover_holds.sql \
  backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverHold.java \
  backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverHoldRepository.java \
  backend/src/test/java/com/nemesis/domain/aiops/failover/FailoverHoldTest.java
git commit -m "feat(sp4): FailoverHold 엔티티 + V16 마이그레이션 + 리포지토리

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: AiOperatorClient.decide + 데드라인 RestTemplate

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorClient.java`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverAibotConfig.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientDecideTest.java`

**Interfaces:**
- Consumes: `FailoverDtos.DecideResponse`, `AiOperatorProperties.getFailover().getDecideDeadlineMs()`.
- Produces: `AiOperatorClient.decide(Map<String,Object> ctx, Map<String,Object> sshTarget): DecideResponse` (실패 시 null). 신규 빈 `@Qualifier("aibotDecideRestTemplate") RestTemplate`.

- [ ] **Step 1: 데드라인 RestTemplate 빈 작성**

`FailoverAibotConfig.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.aiops.AiOperatorProperties;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import java.time.Duration;

@Configuration
public class FailoverAibotConfig {
    @Bean(name = "aibotDecideRestTemplate")
    public RestTemplate aibotDecideRestTemplate(RestTemplateBuilder builder, AiOperatorProperties props) {
        int deadline = props.getFailover().getDecideDeadlineMs();
        return builder.setConnectTimeout(Duration.ofSeconds(2))
                .setReadTimeout(Duration.ofMillis(deadline)).build();
    }
}
```

- [ ] **Step 2: 실패 테스트 작성**

`AiOperatorClientDecideTest.java`:
```java
package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.failover.FailoverDtos.DecideResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiOperatorClientDecideTest {
    RestTemplate rt; RestTemplate decideRt; AiOperatorProperties props; AiOperatorClient client;

    @BeforeEach void setup() {
        rt = mock(RestTemplate.class);
        decideRt = mock(RestTemplate.class);
        props = new AiOperatorProperties();
        props.setBaseUrl("http://localhost:18900");
        client = new AiOperatorClient(rt, decideRt, props);
    }

    @Test void decodesDecideResponse() {
        when(decideRt.postForObject(contains("/ai/decide"), any(), eq(DecideResponse.class)))
                .thenReturn(new DecideResponse("HOLD", 0.9, "서비스 살아있음"));
        DecideResponse r = client.decide(Map.of("hostname", "db2"), null);
        assertThat(r.action()).isEqualTo("HOLD");
    }
    @Test void returnsNullOnFailure() {
        when(decideRt.postForObject(anyString(), any(), eq(DecideResponse.class)))
                .thenThrow(new RuntimeException("timeout"));
        assertThat(client.decide(Map.of(), null)).isNull();
    }
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.AiOperatorClientDecideTest" --console=plain`
Expected: FAIL — 생성자 시그니처 불일치(decideRt 인자) + `decide` 없음.

- [ ] **Step 4: AiOperatorClient 수정**

생성자에 decide용 RestTemplate 주입, `decide` 메서드 추가. 파일 상단 import에 추가:
```java
import com.nemesis.domain.aiops.failover.FailoverDtos.DecideResponse;
import org.springframework.beans.factory.annotation.Qualifier;
```
생성자/필드 교체:
```java
    private final RestTemplate rt;
    private final RestTemplate decideRt;
    private final AiOperatorProperties props;

    public AiOperatorClient(RestTemplate restTemplate,
                            @Qualifier("aibotDecideRestTemplate") RestTemplate decideRt,
                            AiOperatorProperties props) {
        this.rt = restTemplate; this.decideRt = decideRt; this.props = props;
    }
```
메서드 추가(클래스 내부):
```java
    public DecideResponse decide(Map<String, Object> ctx, Map<String, Object> sshTarget) {
        try {
            Map<String, Object> payload = new java.util.HashMap<>();
            payload.put("context", ctx);
            payload.put("sshTarget", sshTarget);   // null 허용
            HttpEntity<Map<String, Object>> req = new HttpEntity<>(payload, headers());
            return decideRt.postForObject(props.getBaseUrl() + "/ai/decide", req, DecideResponse.class);
        } catch (Exception e) {
            log.warn("aibot decide 실패(폴백): {}", e.getMessage());
            return null;
        }
    }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.AiOperatorClientDecideTest" --console=plain`
Expected: PASS

> 참고: 기존 `AiOperatorClientTest`/`AiOperatorClientScanTest`가 `new AiOperatorClient(rt, props)`(2-인자)로 생성하므로 컴파일이 깨진다. 두 테스트의 생성자 호출을 `new AiOperatorClient(rt, mock(RestTemplate.class), props)`로 갱신하고 같은 커밋에 포함한다. (decide 외 메서드 동작은 동일)

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/AiOperatorClient.java \
  backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverAibotConfig.java \
  backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientDecideTest.java \
  backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientTest.java \
  backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientScanTest.java
git commit -m "feat(sp4): AiOperatorClient.decide + 데드라인 RestTemplate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: aibot 사이드카 /ai/decide 엔드포인트

**Files:**
- Modify: `/root/aibot/nemesis_service.py` (신규 라우트)
- Test: `/root/aibot/test_nemesis_service.py`

**Interfaces:**
- Produces: `POST /ai/decide` — 입력 `{context:{...probeResult...}, sshTarget?}`, 응답 `{action:"FAILOVER|HOLD", confidence:float, reasoning:str}`. 읽기 전용(쓰기 도구 미바인드). LLM 미설정/실패 시에도 결정론 폴백으로 유효 JSON 반환(serviceReachable→HOLD, 아니면 FAILOVER).

- [ ] **Step 1: 실패 테스트 작성**

`test_nemesis_service.py`에 추가:
```python
def test_decide_holds_when_service_reachable(client):
    resp = client.post("/ai/decide", json={
        "context": {
            "hostname": "db2", "role": "active", "triggerReason": "무응답",
            "probeResult": {"hostReachable": True, "serviceReachable": True, "details": []},
        },
        "sshTarget": None,
    }, headers=AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] in ("FAILOVER", "HOLD")
    assert body["action"] == "HOLD"           # 서비스 살아있음 → 보류

def test_decide_failover_when_all_dead(client):
    resp = client.post("/ai/decide", json={
        "context": {
            "hostname": "db2", "role": "active", "triggerReason": "무응답",
            "probeResult": {"hostReachable": False, "serviceReachable": False, "details": []},
        },
        "sshTarget": None,
    }, headers=AUTH)
    assert resp.json()["action"] == "FAILOVER"
```
(`client`/`AUTH` 픽스처는 기존 `test_nemesis_service.py` 패턴 재사용 — 없으면 SP1 테스트의 TestClient + Bearer 헤더 픽스처를 따른다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /root/aibot && python -m pytest test_nemesis_service.py -k decide -v`
Expected: FAIL — 404(라우트 없음).

- [ ] **Step 3: 엔드포인트 구현**

`nemesis_service.py`에 추가(기존 `/ai/scan` 라우트 패턴 따름). LLM 다단 추론을 시도하되, 실패/미설정 시 결정론 폴백:
```python
@app.post("/ai/decide")
async def ai_decide(req: Request, _: None = Depends(verify_token)):
    body = await req.json()
    ctx = body.get("context", {}) or {}
    probe = ctx.get("probeResult", {}) or {}
    service_reachable = bool(probe.get("serviceReachable"))
    host_reachable = bool(probe.get("hostReachable"))

    # 결정론 기본값: 서비스/호스트 도달 → 살아있을 공산 → HOLD, 둘 다 불도달 → FAILOVER
    fallback_action = "HOLD" if (service_reachable or host_reachable) else "FAILOVER"
    fallback_reason = ("서비스/호스트 포트 도달 → active 생존 추정, 페일오버 시 스플릿브레인 위험"
                       if fallback_action == "HOLD" else "host/서비스 모두 불도달 → 확정 사망")

    # LLM 다단 추론(읽기 전용 컨텍스트만; 실패 시 결정론 폴백)
    try:
        verdict = run_failover_reasoning(ctx)   # {"action","confidence","reasoning"} 또는 None
        if verdict and verdict.get("action") in ("FAILOVER", "HOLD"):
            return verdict
    except Exception as e:
        log.warning("decide 추론 실패, 결정론 폴백: %s", e)

    return {"action": fallback_action, "confidence": 0.6, "reasoning": fallback_reason}
```
`run_failover_reasoning(ctx)` — 기존 `LangGraphAgent`의 읽기전용 그래프(SP1 investigate에서 쓰는 read-only bind_tools)를 재사용해 프롬프트로 컨텍스트를 주고 JSON `{action,confidence,reasoning}`을 파싱한다. 쓰기/SSH 실행 도구는 바인드하지 않는다. (구현은 SP1 `run_investigation`과 동형; LLM 미설정이면 None 반환.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /root/aibot && python -m pytest test_nemesis_service.py -k decide -v`
Expected: PASS (LLM 미설정 환경에서도 결정론 폴백으로 통과)

- [ ] **Step 5: 커밋(aibot 레포)**

```bash
cd /root/aibot && git add nemesis_service.py test_nemesis_service.py
git commit -m "feat(sp4): /ai/decide 페일오버 판단 엔드포인트(읽기전용+결정론 폴백)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
> 사이드카 재시작: `systemctl restart nemesis-sidecar` (수동 nohup 금지).

---

### Task 10: AiFinding.FAILOVER_HELD + held finding 헬퍼

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFinding.java` (상수)
- Modify: `backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingService.java` (open/resolve held)
- Test: `backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingHeldTest.java`

**Interfaces:**
- Produces: 상수 `AiFinding.FAILOVER_HELD = "FAILOVER_HELD"`. `AiFindingService.openFailoverHeld(UUID clusterId, UUID nodeId, String hostname, String reasoning): AiFinding` (HIGH severity, OPEN, signalType=FAILOVER_HELD, diagnosis=reasoning, 반환). `AiFindingService.resolveFailoverHeld(UUID nodeId): void` (해당 OPEN finding RESOLVED).

- [ ] **Step 1: 실패 테스트 작성**

`AiFindingHeldTest.java`:
```java
package com.nemesis.domain.aiops.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.aiops.AiOperatorService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiFindingHeldTest {
    AiFindingRepository repo; AiOperatorService ops; LlmService llm; AiFindingService svc;
    UUID clusterId = UUID.randomUUID(); UUID nodeId = UUID.randomUUID();

    @BeforeEach void setup() {
        repo = mock(AiFindingRepository.class);
        ops = mock(AiOperatorService.class);
        llm = mock(LlmService.class);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        svc = new AiFindingService(repo, ops, new ObjectMapper(), llm);
    }

    @Test void openFailoverHeldCreatesHighFinding() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        svc.openFailoverHeld(clusterId, nodeId, "db2", "서비스 살아있음 → 보류");
        verify(repo).save(argThat(f -> AiFinding.FAILOVER_HELD.equals(f.getSignalType())
                && AiFinding.HIGH.equals(f.getSeverity())
                && "서비스 살아있음 → 보류".equals(f.getDiagnosis())));
    }
    @Test void resolveFailoverHeldMarksResolved() {
        AiFinding open = AiFinding.builder().id(UUID.randomUUID()).nodeId(nodeId)
                .signalType(AiFinding.FAILOVER_HELD).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(nodeId, AiFinding.FAILOVER_HELD)).build();
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.of(open));
        svc.resolveFailoverHeld(nodeId);
        verify(repo).save(argThat(f -> AiFinding.RESOLVED.equals(f.getStatus())));
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.monitor.AiFindingHeldTest" --console=plain`
Expected: FAIL — 상수/메서드 없음.

- [ ] **Step 3: 구현**

`AiFinding.java` 상수 라인에 `FAILOVER_HELD` 추가:
```java
    public static final String DISK_FULL = "DISK_FULL", MEM_HIGH = "MEM_HIGH",
            CPU_SUSTAINED = "CPU_SUSTAINED", LOG_ERROR_PATTERN = "LOG_ERROR_PATTERN",
            EVENT_SPIKE = "EVENT_SPIKE", FAILOVER_HELD = "FAILOVER_HELD", OTHER = "OTHER";
```
`AiFindingService.java`에 메서드 추가:
```java
    @Transactional
    public AiFinding openFailoverHeld(UUID clusterId, UUID nodeId, String hostname, String reasoning) {
        String fp = AiFinding.fingerprint(nodeId, AiFinding.FAILOVER_HELD);
        AiFinding f = repo.findByFingerprintAndStatus(fp, AiFinding.OPEN).orElseGet(() ->
                AiFinding.builder().id(java.util.UUID.randomUUID()).clusterId(clusterId).nodeId(nodeId)
                        .signalType(AiFinding.FAILOVER_HELD).fingerprint(fp).status(AiFinding.OPEN)
                        .firstSeenAt(OffsetDateTime.now()).createdAt(OffsetDateTime.now()).build());
        f.setSeverity(AiFinding.HIGH);
        f.setSummary("페일오버 보류 @ " + hostname);
        f.setDiagnosis(reasoning);
        f.setLastSeenAt(OffsetDateTime.now());
        return repo.save(f);
    }

    @Transactional
    public void resolveFailoverHeld(UUID nodeId) {
        String fp = AiFinding.fingerprint(nodeId, AiFinding.FAILOVER_HELD);
        repo.findByFingerprintAndStatus(fp, AiFinding.OPEN).ifPresent(f -> {
            f.setStatus(AiFinding.RESOLVED);
            f.setResolvedAt(OffsetDateTime.now());
            repo.save(f);
        });
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.monitor.AiFindingHeldTest" --console=plain`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFinding.java \
  backend/src/main/java/com/nemesis/domain/aiops/monitor/AiFindingService.java \
  backend/src/test/java/com/nemesis/domain/aiops/monitor/AiFindingHeldTest.java
git commit -m "feat(sp4): AiFinding FAILOVER_HELD + held 경보 open/resolve

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: FailoverDecisionService — 핵심 판단

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverDecisionService.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/failover/FailoverDecisionServiceTest.java`

**Interfaces:**
- Consumes: `NodeReachabilityProbe.probe(...)`, `ServicePortResolver.servicePorts(UUID)`, `AiOperatorClient.decide(...)`, `AiOperatorProperties.getFailover()`, `AiDecisionRepository.save(...)`, `AiFindingService.openFailoverHeld(...)`, `FailoverHoldRepository`, `NodeRepository`, `ObjectMapper`. 페일오버 대상 판정은 직접 주입 대신 `boolean hasFailoverTarget` 헬퍼: 같은 클러스터에 role=standby 노드 존재 여부(`NodeRepository.findByClusterId`).
- Produces: `FailoverDecisionService.decide(UUID clusterId, UUID nodeId, String reason): Verdict`. `Verdict.proceed()` → 호출자가 페일오버 수행.

- [ ] **Step 1: 실패 테스트 작성**

`FailoverDecisionServiceTest.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.ai.AiDecision;
import com.nemesis.domain.ai.AiDecisionRepository;
import com.nemesis.domain.aiops.AiOperatorClient;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.failover.FailoverDtos.*;
import com.nemesis.domain.aiops.monitor.AiFindingService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FailoverDecisionServiceTest {
    NodeReachabilityProbe probe; ServicePortResolver resolver; AiOperatorClient client;
    AiOperatorProperties props; AiDecisionRepository decisionRepo; AiFindingService findings;
    FailoverHoldRepository holdRepo; NodeRepository nodeRepo; FailoverDecisionService svc;
    UUID clusterId = UUID.randomUUID(); UUID nodeId = UUID.randomUUID();

    @BeforeEach void setup() {
        probe = mock(NodeReachabilityProbe.class); resolver = mock(ServicePortResolver.class);
        client = mock(AiOperatorClient.class); props = new AiOperatorProperties();
        decisionRepo = mock(AiDecisionRepository.class); findings = mock(AiFindingService.class);
        holdRepo = mock(FailoverHoldRepository.class); nodeRepo = mock(NodeRepository.class);
        when(decisionRepo.save(any())).thenAnswer(i -> i.getArgument(0));
        when(holdRepo.save(any())).thenAnswer(i -> i.getArgument(0));
        Node active = mock(Node.class);
        when(active.getId()).thenReturn(nodeId); when(active.getServiceIp()).thenReturn("10.0.0.12");
        when(active.getHostname()).thenReturn("db2");
        Node standby = mock(Node.class);
        when(standby.getId()).thenReturn(UUID.randomUUID()); when(standby.getRole()).thenReturn(Node.Role.standby);
        when(nodeRepo.findById(nodeId)).thenReturn(Optional.of(active));
        when(nodeRepo.findByClusterId(clusterId)).thenReturn(List.of(active, standby));
        when(resolver.servicePorts(clusterId)).thenReturn(List.of(1521));
        svc = new FailoverDecisionService(probe, resolver, client, props,
                decisionRepo, findings, holdRepo, nodeRepo, new ObjectMapper());
    }

    @Test void hostUnreachableWithTargetProceedsWithoutAibot() {
        when(probe.probe(any(), any(), any(), anyInt()))
                .thenReturn(new ProbeResult(false, false, List.of()));
        Verdict v = svc.decide(clusterId, nodeId, "무응답");
        assertThat(v.proceed()).isTrue();
        verify(client, never()).decide(any(), any());
        verify(decisionRepo).save(any(AiDecision.class));
    }
    @Test void reachableFailoverVerdictProceeds() {
        when(probe.probe(any(), any(), any(), anyInt()))
                .thenReturn(new ProbeResult(true, true, List.of()));
        when(client.decide(any(), any())).thenReturn(new DecideResponse("FAILOVER", 0.8, "서비스 죽음"));
        Verdict v = svc.decide(clusterId, nodeId, "무응답");
        assertThat(v.proceed()).isTrue();
    }
    @Test void reachableHoldVerdictHoldsAndOpensFinding() {
        when(probe.probe(any(), any(), any(), anyInt()))
                .thenReturn(new ProbeResult(true, true, List.of()));
        when(client.decide(any(), any())).thenReturn(new DecideResponse("HOLD", 0.9, "살아있음"));
        Verdict v = svc.decide(clusterId, nodeId, "무응답");
        assertThat(v.proceed()).isFalse();
        assertThat(v.held()).isTrue();
        verify(findings).openFailoverHeld(eq(clusterId), eq(nodeId), eq("db2"), anyString());
        verify(holdRepo).save(any(FailoverHold.class));
    }
    @Test void aibotUnavailableHoldsWhenReachable() {
        when(probe.probe(any(), any(), any(), anyInt()))
                .thenReturn(new ProbeResult(true, true, List.of()));
        when(client.decide(any(), any())).thenReturn(null);   // 판단 불가
        Verdict v = svc.decide(clusterId, nodeId, "무응답");
        assertThat(v.proceed()).isFalse();   // Q4-A
        assertThat(v.held()).isTrue();
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.FailoverDecisionServiceTest" --console=plain`
Expected: FAIL — `FailoverDecisionService` 없음.

- [ ] **Step 3: 구현**

`FailoverDecisionService.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.ai.AiDecision;
import com.nemesis.domain.ai.AiDecisionRepository;
import com.nemesis.domain.aiops.AiOperatorClient;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.failover.FailoverDtos.*;
import com.nemesis.domain.aiops.monitor.AiFindingService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

/** SP4: [독립 TCP 프로브 → (애매 시) aibot 다단 추론] 페일오버 판단. */
@Slf4j
@Service
public class FailoverDecisionService {
    private final NodeReachabilityProbe probe;
    private final ServicePortResolver resolver;
    private final AiOperatorClient client;
    private final AiOperatorProperties props;
    private final AiDecisionRepository decisionRepo;
    private final AiFindingService findings;
    private final FailoverHoldRepository holdRepo;
    private final NodeRepository nodeRepo;
    private final ObjectMapper mapper;

    public FailoverDecisionService(NodeReachabilityProbe probe, ServicePortResolver resolver,
                                   AiOperatorClient client, AiOperatorProperties props,
                                   AiDecisionRepository decisionRepo, AiFindingService findings,
                                   FailoverHoldRepository holdRepo, NodeRepository nodeRepo, ObjectMapper mapper) {
        this.probe = probe; this.resolver = resolver; this.client = client; this.props = props;
        this.decisionRepo = decisionRepo; this.findings = findings; this.holdRepo = holdRepo;
        this.nodeRepo = nodeRepo; this.mapper = mapper;
    }

    @Transactional
    public Verdict decide(UUID clusterId, UUID nodeId, String reason) {
        Node node = nodeRepo.findById(nodeId).orElse(null);
        if (node == null) return new Verdict(true, false, "노드 없음 — 안전하게 진행");
        AiOperatorProperties.Failover cfg = props.getFailover();

        ProbeResult pr = probe.probe(node.getServiceIp(), cfg.getProbePorts(),
                resolver.servicePorts(clusterId), cfg.getProbeTimeoutMs());

        if (!pr.hostReachable() && hasFailoverTarget(clusterId, nodeId)) {
            record(clusterId, nodeId, "tcp-probe", "FAILOVER", 1.0,
                    "host 불도달 → 확정 사망: " + reason, true);
            return new Verdict(true, false, "확정 사망(host 불도달)");
        }

        DecideResponse d = client.decide(buildContext(node, reason, pr), null);
        boolean proceed = d != null && "FAILOVER".equalsIgnoreCase(d.action());
        String prov = d != null ? "aibot" : "fallback";
        double conf = d != null ? d.confidence() : 0.6;
        String why = d != null ? d.reasoning() : "aibot 판단 불가 → 보류(스플릿브레인 회피)";
        record(clusterId, nodeId, prov, proceed ? "FAILOVER" : "HOLD", conf, why, d == null);

        if (proceed) return new Verdict(true, false, "aibot FAILOVER: " + why);
        openHold(clusterId, node, why, pr);
        return new Verdict(false, true, "보류: " + why);
    }

    private boolean hasFailoverTarget(UUID clusterId, UUID selfId) {
        for (Node n : nodeRepo.findByClusterId(clusterId)) {
            if (!n.getId().equals(selfId) && n.getRole() == Node.Role.standby) return true;
        }
        return false;
    }

    private void openHold(UUID clusterId, Node node, String reasoning, ProbeResult pr) {
        var finding = findings.openFailoverHeld(clusterId, node.getId(), node.getHostname(), reasoning);
        if (holdRepo.findByNodeIdAndStatus(node.getId(), FailoverHold.HELD).isPresent()) return;
        holdRepo.save(FailoverHold.builder()
                .id(UUID.randomUUID()).clusterId(clusterId).nodeId(node.getId())
                .reason(reasoning).probeResult(toJson(pr)).status(FailoverHold.HELD)
                .findingId(finding != null ? finding.getId() : null)
                .createdAt(OffsetDateTime.now()).lastProbedAt(OffsetDateTime.now()).build());
    }

    private Map<String, Object> buildContext(Node node, String reason, ProbeResult pr) {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("hostname", node.getHostname());
        ctx.put("role", node.getRole() != null ? node.getRole().name() : "?");
        ctx.put("triggerReason", reason);
        ctx.put("probeResult", Map.of("hostReachable", pr.hostReachable(),
                "serviceReachable", pr.serviceReachable(), "details", pr.details()));
        return ctx;
    }

    private void record(UUID clusterId, UUID nodeId, String provider, String action,
                        double confidence, String reason, boolean fallback) {
        decisionRepo.save(AiDecision.builder()
                .clusterGroupId(clusterId).nodeId(nodeId).provider(provider)
                .action(action).confidence(confidence).reason(reason).fallback(fallback).build());
    }

    private String toJson(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.FailoverDecisionServiceTest" --console=plain`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverDecisionService.java \
  backend/src/test/java/com/nemesis/domain/aiops/failover/FailoverDecisionServiceTest.java
git commit -m "feat(sp4): FailoverDecisionService — 프로브+aibot 판단 파이프라인

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: FailoverHoldScheduler — held 재평가

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverHoldScheduler.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/failover/FailoverHoldSchedulerTest.java`

**Interfaces:**
- Consumes: `FailoverHoldRepository.findByStatus("HELD")`, `NodeReachabilityProbe`, `ServicePortResolver`, `AiOperatorProperties`, `NodeRepository`, `AiFindingService.resolveFailoverHeld(UUID)`. 페일오버 수행은 함수형 콜백 `FailoverTrigger` 주입(`FailoverOrchestrator` 직접 의존 회피, 테스트 용이).
- Produces: `FailoverHoldScheduler.reevaluate()` — HELD 재프로브 → host 불도달이면 콜백으로 페일오버 + RESOLVED_FAILOVER; node가 fault 아니면(복귀) RESOLVED_RECOVERED + finding 해소; 그 외 HELD 유지(lastProbedAt 갱신).

- [ ] **Step 1: 실패 테스트 작성**

`FailoverHoldSchedulerTest.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.failover.FailoverDtos.ProbeResult;
import com.nemesis.domain.aiops.monitor.AiFindingService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FailoverHoldSchedulerTest {
    FailoverHoldRepository holdRepo; NodeReachabilityProbe probe; ServicePortResolver resolver;
    AiOperatorProperties props; NodeRepository nodeRepo; AiFindingService findings;
    FailoverHoldScheduler svc;
    UUID clusterId = UUID.randomUUID(); UUID nodeId = UUID.randomUUID();
    AtomicReference<UUID> failedOver = new AtomicReference<>();

    @BeforeEach void setup() {
        holdRepo = mock(FailoverHoldRepository.class); probe = mock(NodeReachabilityProbe.class);
        resolver = mock(ServicePortResolver.class); props = new AiOperatorProperties();
        nodeRepo = mock(NodeRepository.class); findings = mock(AiFindingService.class);
        when(holdRepo.save(any())).thenAnswer(i -> i.getArgument(0));
        svc = new FailoverHoldScheduler(holdRepo, probe, resolver, props, nodeRepo, findings,
                (cid, nid) -> failedOver.set(nid));   // FailoverTrigger 콜백
    }
    private FailoverHold held() {
        return FailoverHold.builder().id(UUID.randomUUID()).clusterId(clusterId).nodeId(nodeId)
                .status(FailoverHold.HELD).build();
    }
    private Node node(Node.Role role) {
        Node n = mock(Node.class); when(n.getId()).thenReturn(nodeId);
        when(n.getServiceIp()).thenReturn("10.0.0.12"); when(n.getRole()).thenReturn(role);
        return n;
    }

    @Test void unreachableTriggersFailover() {
        when(holdRepo.findByStatus(FailoverHold.HELD)).thenReturn(List.of(held()));
        when(nodeRepo.findById(nodeId)).thenReturn(Optional.of(node(Node.Role.fault)));
        when(probe.probe(any(), any(), any(), anyInt())).thenReturn(new ProbeResult(false, false, List.of()));
        svc.reevaluate();
        assertThat(failedOver.get()).isEqualTo(nodeId);
        verify(holdRepo).save(argThat(h -> FailoverHold.RESOLVED_FAILOVER.equals(h.getStatus())));
    }
    @Test void recoveredResolvesHold() {
        when(holdRepo.findByStatus(FailoverHold.HELD)).thenReturn(List.of(held()));
        when(nodeRepo.findById(nodeId)).thenReturn(Optional.of(node(Node.Role.active)));  // 복귀
        svc.reevaluate();
        verify(holdRepo).save(argThat(h -> FailoverHold.RESOLVED_RECOVERED.equals(h.getStatus())));
        verify(findings).resolveFailoverHeld(nodeId);
    }
    @Test void stillReachableStaysHeld() {
        when(holdRepo.findByStatus(FailoverHold.HELD)).thenReturn(List.of(held()));
        when(nodeRepo.findById(nodeId)).thenReturn(Optional.of(node(Node.Role.fault)));
        when(probe.probe(any(), any(), any(), anyInt())).thenReturn(new ProbeResult(true, true, List.of()));
        svc.reevaluate();
        assertThat(failedOver.get()).isNull();
        verify(holdRepo, never()).save(argThat(h -> h.getStatus().startsWith("RESOLVED")));
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.FailoverHoldSchedulerTest" --console=plain`
Expected: FAIL — `FailoverHoldScheduler`/`FailoverTrigger` 없음.

- [ ] **Step 3: 구현**

`FailoverHoldScheduler.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.failover.FailoverDtos.ProbeResult;
import com.nemesis.domain.aiops.monitor.AiFindingService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

/** SP4: held 노드 재평가 — 진짜 죽으면 페일오버, 복귀하면 해소. */
@Slf4j
@Component
public class FailoverHoldScheduler {

    /** 페일오버 수행 콜백(FailoverOrchestrator 직접 의존 회피). */
    @FunctionalInterface
    public interface FailoverTrigger { void failover(UUID clusterId, UUID nodeId); }

    private final FailoverHoldRepository holdRepo;
    private final NodeReachabilityProbe probe;
    private final ServicePortResolver resolver;
    private final AiOperatorProperties props;
    private final NodeRepository nodeRepo;
    private final AiFindingService findings;
    private final FailoverTrigger trigger;

    public FailoverHoldScheduler(FailoverHoldRepository holdRepo, NodeReachabilityProbe probe,
                                 ServicePortResolver resolver, AiOperatorProperties props,
                                 NodeRepository nodeRepo, AiFindingService findings, FailoverTrigger trigger) {
        this.holdRepo = holdRepo; this.probe = probe; this.resolver = resolver; this.props = props;
        this.nodeRepo = nodeRepo; this.findings = findings; this.trigger = trigger;
    }

    @Scheduled(fixedDelayString = "${nemesis.aiops.failover.reeval-interval-ms:20000}")
    public void tick() {
        if (!props.getFailover().isEnabled()) return;
        try { reevaluate(); } catch (Exception e) { log.warn("held 재평가 실패: {}", e.getMessage()); }
    }

    @Transactional
    public void reevaluate() {
        AiOperatorProperties.Failover cfg = props.getFailover();
        for (FailoverHold h : holdRepo.findByStatus(FailoverHold.HELD)) {
            Node node = nodeRepo.findById(h.getNodeId()).orElse(null);
            if (node == null) { resolve(h, FailoverHold.RESOLVED_RECOVERED); continue; }

            if (node.getRole() != Node.Role.fault) {     // 복귀
                findings.resolveFailoverHeld(node.getId());
                resolve(h, FailoverHold.RESOLVED_RECOVERED);
                continue;
            }
            ProbeResult pr = probe.probe(node.getServiceIp(), cfg.getProbePorts(),
                    resolver.servicePorts(h.getClusterId()), cfg.getProbeTimeoutMs());
            if (!pr.hostReachable()) {                   // 이제 진짜 죽음
                trigger.failover(h.getClusterId(), node.getId());
                findings.resolveFailoverHeld(node.getId());
                resolve(h, FailoverHold.RESOLVED_FAILOVER);
            } else {                                     // 여전히 살아있음 → 유지
                h.setLastProbedAt(OffsetDateTime.now());
                holdRepo.save(h);
            }
        }
    }

    private void resolve(FailoverHold h, String status) {
        h.setStatus(status);
        h.setResolvedAt(OffsetDateTime.now());
        holdRepo.save(h);
    }
}
```

> 빈 주입: `FailoverTrigger`는 `FailoverConfig`(신규, 아래)에서 `FailoverOrchestrator` 람다로 제공한다. Task 13에서 함께 추가하거나 여기서 작은 @Configuration을 만든다. 단위 테스트는 람다를 직접 주입하므로 무관.

- [ ] **Step 4: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.aiops.failover.FailoverHoldSchedulerTest" --console=plain`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverHoldScheduler.java \
  backend/src/test/java/com/nemesis/domain/aiops/failover/FailoverHoldSchedulerTest.java
git commit -m "feat(sp4): FailoverHoldScheduler — held 재평가/자동 페일오버

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: FailoverTrigger 빈 + FailoverTriggerListener 결선

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverConfig.java`
- Modify: `backend/src/main/java/com/nemesis/domain/failover/FailoverTriggerListener.java`
- Test: `backend/src/test/java/com/nemesis/domain/failover/FailoverTriggerListenerSp4Test.java`

**Interfaces:**
- Consumes: `AiOperatorProperties.getFailover().isEnabled()`, `FailoverDecisionService.decide(...)`, 기존 `AiDecisionService`/`FailoverOrchestrator`.
- Produces: `FailoverConfig` — `FailoverHoldScheduler.FailoverTrigger` 빈(= `orchestrator.failover(cid, nid, null, DETECTION, "재평가")`).

- [ ] **Step 1: FailoverTrigger 빈 작성**

`FailoverConfig.java`:
```java
package com.nemesis.domain.aiops.failover;

import com.nemesis.domain.failover.FailoverHistory;
import com.nemesis.domain.failover.FailoverOrchestrator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FailoverConfig {
    @Bean
    public FailoverHoldScheduler.FailoverTrigger failoverTrigger(FailoverOrchestrator orchestrator) {
        return (clusterId, nodeId) -> orchestrator.failover(
                clusterId, nodeId, null, FailoverHistory.Trigger.DETECTION, "SP4 재평가: host 불도달 전환");
    }
}
```

- [ ] **Step 2: 실패 테스트 작성**

`FailoverTriggerListenerSp4Test.java`:
```java
package com.nemesis.domain.failover;

import com.nemesis.detection.NodeFaultEvent;
import com.nemesis.domain.ai.AiDecisionService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.AiOperatorService;
import com.nemesis.domain.aiops.failover.FailoverDecisionService;
import com.nemesis.domain.aiops.failover.FailoverDtos.Verdict;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FailoverTriggerListenerSp4Test {
    FailoverOrchestrator orch; ClusterRepository clusterRepo; AiDecisionService aiDecision;
    AiOperatorService aiOps; FailoverDecisionService failoverDecision; AiOperatorProperties props;
    FailoverTriggerListener listener;
    UUID clusterId = UUID.randomUUID(); UUID nodeId = UUID.randomUUID();

    @BeforeEach void setup() {
        orch = mock(FailoverOrchestrator.class); clusterRepo = mock(ClusterRepository.class);
        aiDecision = mock(AiDecisionService.class); aiOps = mock(AiOperatorService.class);
        failoverDecision = mock(FailoverDecisionService.class); props = new AiOperatorProperties();
        Cluster c = mock(Cluster.class); when(c.getId()).thenReturn(clusterId); when(c.isAiEnabled()).thenReturn(true);
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(c));
        when(orch.failover(any(), any(), any(), any(), anyString()))
                .thenReturn(new FailoverOrchestrator.Result(FailoverOrchestrator.Status.SUCCEEDED, "ok", null));
        listener = new FailoverTriggerListener(orch, clusterRepo, aiDecision, aiOps, failoverDecision, props);
    }

    @Test void usesFailoverDecisionWhenEnabled() {
        props.getFailover().setEnabled(true);
        when(failoverDecision.decide(clusterId, nodeId, "무응답")).thenReturn(new Verdict(false, true, "보류"));
        listener.onNodeFault(new NodeFaultEvent(clusterId, nodeId, "db2", "무응답"));
        verify(failoverDecision).decide(clusterId, nodeId, "무응답");
        verify(aiDecision, never()).shouldFailover(any(), any(), anyString());
        verify(orch, never()).failover(any(), any(), any(), any(), anyString());   // 보류
    }
    @Test void fallsBackToLegacyWhenDisabled() {
        props.getFailover().setEnabled(false);
        when(aiDecision.shouldFailover(any(), any(), anyString()))
                .thenReturn(new AiDecisionService.Verdict(true, "rule"));
        listener.onNodeFault(new NodeFaultEvent(clusterId, nodeId, "db2", "무응답"));
        verify(aiDecision).shouldFailover(clusterId, nodeId, "무응답");
        verify(failoverDecision, never()).decide(any(), any(), anyString());
    }
}
```
> 참고: `FailoverOrchestrator.Result`/`Status` 생성자 시그니처는 기존 코드 기준으로 맞춘다(`FailoverOrchestratorTest` 참조). 필드가 다르면 테스트의 stub만 해당 시그니처로 조정한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `... gradle test --tests "com.nemesis.domain.failover.FailoverTriggerListenerSp4Test" --console=plain`
Expected: FAIL — 생성자 시그니처 불일치(failoverDecision/props 미주입).

- [ ] **Step 4: FailoverTriggerListener 수정**

필드/생성자에 `FailoverDecisionService failoverDecision`, `AiOperatorProperties aiopsProps` 추가. `onNodeFault`의 AI 판단 분기 교체:
```java
            if (aiopsProps.getFailover().isEnabled()) {
                var v = failoverDecision.decide(ev.clusterId(), ev.nodeId(), ev.reason());
                if (!v.proceed()) { log.warn("SP4 판단으로 페일오버 보류: {} ({})", ev.hostname(), v.reason()); return; }
            } else if (cluster != null && cluster.isAiEnabled()) {
                AiDecisionService.Verdict v =
                        aiDecisionService.shouldFailover(ev.clusterId(), ev.nodeId(), ev.reason());
                if (!v.proceed()) {
                    log.warn("AI 판단으로 페일오버 보류: {} ({})", ev.hostname(), v.reason());
                    return;
                }
            }
```
(이후 기존 `orchestrator.failover(...)` + ROOT_CAUSE 조사 호출은 그대로 유지.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `... gradle test --tests "com.nemesis.domain.failover.FailoverTriggerListenerSp4Test" --console=plain`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/aiops/failover/FailoverConfig.java \
  backend/src/main/java/com/nemesis/domain/failover/FailoverTriggerListener.java \
  backend/src/test/java/com/nemesis/domain/failover/FailoverTriggerListenerSp4Test.java
git commit -m "feat(sp4): FailoverTriggerListener SP4 결선 + FailoverTrigger 빈

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: 프론트엔드 — 서비스 카탈로그 포트 표시/보정

**Files:**
- Modify: `frontend/src/pages/ServiceCatalog.jsx` (포트 표시 + 편집 입력)

**Interfaces:**
- Consumes: catalog 항목의 `port`(Task 1), `updateManagedService(clusterId, serviceId, {port})`(기존 `client.js`).

- [ ] **Step 1: 포트 표시 추가**

서비스 행 렌더링에서 displayName/type 근처에 포트 배지 추가(자동 캡처값):
```jsx
{svc.port ? (
  <span className="text-[10px] font-mono text-sky-300 ml-2">:{svc.port}</span>
) : (
  <span className="text-[10px] text-gray-500 ml-2">포트 미확보</span>
)}
```

- [ ] **Step 2: 포트 수동 보정 입력 추가**

서비스 편집 영역(이미 displayName/type/haManaged 편집이 있는 모달/행)에 포트 입력 1칸 추가:
```jsx
<input
  type="number" defaultValue={svc.port ?? ''} placeholder="포트(자동/수동)"
  onBlur={e => {
    const v = e.target.value.trim()
    updateManagedService(clusterId, svc.id, { port: v === '' ? null : Number(v) })
      .then(reload).catch(() => {})
  }}
  className="w-24 bg-gray-800 rounded text-xs px-2 py-1 text-gray-300"
/>
```
(`reload`는 카탈로그 재조회 함수 — 기존 패턴 재사용. 없으면 기존 `loadCatalog`/`refresh` 함수명으로 맞춘다.)

- [ ] **Step 3: 빌드 검증**

Run: `cd /var/www/html/Nemesis_v100/frontend && npm run build 2>&1 | tail -5`
Expected: `✓ built` (에러 없음)

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/ServiceCatalog.jsx
git commit -m "feat(sp4): 서비스 카탈로그 포트 표시 + 수동 보정 입력

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: 통합 빌드 검증 + 점진 활성 스모크

**Files:** (코드 변경 없음 — 검증/문서)
- Modify: `.env` 또는 `application.yml`(로컬에서만, 미커밋) — `NEMESIS_AIOPS_FAILOVER_ENABLED=true`

- [ ] **Step 1: 전체 백엔드 테스트**

Run: `docker run --rm -v /var/www/html/Nemesis_v100/backend:/app -v gradle-cache:/home/gradle/.gradle -w /app gradle:8.7-jdk17 gradle test --console=plain 2>&1 | tail -15`
Expected: `BUILD SUCCESSFUL` — 전체 테스트 통과(신규 + 기존 회귀 없음).

- [ ] **Step 2: 전체 컴파일/패키지**

Run: `docker run --rm -v /var/www/html/Nemesis_v100/backend:/app -v gradle-cache:/home/gradle/.gradle -w /app gradle:8.7-jdk17 gradle bootJar --console=plain 2>&1 | tail -8`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: aibot 테스트**

Run: `cd /root/aibot && python -m pytest test_nemesis_service.py -v 2>&1 | tail -15`
Expected: 전체 PASS

- [ ] **Step 4: 점진 활성 스모크 (수동, 옵션)**

`.env`에 `NEMESIS_AIOPS_FAILOVER_ENABLED=true` 추가 후 백엔드 재기동. 무응답 모의(테스트 노드 메트릭 중단) → `failover_holds`에 HELD 등장 + 대시보드 "열린 이슈"에 `FAILOVER_HELD` + 벨. 서비스 포트 열린 상태면 페일오버 안 됨, 노드 완전 다운이면 빠른 페일오버 확인.
> ⚠️ 사이드카 `/ai/decide` 가동 필요(`systemctl restart nemesis-sidecar`). 에이전트 포트 보고는 collect.sh 재배포 후 반영.

- [ ] **Step 5: 최종 커밋(있으면)**

```bash
git add -A backend/src docs
git commit -m "test(sp4): 통합 빌드/테스트 검증 통과

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 자기 검토 (Self-Review)

**스펙 커버리지:**
- §3 컴포넌트 전부 태스크 매핑: NodeReachabilityProbe(T4), ServicePortResolver(T5), ServicePortCapture(T3/T6), FailoverDecisionService(T11), FailoverHold+Repo(T7), FailoverHoldScheduler(T12) ✅
- §4.2 포트 자동연동(에이전트 T2, 캡처 T3, 컬럼 T1, resolver T5, UI T14) ✅
- §4.4 aibot /ai/decide(T9) ✅
- §4.5/4.6 DecideResponse·Verdict·판단 로직(T4 DTO, T8 client, T11 service) ✅
- §4.7 설정(T6) ✅
- §5 오류처리: aibot 불통→HOLD(T11), host 불도달→페일오버(T11), held 재평가(T12), enabled=false 폴백(T13) ✅
- §6 테스트: 명시된 모든 단위 테스트 클래스 포함 ✅
- HOLD 경보=AiFinding 재사용(T10), 벨/열린이슈는 SP3 UI 그대로(프론트 신규 불요) ✅

**플레이스홀더 스캔:** 모든 코드 스텝에 실제 코드 포함. "TBD/적절히 처리" 없음. (aibot `run_failover_reasoning`은 "SP1 run_investigation과 동형"으로 구체 지시 — SP1 코드 참조 가능.)

**타입 일관성:** `Verdict(proceed,held,reason)`, `ProbeResult(hostReachable,serviceReachable,details)`, `DecideResponse(action,confidence,reasoning)`, `FailoverHold.HELD/RESOLVED_FAILOVER/RESOLVED_RECOVERED`, `AiFinding.FAILOVER_HELD` — 정의(T4/T7/T10)와 소비(T11/T12/T13) 시그니처 일치 확인 ✅

**알려진 결선 의존성(태스크 간):** T6이 T3의 생성자에 props 추가(테스트 동기 갱신 명시), T8이 기존 AiOperatorClient 2-인자 테스트 갱신 명시, T13이 FailoverTrigger 빈으로 T12 스케줄러 결선. 모두 해당 태스크 스텝에 기재.
