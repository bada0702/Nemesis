# Nemesis v1.0 — 리눅스 이전 & 실백엔드 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 Windows + mock-api.js 환경을 Linux 서버로 이전하고, Spring Boot + PostgreSQL 실백엔드와 Python 에이전트를 연결해 실제 운영 가능한 HA 모니터링 시스템으로 완성한다.

**Architecture:** Spring Boot API 서버(포트 18080) + PostgreSQL + Vite 빌드 정적파일(Nginx 18090)을 Docker Compose로 구성. 각 모니터링 대상 서버에는 `nemesis-agent.py`가 데몬으로 실행되어 3초마다 메트릭을 Push한다. 프론트엔드는 UUID 기반 API를 직접 호출한다.

**Tech Stack:** Spring Boot 3, JPA/Flyway, PostgreSQL 15, React/Vite, Nginx, Python 3, Docker Compose

---

## 현재 상태 (시작점)

- ✅ Spring Boot 백엔드 골격 (`backend/`) — 일부 API 미구현
- ✅ Frontend React SPA (`frontend/`) — mock-api.js에 연결된 상태
- ✅ Docker Compose 정의 (`docker-compose.yml`)
- ✅ Python 에이전트 기반 코드 (`agent/nemesis-agent.py`)
- ❌ 프론트엔드가 numeric ID 사용 → 백엔드는 UUID 사용 (불일치)
- ❌ ClusterController: PUT/DELETE 미구현
- ❌ `/gpfs`, `/network`, `/ai-analysis`, `/agent`, `/failover` 엔드포인트 미구현
- ❌ 노드 CRUD API 미구현
- ❌ `agent/collect.sh` 실제 수집 로직 없음
- ❌ 프론트엔드 Vite proxy 미설정

---

## 파일 변경 맵

### 백엔드 (신규 생성)
- `backend/src/main/java/com/nemesis/domain/cluster/ClusterController.java` — PUT, DELETE 추가
- `backend/src/main/java/com/nemesis/domain/node/NodeController.java` — 노드 CRUD
- `backend/src/main/java/com/nemesis/domain/dashboard/ClusterAgentController.java` — `/agent`, `/gpfs`, `/network` 엔드포인트
- `backend/src/main/java/com/nemesis/domain/failover/FailoverController.java` — 수동 Failover
- `backend/src/main/java/com/nemesis/domain/failover/FailoverService.java`
- `backend/src/main/resources/db/migration/V4__node_vip.sql` — nodes 테이블에 vip 컬럼 추가

### 백엔드 (수정)
- `backend/src/main/java/com/nemesis/domain/cluster/ClusterService.java` — update(), delete() 추가
- `backend/src/main/java/com/nemesis/domain/node/NodeService.java` — createNode(), updateNode(), deleteNode() 추가
- `backend/src/main/java/com/nemesis/domain/ai/AiFaultService.java` — 실제 AI 분석 구현

### 프론트엔드 (수정)
- `frontend/vite.config.js` — `/api` → `http://localhost:18080` 프록시 설정
- `frontend/src/api/client.js` — UUID 지원, 엔드포인트 정렬
- `frontend/src/pages/Dashboard.jsx` — UUID 기반 클러스터 ID 처리
- `frontend/src/pages/ClusterDetail.jsx` — UUID 파라미터 처리
- `frontend/src/pages/ClusterSettings.jsx` — UUID 파라미터 처리
- `frontend/src/pages/Topology.jsx` — UUID 파라미터 처리

### 에이전트
- `agent/collect.sh` — Linux 메트릭 수집 실제 구현
- `agent/collect_aix.sh` — AIX 메트릭 수집 (추후)
- `agent/install.sh` — 에이전트 자동 설치 스크립트

---

## Phase 0 — Linux 서버 이전

### Task 0-1: 서버 환경 구성

**Prerequisites:** Ubuntu 22.04+ 또는 RHEL 8+ 서버, Docker 24+, Docker Compose v2

- [ ] **서버 접속 및 Docker 설치**

```bash
# Ubuntu
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker

# RHEL/CentOS
sudo dnf install -y docker docker-compose-plugin git
sudo systemctl enable --now docker
```

- [ ] **프로젝트 클론**

```bash
git clone <repo-url> /opt/nemesis
cd /opt/nemesis
cp .env.example .env
```

- [ ] **.env 수정** — 실제 비밀번호로 변경

```bash
# .env
DB_PASSWORD=<강한_패스워드>
LLM_PROVIDER=ollama          # or anthropic
LLM_MODEL=gemma3:12b
NEMESIS_API_PORT=18080
NEMESIS_UI_PORT=18090
```

- [ ] **검증**: `docker compose config` 오류 없는지 확인

---

## Phase 1 — 백엔드 API 완성

### Task 1-1: DB 마이그레이션 — nodes 테이블 vip 컬럼 추가

`nodes` 테이블에 `vip` 컬럼이 없어 프론트엔드 노드 추가 시 VIP 저장 불가.

**Files:**
- Create: `backend/src/main/resources/db/migration/V4__node_vip.sql`
- Modify: `backend/src/main/java/com/nemesis/domain/node/Node.java`

- [ ] **V4 마이그레이션 파일 작성**

```sql
-- V4__node_vip.sql
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS vip VARCHAR(50);
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50);
```

- [ ] **Node 엔티티에 필드 추가**

`Node.java` 에서 기존 `serviceIp`, `heartbeatIp` 외에:
```java
@Column(name = "vip")
private String vip;

@Column(name = "ip_address")
private String ipAddress;
```

- [ ] **Docker Compose로 DB 기동 후 마이그레이션 확인**

```bash
docker compose up postgres -d
docker compose run --rm nemesis-server ./gradlew flywayMigrate
```
Expected: `Successfully applied 1 migration to schema "public"`

---

### Task 1-2: Cluster CRUD 완성 (PUT, DELETE)

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/cluster/ClusterController.java`
- Modify: `backend/src/main/java/com/nemesis/domain/cluster/ClusterService.java`

- [ ] **ClusterService에 update(), delete() 추가**

```java
@Transactional
public Cluster update(UUID id, Map<String, Object> body) {
    Cluster c = findById(id);
    if (body.get("name") != null) c.setName((String) body.get("name"));
    if (body.get("vip")  != null) c.setVip((String) body.get("vip"));
    return clusterRepository.save(c);
}

@Transactional
public void delete(UUID id) {
    if (!clusterRepository.existsById(id))
        throw new IllegalArgumentException("Cluster not found: " + id);
    clusterRepository.deleteById(id);
}
```

- [ ] **ClusterController에 PUT, DELETE 엔드포인트 추가**

```java
@PutMapping("/{id}")
public ResponseEntity<Cluster> update(@PathVariable UUID id,
                                       @RequestBody Map<String, Object> body) {
    return ResponseEntity.ok(clusterService.update(id, body));
}

@DeleteMapping("/{id}")
public ResponseEntity<Void> delete(@PathVariable UUID id) {
    clusterService.delete(id);
    return ResponseEntity.noContent().build();
}
```

- [ ] **테스트 실행**

```bash
cd backend && ./gradlew test --tests "com.nemesis.cluster.ClusterControllerTest" -i
```

---

### Task 1-3: Node CRUD API 구현

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/node/NodeController.java`
- Modify: `backend/src/main/java/com/nemesis/domain/node/NodeService.java`
- Modify: `backend/src/main/java/com/nemesis/domain/node/NodeRepository.java`

- [ ] **NodeRepository에 메서드 추가**

```java
public interface NodeRepository extends JpaRepository<Node, UUID> {
    List<Node> findByClusterId(UUID clusterId);
    Optional<Node> findByClusterIdAndHostname(UUID clusterId, String hostname);
}
```

- [ ] **NodeService에 CRUD 메서드 추가**

```java
@Transactional
public Node createNode(UUID clusterId, Map<String, Object> body) {
    Cluster cluster = clusterRepository.findById(clusterId)
        .orElseThrow(() -> new IllegalArgumentException("Cluster not found"));
    Node node = Node.builder()
        .cluster(cluster)
        .hostname((String) body.get("hostname"))
        .ipAddress((String) body.get("ipAddress"))
        .vip((String) body.get("vip"))
        .osType(Node.OsType.valueOf(
            ((String) body.getOrDefault("osType", "LINUX")).toUpperCase()))
        .role(Node.Role.valueOf(
            ((String) body.getOrDefault("role", "STANDBY")).toUpperCase()))
        .build();
    return nodeRepository.save(node);
}

@Transactional
public Node updateNode(UUID clusterId, UUID nodeId, Map<String, Object> body) {
    Node node = nodeRepository.findById(nodeId)
        .filter(n -> n.getCluster().getId().equals(clusterId))
        .orElseThrow(() -> new IllegalArgumentException("Node not found"));
    if (body.get("hostname")  != null) node.setHostname((String) body.get("hostname"));
    if (body.get("ipAddress") != null) node.setIpAddress((String) body.get("ipAddress"));
    if (body.get("vip")       != null) node.setVip((String) body.get("vip"));
    if (body.get("osType")    != null) node.setOsType(Node.OsType.valueOf(
        ((String) body.get("osType")).toUpperCase()));
    if (body.get("role")      != null) node.setRole(Node.Role.valueOf(
        ((String) body.get("role")).toUpperCase()));
    return nodeRepository.save(node);
}

@Transactional
public void deleteNode(UUID clusterId, UUID nodeId) {
    Node node = nodeRepository.findById(nodeId)
        .filter(n -> n.getCluster().getId().equals(clusterId))
        .orElseThrow(() -> new IllegalArgumentException("Node not found"));
    nodeRepository.delete(node);
}

public List<Node> getNodes(UUID clusterId) {
    return nodeRepository.findByClusterId(clusterId);
}
```

- [ ] **NodeController 신규 작성**

```java
@RestController
@RequestMapping("/api/clusters/{clusterId}/nodes")
@RequiredArgsConstructor
public class NodeController {

    private final NodeService nodeService;

    @GetMapping
    public ResponseEntity<List<Node>> list(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(nodeService.getNodes(clusterId));
    }

    @PostMapping
    public ResponseEntity<Node> create(@PathVariable UUID clusterId,
                                        @RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(nodeService.createNode(clusterId, body));
    }

    @PutMapping("/{nodeId}")
    public ResponseEntity<Node> update(@PathVariable UUID clusterId,
                                        @PathVariable UUID nodeId,
                                        @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(nodeService.updateNode(clusterId, nodeId, body));
    }

    @DeleteMapping("/{nodeId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId,
                                        @PathVariable UUID nodeId) {
        nodeService.deleteNode(clusterId, nodeId);
        return ResponseEntity.noContent().build();
    }
}
```

---

### Task 1-4: 에이전트 데이터 / GPFS / 네트워크 엔드포인트 구현

mock-api.js의 `/agent`, `/gpfs`, `/network` 엔드포인트를 실백엔드에 구현.
에이전트가 Push한 메트릭은 `MetricsCacheService`(인메모리)에서 읽는다.

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/dashboard/ClusterAgentController.java`
- Modify: `backend/src/main/java/com/nemesis/cache/MetricsCacheService.java`

- [ ] **MetricsCacheService — 클러스터 전체 에이전트 데이터 조회 메서드 추가**

```java
// MetricsCacheService.java 에 추가
public Map<UUID, MetricsPushRequest> getByCluster(UUID clusterId) {
    return cache.entrySet().stream()
        .filter(e -> nodeToCluster.getOrDefault(e.getKey(), null) != null
                  && nodeToCluster.get(e.getKey()).equals(clusterId))
        .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
}
```

- [ ] **ClusterAgentController 신규 작성**

```java
@RestController
@RequestMapping("/api/clusters/{id}")
@RequiredArgsConstructor
public class ClusterAgentController {

    private final NodeService        nodeService;
    private final MetricsCacheService metricsCache;
    private final ClusterService     clusterService;

    @GetMapping("/agent")
    public ResponseEntity<Map<String, Object>> agentData(@PathVariable UUID id) {
        Cluster cluster = clusterService.findById(id);
        List<Node> nodes = nodeService.getNodes(id);
        Map<UUID, MetricsPushRequest> metrics = metricsCache.getByCluster(id);

        List<Map<String, Object>> nodeList = nodes.stream().map(n -> {
            MetricsPushRequest m = metrics.get(n.getId());
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("nodeId",    n.getId());
            r.put("hostname",  n.getHostname());
            r.put("role",      n.getRole());
            r.put("state",     m != null ? "RUNNING" : "STOPPED");
            r.put("osType",    n.getOsType());
            r.put("ipAddress", n.getIpAddress());
            r.put("metrics",   m != null ? Map.of(
                "cpuPercent",    m.getCpuPercent(),
                "memoryPercent", m.getMemoryPercent(),
                "diskPercent",   m.getDiskPercent()
            ) : null);
            r.put("apps",        m != null ? m.getApps()        : List.of());
            r.put("network",     m != null ? m.getNetwork()     : List.of());
            r.put("fc",          m != null ? m.getFc()          : List.of());
            r.put("gpfsVolumes", m != null ? m.getGpfsVolumes() : List.of());
            r.put("logs",        m != null ? m.getLogs()        : List.of());
            return r;
        }).toList();

        return ResponseEntity.ok(Map.of(
            "clusterId",   cluster.getId(),
            "clusterName", cluster.getName(),
            "vip",         cluster.getVip(),
            "timestamp",   OffsetDateTime.now().toString(),
            "nodes",       nodeList,
            "failoverEvent", null
        ));
    }

    @GetMapping("/gpfs")
    public ResponseEntity<Map<String, Object>> gpfs(@PathVariable UUID id) {
        List<Node> nodes = nodeService.getNodes(id);
        Map<UUID, MetricsPushRequest> metrics = metricsCache.getByCluster(id);
        List<Map<String, Object>> gpfsNodes = nodes.stream().map(n -> {
            MetricsPushRequest m = metrics.get(n.getId());
            String state = m != null
                ? (m.getGpfsVolumes() != null && !m.getGpfsVolumes().isEmpty() ? "active" : "down")
                : "unknown";
            return Map.of("nodeId", n.getId(), "hostname", n.getHostname(),
                          "gpfsState", state, "ipAddress", n.getIpAddress());
        }).toList();
        return ResponseEntity.ok(Map.of(
            "command", "mmgetstate -a",
            "timestamp", OffsetDateTime.now().toString(),
            "nodes", gpfsNodes
        ));
    }

    @GetMapping("/network")
    public ResponseEntity<Map<String, Object>> network(@PathVariable UUID id) {
        List<Node> nodes = nodeService.getNodes(id);
        Map<UUID, MetricsPushRequest> metrics = metricsCache.getByCluster(id);
        // 노드간 ping 결과는 에이전트가 Push한 network 데이터에서 조립
        return ResponseEntity.ok(Map.of(
            "timestamp", OffsetDateTime.now().toString(),
            "nodes", nodes.stream().map(n -> Map.of(
                "nodeId", n.getId(), "hostname", n.getHostname()
            )).toList()
        ));
    }
}
```

---

### Task 1-5: 수동 Failover 엔드포인트 구현

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/failover/FailoverController.java`
- Create: `backend/src/main/java/com/nemesis/domain/failover/FailoverService.java`

- [ ] **FailoverService 작성**

```java
@Service
@RequiredArgsConstructor
public class FailoverService {

    private final NodeRepository nodeRepository;

    @Transactional
    public Map<String, Object> manualFailover(UUID clusterId, Map<String, Object> body) {
        UUID fromNodeId = UUID.fromString((String) body.get("fromNodeId"));
        UUID toNodeId   = UUID.fromString((String) body.get("toNodeId"));

        Node from = nodeRepository.findById(fromNodeId)
            .filter(n -> n.getCluster().getId().equals(clusterId))
            .orElseThrow(() -> new IllegalArgumentException("fromNode not found"));
        Node to = nodeRepository.findById(toNodeId)
            .filter(n -> n.getCluster().getId().equals(clusterId))
            .orElseThrow(() -> new IllegalArgumentException("toNode not found"));

        from.setRole(Node.Role.STANDBY);
        to.setRole(Node.Role.ACTIVE);
        nodeRepository.save(from);
        nodeRepository.save(to);

        return Map.of(
            "success",    true,
            "message",    to.getHostname() + "이(가) PRIMARY로 승격되었습니다.",
            "newPrimary", toNodeId,
            "timestamp",  OffsetDateTime.now().toString()
        );
    }
}
```

- [ ] **FailoverController 작성**

```java
@RestController
@RequestMapping("/api/clusters/{id}/failover")
@RequiredArgsConstructor
public class FailoverController {

    private final FailoverService failoverService;

    @PostMapping
    public ResponseEntity<Map<String, Object>> failover(
            @PathVariable UUID id,
            @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(failoverService.manualFailover(id, body));
    }
}
```

---

### Task 1-6: AI 분석 엔드포인트 연결

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/ai/AiFaultController.java`
- Modify: `backend/src/main/java/com/nemesis/domain/ai/AiFaultService.java`
- Modify: `backend/src/main/java/com/nemesis/domain/ai/OllamaService.java`

- [ ] **OllamaService 구현**

```java
@Service
public class OllamaService {

    @Value("${ollama.base-url:http://localhost:11434}")
    private String baseUrl;

    @Value("${ollama.model:gemma3:12b}")
    private String model;

    private final RestTemplate rest = new RestTemplate();

    public String analyze(String prompt) {
        var req = Map.of(
            "model",  model,
            "prompt", prompt,
            "stream", false
        );
        var res = rest.postForObject(baseUrl + "/api/generate", req, Map.class);
        return res != null ? (String) res.get("response") : "AI 분석 불가";
    }
}
```

- [ ] **AiFaultService — 클러스터 상태 기반 프롬프트 생성**

```java
@Service
@RequiredArgsConstructor
public class AiFaultService {

    private final OllamaService    ollama;
    private final NodeService      nodeService;
    private final ClusterService   clusterService;

    public Map<String, Object> analyze(UUID clusterId) {
        Cluster cluster = clusterService.findById(clusterId);
        List<Node> nodes = nodeService.getNodes(clusterId);

        long faults = nodes.stream()
            .filter(n -> n.getRole() == Node.Role.FAULT).count();

        String prompt = String.format(
            "클러스터 '%s' (VIP: %s) 상태: 전체 노드 %d개 중 장애 %d개. " +
            "노드 목록: %s. " +
            "장애 원인을 한국어로 분석하고 복구 절차를 제시하라.",
            cluster.getName(), cluster.getVip(),
            nodes.size(), faults,
            nodes.stream().map(n -> n.getHostname() + "(" + n.getRole() + ")")
                 .collect(Collectors.joining(", "))
        );

        String analysis = ollama.analyze(prompt);
        String severity = faults > 0 ? "critical" : "normal";

        return Map.of("status", "success", "analysis", analysis, "severity", severity);
    }
}
```

- [ ] **AiFaultController에 `/api/clusters/{id}/ai-analysis` 엔드포인트 추가**

```java
@GetMapping("/api/clusters/{id}/ai-analysis")
public ResponseEntity<Map<String, Object>> aiAnalysis(@PathVariable UUID id) {
    return ResponseEntity.ok(aiFaultService.analyze(id));
}
```

---

## Phase 2 — 프론트엔드 실백엔드 연동

### Task 2-1: Vite 프록시 설정

현재 프론트엔드는 `/api/`를 상대 경로로 호출한다. 개발 시 백엔드(18080)로 프록시하고, 프로덕션은 Nginx가 처리한다.

**Files:**
- Modify: `frontend/vite.config.js`

- [ ] **vite.config.js 수정**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:18080',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **검증**: `npx vite --host` 실행 후 `curl http://localhost:5173/api/clusters` → 백엔드 응답 확인

---

### Task 2-2: UUID 기반 API 클라이언트 전환

**핵심 문제:** 프론트엔드는 `/api/clusters/1` (numeric)으로 호출하지만 백엔드는 `/api/clusters/<uuid>` 형식이다. 백엔드에서 반환된 `id` 필드(UUID)를 그대로 사용하면 된다.

**Files:**
- Modify: `frontend/src/api/client.js`

- [ ] **client.js 확인** — axios baseURL이 `/api`로 설정되어 있는지 확인. 설정이 없으면 추가:

```js
// frontend/src/api/client.js
import axios from 'axios'

const client = axios.create({ baseURL: '/api' })

export const getClusters          = ()          => client.get('/clusters')
export const createCluster        = (data)      => client.post('/clusters', data)
export const updateCluster        = (id, data)  => client.put(`/clusters/${id}`, data)
export const deleteCluster        = (id)        => client.delete(`/clusters/${id}`)
export const getClusterStatus     = (id)        => client.get(`/clusters/${id}/status`)
export const getClusterAgent      = (id)        => client.get(`/clusters/${id}/agent`)
export const getClusterGpfs       = (id)        => client.get(`/clusters/${id}/gpfs`)
export const getClusterNetwork    = (id)        => client.get(`/clusters/${id}/network`)
export const getAiAnalysis        = (id)        => client.get(`/clusters/${id}/ai-analysis`)
export const triggerFailover      = (id, data)  => client.post(`/clusters/${id}/failover`, data)
export const triggerAppFailover   = (id, data)  => client.post(`/clusters/${id}/apps/failover`, data)
export const getClusterNodes      = (id)        => client.get(`/clusters/${id}/nodes`)
export const createNode           = (id, data)  => client.post(`/clusters/${id}/nodes`, data)
export const updateNode           = (id, nid, data) => client.put(`/clusters/${id}/nodes/${nid}`, data)
export const deleteNode           = (id, nid)   => client.delete(`/clusters/${id}/nodes/${nid}`)
```

---

### Task 2-3: 라우터 UUID 파라미터 적용

React Router `useParams()`로 받은 `:id`가 UUID가 되므로 코드 변경 없이 동작하지만, Dashboard에서 클러스터 목록 → 상세로 이동할 때 올바른 UUID를 전달하는지 확인한다.

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`

- [ ] **클러스터 카드 클릭 시 UUID로 이동하는지 확인**

Dashboard.jsx에서 클러스터 상세로 이동하는 부분이 `navigate('/cluster/' + cluster.id)` 형태인지 확인. `cluster.id`가 백엔드 UUID라면 자동으로 동작.

```js
// 확인할 패턴
navigate(`/cluster/${cluster.id}`)
// cluster.id = "550e8400-e29b-41d4-a716-446655440000" (UUID)
```

- [ ] **클러스터 추가 모달 — POST 응답의 UUID를 상태에 반영하는지 확인**

```js
// Dashboard.jsx 클러스터 추가 핸들러
const res = await createCluster({ name, vip })
setClusters(prev => [...prev, res.data])  // res.data.id가 UUID
```

---

## Phase 3 — 에이전트 수집 스크립트 완성

### Task 3-1: collect.sh 구현

`nemesis-agent.py`가 호출하는 `collect.sh`의 실제 메트릭 수집 로직.

**Files:**
- Create: `agent/collect.sh`

- [ ] **collect.sh 작성**

```bash
#!/bin/bash
# collect.sh — Linux 메트릭 수집. stdout으로 JSON 출력

set -euo pipefail

# CPU (1초 샘플)
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)

# Memory
MEM_TOTAL=$(grep MemTotal /proc/meminfo | awk '{print $2}')
MEM_AVAIL=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
MEM_PCT=$(awk "BEGIN{printf \"%.1f\", ($MEM_TOTAL - $MEM_AVAIL) / $MEM_TOTAL * 100}")

# Disk (루트 파티션)
DISK_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')

# GPFS 볼륨
GPFS_VOLUMES="[]"
if command -v mmdf &>/dev/null; then
  GPFS_VOLUMES=$(mmdf all 2>/dev/null | awk 'NR>3 && /gpfs/{
    printf "[{\"mountpoint\":\"%s\",\"usedPct\":%s}]", $1, $5
  }' | tr -d '%')
fi

# FC HBA
FC_PORTS="[]"
if ls /sys/class/fc_host/*/port_state &>/dev/null 2>&1; then
  FC_PORTS=$(for f in /sys/class/fc_host/host*; do
    STATE=$(cat "$f/port_state" 2>/dev/null || echo "unknown")
    NAME=$(basename "$f")
    echo "{\"name\":\"$NAME\",\"state\":\"$STATE\"}"
  done | jq -s '.')
fi

# 실행 중인 서비스 (systemd)
SERVICES=$(systemctl list-units --type=service --state=running --no-legend \
  | awk '{print $1}' \
  | head -20 \
  | jq -Rs 'split("\n") | map(select(length>0)) | map({id: ., name: ., state: "running"})')

jq -n \
  --arg cpu "$CPU" \
  --arg mem "$MEM_PCT" \
  --arg disk "$DISK_PCT" \
  --argjson gpfs "$GPFS_VOLUMES" \
  --argjson fc "$FC_PORTS" \
  --argjson apps "$SERVICES" \
  '{
    cpuPercent:    ($cpu  | tonumber),
    memoryPercent: ($mem  | tonumber),
    diskPercent:   ($disk | tonumber),
    gpfsVolumes:   $gpfs,
    fc:            $fc,
    apps:          $apps,
    network:       [],
    logs:          []
  }'
```

- [ ] **실행 권한 부여 및 로컬 테스트**

```bash
chmod +x agent/collect.sh
bash agent/collect.sh | jq .
```
Expected: CPU/메모리/디스크 수치가 담긴 JSON 출력

---

### Task 3-2: 에이전트 설치 스크립트

**Files:**
- Create: `agent/install.sh`

- [ ] **install.sh 작성**

```bash
#!/bin/bash
# install.sh — Nemesis 에이전트 설치 (루트 권한 필요)
# Usage: sudo bash install.sh --server http://<nemesis-server>:18080 --key <api-key>

set -euo pipefail

NEMESIS_SERVER=""
API_KEY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --server) NEMESIS_SERVER="$2"; shift 2 ;;
    --key)    API_KEY="$2";        shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

[[ -z "$NEMESIS_SERVER" || -z "$API_KEY" ]] && {
  echo "Usage: sudo bash install.sh --server <url> --key <api-key>"
  exit 1
}

# 의존성 설치
apt-get install -y python3 jq curl 2>/dev/null || \
  yum install -y python3 jq curl 2>/dev/null || true

# 파일 복사
mkdir -p /opt/nemesis-agent /etc/nemesis
cp nemesis-agent.py collect.sh /opt/nemesis-agent/
chmod +x /opt/nemesis-agent/collect.sh

# metadata.json 생성
cat > /etc/nemesis/metadata.json <<EOF
{
  "server_url": "$NEMESIS_SERVER",
  "api_key":    "$API_KEY"
}
EOF

# systemd 서비스 등록
cat > /etc/systemd/system/nemesis-agent.service <<EOF
[Unit]
Description=Nemesis Monitoring Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/nemesis-agent/nemesis-agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nemesis-agent
systemctl status nemesis-agent --no-pager
echo "✅ Nemesis Agent 설치 완료"
```

---

## Phase 4 — Docker Compose 빌드 및 배포

### Task 4-1: 프론트엔드 프로덕션 빌드

**Files:**
- Modify: `nginx/nginx.conf` — `/api` 프록시 설정

- [ ] **nginx.conf 확인 — API 프록시 설정 추가**

```nginx
location /api/ {
    proxy_pass http://nemesis-server:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
}
```

- [ ] **프론트엔드 빌드**

```bash
cd frontend
npm install
npm run build
# dist/ 폴더 생성 확인
ls dist/
```

- [ ] **전체 스택 기동**

```bash
cd /opt/nemesis
docker compose up -d --build
docker compose ps
```

Expected:
```
NAME                STATUS
nemesis-server      Up
nemesis-frontend    Up
postgres            Up (healthy)
```

- [ ] **헬스체크**

```bash
curl http://localhost:18080/api/clusters   # [] 빈 배열 응답
curl http://localhost:18090/               # HTML 페이지 응답
```

---

## Phase 5 — 운영 세팅

### Task 5-1: 초기 데이터 세팅 (클러스터 + API 키 생성)

백엔드 기동 후 모니터링할 클러스터와 에이전트 API 키를 생성한다.

- [ ] **클러스터 생성**

```bash
curl -s -X POST http://localhost:18080/api/clusters \
  -H "Content-Type: application/json" \
  -d '{"name":"prod-cluster-01","vip":"10.0.0.1"}' | jq .
# → id (UUID) 기록
CLUSTER_ID="<위에서_나온_uuid>"
```

- [ ] **에이전트 API 키 생성** (관리자 엔드포인트 — Task 1-5 이후 구현)

```bash
curl -s -X POST http://localhost:18080/api/admin/agent-keys \
  -H "Content-Type: application/json" \
  -d "{\"clusterId\":\"$CLUSTER_ID\",\"description\":\"prod-node-01\"}" | jq .
# → apiKey 기록
```

- [ ] **각 모니터링 노드에 에이전트 설치**

```bash
# 모니터링 대상 서버에서 실행
scp agent/nemesis-agent.py agent/collect.sh agent/install.sh root@prod-node-01:/tmp/
ssh root@prod-node-01 "cd /tmp && bash install.sh \
  --server http://nemesis-server:18080 \
  --key <api-key>"
```

---

## 남은 TODO (Phase 6 이후)

| 항목 | 우선순위 | 비고 |
|---|---|---|
| 관리자 API 키 발급 엔드포인트 | 높음 | `/api/admin/agent-keys` |
| 알람 규칙 실행 (Telegram/Email) | 높음 | .env의 TELEGRAM_BOT_TOKEN 활성화 |
| AIX `collect_aix.sh` 구현 | 중간 | ksh 기반 메트릭 수집 |
| Audit Log 조회 페이지 연결 | 중간 | 백엔드 `/api/clusters/:id/audit` 구현 |
| 실제 FC HBA 상태 수집 | 중간 | `/sys/class/fc_host` 파싱 개선 |
| Runbook 실행 결과 저장 | 낮음 | PostgreSQL 연동 |
| HTTPS / Let's Encrypt | 낮음 | 운영 전 필수 |
| 멀티 테넌트 / 사용자 인증 | 낮음 | 현재 인증 없음 |

---

## 빠른 참조

```bash
# 서버 전체 재시작
docker compose down && docker compose up -d --build

# 백엔드 로그
docker compose logs -f nemesis-server

# DB 접속
docker compose exec postgres psql -U nemesis -d nemesis

# 에이전트 상태 (모니터링 노드에서)
systemctl status nemesis-agent
journalctl -u nemesis-agent -f
```
