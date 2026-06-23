# HA Topology real IP / heartbeat IP 링크 분리 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HA Topology 패널에서 관리서버↔노드 선은 real IP(serviceIp 제어포트 도달성), 노드↔노드 선은 heartbeat IP 링크로 각각 실측·표시한다.

**Architecture:** 관리서버가 각 노드 serviceIp 제어포트(17001)에 TCP로 도달 가능한지 `@Scheduled` 프로버로 실측해 `ServiceLinkCache`에 저장하고, `/api/ha/heartbeat`가 노드별 `serviceLink`(real IP, mgmt→node)와 기존 `heartbeats`(hb IP, node↔node)를 함께 노출한다. 프론트는 이를 3초 폴링해 mgmt→node 선은 real IP 상태, node↔node 선은 hb 상태로 그린다. 에이전트와 페일오버/감지 로직은 변경하지 않는다(표시 전용).

**Tech Stack:** Java(Spring Boot, `@Scheduled`, JUnit5 + MockMvc), React(Vite, JSX/SVG)

## Global Constraints

- 링크-선 매핑: **관리서버↔노드 = real IP**, **노드↔노드 = heartbeat IP**.
- 링크 상태 토큰은 `ALIVE` / `SLOW` / `DEAD`.
- real IP(mgmt→node)는 관리서버가 `serviceIp:controlPort`로 TCP connect해 실측. 제어포트는
  `${nemesis.control-port:17001}`(기존 `AgentCommandClient`와 동일 키) 사용.
- SLOW 경계는 TCP connect 지연 500ms 초과로 한다.
- 노드↔노드 hb 링크는 기존 하트비트 매트릭스(`HeartbeatCache` / `/api/ha/heartbeat` `heartbeats[]`)를
  그대로 사용 — 에이전트·HeartbeatCache·AgentHeartbeatController 변경 금지.
- 페일오버·감지(detection)·경보 로직 변경 금지.
- 백엔드 테스트: `@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")` + MockMvc 패턴 사용.

---

## File Structure

- `backend/.../ha/ServiceLinkCache.java` (신규) — nodeId→real IP 링크 상태 인메모리 캐시.
- `backend/.../ha/ServiceLinkProber.java` (신규) — `@Scheduled` TCP 프로버.
- `backend/.../ha/HaStatusController.java` — `/api/ha/heartbeat` 노드 뷰에 `serviceLink` 추가.
- `backend/.../ha/ServiceLinkTest.java` (신규) — 프로버(소켓) + 엔드포인트 노출 검증.
- `frontend/src/components/ClusterTopologyPanel.jsx` — 매트릭스 폴링 + mgmt→node(real)/node↔node(hb) 선 구동.

---

## Task 1: ServiceLinkCache + ServiceLinkProber (관리서버 제어포트 실측)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/ha/ServiceLinkCache.java`
- Create: `backend/src/main/java/com/nemesis/domain/ha/ServiceLinkProber.java`

**Interfaces:**
- Produces: `ServiceLinkCache.Entry(String status, Integer latencyMs, long receivedAt)`, `ServiceLinkCache.get(UUID nodeId, long maxAgeMillis) -> Entry|null`, `ServiceLinkCache.put(UUID nodeId, Entry e)` — Task 2(읽기)가 사용.
- Produces: `ServiceLinkProber.probe(String serviceIp, int controlPort) -> Entry` (static, 테스트용 순수 측정 메서드).
- Consumes: `NodeRepository`(전체 노드 조회), `Node.getServiceIp()`.

- [ ] **Step 1: ServiceLinkCache 작성**

`ServiceLinkCache.java` 생성:

```java
package com.nemesis.domain.ha;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 관리서버 → 노드 serviceIp(real IP) 제어포트 도달성 측정 결과의 인메모리 캐시.
 * ServiceLinkProber가 주기적으로 갱신하고, HaStatusController가 읽는다.
 */
@Component
public class ServiceLinkCache {

    public record Entry(String status, Integer latencyMs, long receivedAt) {}

    private final Map<UUID, Entry> store = new ConcurrentHashMap<>();

    public void put(UUID nodeId, Entry e) {
        store.put(nodeId, e);
    }

    /** 노드의 real IP 링크 상태. 없거나 오래되면 null. */
    public Entry get(UUID nodeId, long maxAgeMillis) {
        Entry e = store.get(nodeId);
        if (e == null) return null;
        if (System.currentTimeMillis() - e.receivedAt() > maxAgeMillis) return null;
        return e;
    }
}
```

- [ ] **Step 2: ServiceLinkProber 작성**

`ServiceLinkProber.java` 생성:

```java
package com.nemesis.domain.ha;

import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * 각 노드의 serviceIp(real IP) 제어포트에 TCP connect를 시도해 도달성·지연을 측정하고
 * ServiceLinkCache에 저장한다(표시 전용 — 페일오버/감지에는 영향 없음).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ServiceLinkProber {

    private static final int CONNECT_TIMEOUT_MS = 2000;
    private static final int SLOW_THRESHOLD_MS  = 500;

    private final NodeRepository    nodeRepository;
    private final ServiceLinkCache  cache;

    @Value("${nemesis.control-port:17001}")
    private int controlPort;

    @Scheduled(fixedDelayString = "${nemesis.service-link.probe-interval-ms:3000}")
    public void probeAll() {
        for (Node n : nodeRepository.findAll()) {
            try {
                cache.put(n.getId(), probe(n.getServiceIp(), controlPort));
            } catch (Exception e) {
                log.debug("serviceLink 프로브 실패 node={}: {}", n.getId(), e.getMessage());
            }
        }
    }

    /** serviceIp:port 로 TCP connect 시도. 순수 측정(부작용 없음) — 테스트에서 직접 호출. */
    public static ServiceLinkCache.Entry probe(String serviceIp, int controlPort) {
        long now = System.currentTimeMillis();
        if (serviceIp == null || serviceIp.isBlank()) {
            return new ServiceLinkCache.Entry("DEAD", null, now);
        }
        long start = System.nanoTime();
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(serviceIp, controlPort), CONNECT_TIMEOUT_MS);
            int latency = (int) ((System.nanoTime() - start) / 1_000_000);
            String status = latency > SLOW_THRESHOLD_MS ? "SLOW" : "ALIVE";
            return new ServiceLinkCache.Entry(status, latency, now);
        } catch (Exception e) {
            return new ServiceLinkCache.Entry("DEAD", null, now);
        }
    }
}
```

- [ ] **Step 3: 컴파일 확인**

Run: `cd backend && ./gradlew compileJava -q`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/ha/ServiceLinkCache.java \
        backend/src/main/java/com/nemesis/domain/ha/ServiceLinkProber.java
git commit -m "feat(ha): 노드 serviceIp 제어포트 도달성 프로버/캐시 추가"
```

---

## Task 2: /api/ha/heartbeat 노드 뷰에 serviceLink(real IP) 노출

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/ha/HaStatusController.java:29-31` (필드 주입), `:64-70` (노드 뷰 빌드)

**Interfaces:**
- Consumes: `ServiceLinkCache.get(UUID, long)` (Task 1), `DetectionProperties.metricsFreshMillis()`(기존).
- Produces(응답 JSON): 각 노드 뷰에 `serviceLink: {status, latencyMs}` (real IP, mgmt→node). 기존 `heartbeats[]`(hb IP)는 불변. Task 4(프론트)가 사용.

- [ ] **Step 1: ServiceLinkCache 주입**

`HaStatusController.java`의 의존성 필드 블록(29-30번째 줄, `private final HeartbeatCache heartbeatCache;` 다음)에 추가:

```java
    private final ServiceLinkCache     serviceLinkCache;
```

- [ ] **Step 2: 노드 뷰에 serviceLink 추가**

`HaStatusController.java`의 노드 뷰 빌드부(64-70번째 줄, `Map<String, Object> nv = new LinkedHashMap<>(); ... nodeViews.add(nv);`)를 교체:

```java
            // real IP 링크(관리서버→노드 serviceIp 제어포트 도달성).
            ServiceLinkCache.Entry sl = serviceLinkCache.get(from.getId(), fresh);
            Map<String, Object> serviceLink = new LinkedHashMap<>();
            if (sl != null) {
                serviceLink.put("status",    sl.status());
                serviceLink.put("latencyMs", sl.latencyMs());
            } else {
                // 폴백: 프로브 결과가 아직 없으면 노드 신선도로 근사.
                serviceLink.put("status",    fromAlive ? "ALIVE" : "DEAD");
                serviceLink.put("latencyMs", null);
            }

            Map<String, Object> nv = new LinkedHashMap<>();
            nv.put("nodeId",      from.getId());
            nv.put("hostname",    from.getHostname());
            nv.put("role",        from.getRole().uiToken());
            nv.put("state",       fromAlive ? "RUNNING" : "STOPPED");
            nv.put("serviceLink", serviceLink);
            nv.put("heartbeats",  hbs);
            nodeViews.add(nv);
```

- [ ] **Step 3: 컴파일 확인**

Run: `cd backend && ./gradlew compileJava -q`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/ha/HaStatusController.java
git commit -m "feat(ha): /api/ha/heartbeat 노드 뷰에 real IP serviceLink 노출"
```

---

## Task 3: 백엔드 테스트 (프로버 소켓 + 엔드포인트 노출)

**Files:**
- Create: `backend/src/test/java/com/nemesis/ha/ServiceLinkTest.java`

**Interfaces:**
- Consumes: `ServiceLinkProber.probe(serviceIp, port)`(Task 1), `GET /api/ha/heartbeat/{clusterId}`(Task 2).

- [ ] **Step 1: 테스트 작성**

`backend/src/test/java/com/nemesis/ha/ServiceLinkTest.java` 생성:

```java
package com.nemesis.ha;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.ha.ServiceLinkCache;
import com.nemesis.domain.ha.ServiceLinkProber;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.net.ServerSocket;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ServiceLinkTest {

    @Autowired MockMvc           mockMvc;
    @Autowired ClusterRepository clusterRepository;
    @Autowired NodeRepository    nodeRepository;
    @Autowired ServiceLinkCache  serviceLinkCache;

    @Test
    void 열린_포트는_ALIVE_닫힌_포트는_DEAD로_측정된다() throws Exception {
        try (ServerSocket open = new ServerSocket(0)) {
            int openPort = open.getLocalPort();
            ServiceLinkCache.Entry alive = ServiceLinkProber.probe("127.0.0.1", openPort);
            assertThat(alive.status()).isEqualTo("ALIVE");
            assertThat(alive.latencyMs()).isNotNull();
        }
        // 방금 닫힌(또는 사용되지 않는) 포트로는 연결 실패 → DEAD
        ServiceLinkCache.Entry dead = ServiceLinkProber.probe("127.0.0.1", 1);
        assertThat(dead.status()).isEqualTo("DEAD");

        ServiceLinkCache.Entry blank = ServiceLinkProber.probe("", 17001);
        assertThat(blank.status()).isEqualTo("DEAD");
    }

    @Test
    void heartbeat_엔드포인트가_노드별_serviceLink를_노출한다() throws Exception {
        Cluster cluster = clusterRepository.save(Cluster.builder().name("serviceLink테스트").build());
        Node node = nodeRepository.save(Node.builder()
                .cluster(cluster).hostname("svc-node").osType(Node.OsType.LINUX).build());

        // 캐시에 ALIVE 를 직접 주입(프로버 스케줄과 무관하게 결정적으로 검증)
        serviceLinkCache.put(node.getId(),
                new ServiceLinkCache.Entry("ALIVE", 7, System.currentTimeMillis()));

        mockMvc.perform(get("/api/ha/heartbeat/" + cluster.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[?(@.hostname=='svc-node')].serviceLink.status").value("ALIVE"))
                .andExpect(jsonPath("$.nodes[?(@.hostname=='svc-node')].serviceLink.latencyMs").value(7));
    }
}
```

- [ ] **Step 2: 테스트 실행해서 통과 확인**

Run: `cd backend && ./gradlew test --tests "com.nemesis.ha.ServiceLinkTest" -q`
Expected: 두 테스트 모두 PASS. (실패 시 Task 1·2로 돌아가 수정.)

- [ ] **Step 3: 커밋**

```bash
git add backend/src/test/java/com/nemesis/ha/ServiceLinkTest.java
git commit -m "test(ha): serviceLink 프로버 + 엔드포인트 노출 검증"
```

---

## Task 4: 프론트 — mgmt→node(real IP) / node↔node(hb IP) 선 구동

**Files:**
- Modify: `frontend/src/components/ClusterTopologyPanel.jsx`
- Reference: `frontend/src/api/client.js:101` (`getHaHeartbeat` 이미 존재)

**Interfaces:**
- Consumes: `getHaHeartbeat(clusterId)` → `{ nodes: [{ nodeId, hostname, role, state, serviceLink: { status, latencyMs }, heartbeats: [{ toNodeId, status, latencyMs }] }] }` (Task 2).

> 참고: frontend에는 JS 테스트 러너가 없다(package.json scripts = dev/build/preview만). 따라서 이 Task의 검증은 `linkVisual` 순수 헬퍼의 인라인 자기검증 + `npm run build` + 개발 서버 시각 확인으로 한다.

- [ ] **Step 1: import에 getHaHeartbeat 추가**

`ClusterTopologyPanel.jsx`의 2번째 줄(import)을 교체:

```jsx
import { getClusterStatus, getClusterGpfs, getClusterNetwork, getClusterVipStatus, getHaHeartbeat } from '../api/client'
```

- [ ] **Step 2: 링크 상태 → 시각 속성 순수 헬퍼 추가**

`ClusterTopologyPanel.jsx`에서 `OS_ICON` 상수 정의 바로 아래(29번째 줄 다음)에 추가:

```jsx
/* 링크 상태(ALIVE/SLOW/DEAD) → 선 시각 속성. real/hb 공통. */
function linkVisual(status) {
  switch (status) {
    case 'ALIVE': return { color: '#34d399', animated: true,  dash: '7 4' }
    case 'SLOW':  return { color: '#fbbf24', animated: true,  dash: '7 4' }
    default:      return { color: '#ef4444', animated: false, dash: '4 4' } // DEAD/미상
  }
}
```

- [ ] **Step 3: 헬퍼 자기검증(임시)으로 매핑 확인**

`ClusterTopologyPanel.jsx` 파일 맨 아래 `export default` 위에 임시로 추가:

```jsx
if (import.meta.env.DEV) {
  console.assert(linkVisual('ALIVE').animated === true,  'ALIVE animated')
  console.assert(linkVisual('DEAD').animated === false,  'DEAD static')
  console.assert(linkVisual('SLOW').color === '#fbbf24', 'SLOW amber')
}
```

Run: `cd frontend && npm run dev` 후 브라우저 콘솔에 `Assertion failed` 메시지가 없는지 확인.
Expected: assert 실패 없음. 확인 후 이 임시 블록은 Step 9에서 제거한다.

- [ ] **Step 4: 매트릭스 상태/폴링 추가**

컴포넌트 상태 선언부(`const [diag, setDiag] = ...` 다음 줄)에 추가:

```jsx
  const [hbMatrix, setHbMatrix] = useState(null)
```

이어서 `load` 함수의 `Promise.allSettled([...])` 호출 및 결과 처리를 교체:

```jsx
        const [statusRes, vipRes, hbRes] = await Promise.allSettled([
          getClusterStatus(clusterId),
          getClusterVipStatus(clusterId),
          getHaHeartbeat(clusterId),
        ])
        if (cancelled) return
        if (statusRes.status === 'fulfilled') setStatus(statusRes.value.data)
        if (vipRes.status   === 'fulfilled') setVipStatus(vipRes.value.data)
        if (hbRes.status    === 'fulfilled') setHbMatrix(hbRes.value.data)
```

- [ ] **Step 5: 매트릭스 조회 헬퍼 2개 추가**

`getLatency` 함수 정의 바로 아래에 추가:

```jsx
  // 관리서버→노드 real IP 링크 상태.
  function getServiceLink(nodeId) {
    const n = hbMatrix?.nodes?.find(x => x.nodeId === nodeId)
    return n?.serviceLink ?? null   // { status, latencyMs } | null
  }
  // 노드↔노드 hb 링크 상태.
  function getHbLink(fromId, toId) {
    const from = hbMatrix?.nodes?.find(x => x.nodeId === fromId)
    return from?.heartbeats?.find(h => h.toNodeId === toId) ?? null // { status, latencyMs } | null
  }
```

- [ ] **Step 6: ConnLine을 linkKind/status 기반으로 일반화**

`ConnLine` 컴포넌트(32-65번째 줄) 전체를 교체:

```jsx
/* ---------- 연결선 ---------- */
function ConnLine({ x1, y1, x2, y2, linkKind = 'hb', status = null,
                   fallbackAnimated = false, latency = null, label = null }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const vis = status ? linkVisual(status) : null

  // real(mgmt→node)=가는 선, hb(node↔node)=굵은 선
  const isReal  = linkKind === 'real'
  const color   = vis ? vis.color : '#38bdf8'
  const width   = isReal ? 1.5 : 3
  const opacity = isReal ? 0.6 : 0.85
  const animated = vis ? vis.animated : fallbackAnimated
  const dash     = vis ? vis.dash : (fallbackAnimated ? '7 4' : 'none')
  const latColor = latency === null ? '#64748b' : latency > 500 ? '#fbbf24' : '#34d399'

  return (
    <g>
      {!isReal && (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="8" opacity="0.08" />
      )}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={width} strokeDasharray={dash} opacity={opacity}>
        {animated && (
          <animate attributeName="stroke-dashoffset" from="0" to="-22" dur="0.9s" repeatCount="indefinite" />
        )}
      </line>
      {label && (
        <text x={mx} y={my - 6} textAnchor="middle" fill={color} fontSize="8"
          fontFamily="monospace" fontWeight="bold">{label}</text>
      )}
      {latency !== null && (
        <g>
          <rect x={mx - 18} y={my + 1} width={36} height={14} rx={3}
            fill="rgba(10,15,20,0.92)" stroke={latColor} strokeWidth="0.8" />
          <text x={mx} y={my + 12} textAnchor="middle" fill={latColor}
            fontSize="8" fontFamily="monospace" fontWeight="bold">{latency}ms</text>
        </g>
      )}
    </g>
  )
}
```

- [ ] **Step 7: 제어선(mgmt→node)을 real IP 링크로 교체**

`ClusterTopologyPanel.jsx`의 "── 1. 제어선 (mgmt → nodes) ──" 블록(426-434번째 줄, `nodePositions.map(({ node, x }) => ( <ConnLine ... /> ))`)을 교체:

```jsx
            {/* ── 1. real IP 링크 (관리서버 → 노드 serviceIp 제어포트) ── */}
            {nodePositions.map(({ node, x }) => {
              const sl = getServiceLink(node.nodeId)
              return (
                <ConnLine key={`real-${node.nodeId}`}
                  x1={MGMT_X + MGMT_W / 2} y1={MGMT_Y + MGMT_H}
                  x2={x + BOX_W / 2}        y2={NODE_Y}
                  linkKind="real"
                  status={sl ? sl.status : null}
                  fallbackAnimated={node.state === 'RUNNING'}
                  label="real IP"
                  latency={sl ? sl.latencyMs : null}
                />
              )
            })}
```

- [ ] **Step 8: 하트비트선(node↔node)을 hb 매트릭스로 교체**

"── 2. 하트비트선 (노드 ↔ 노드) ──" 블록(437-448번째 줄, `nodePositions.slice(1).map(...)`)을 교체:

```jsx
            {/* ── 2. heartbeat IP 링크 (노드 ↔ 노드) ── */}
            {nodePositions.slice(1).map(({ node, x }, i) => {
              const fromNode = nodePositions[i].node
              const link = getHbLink(fromNode.nodeId, node.nodeId)
              const bothUp = node.state === 'RUNNING' && fromNode.state === 'RUNNING'
              return (
                <ConnLine key={`hb-${node.nodeId}`}
                  x1={nodePositions[i].x + BOX_W} y1={NODE_Y + BOX_H / 2}
                  x2={x}                          y2={NODE_Y + BOX_H / 2}
                  linkKind="hb"
                  status={link ? link.status : null}
                  fallbackAnimated={bothUp}
                  label="hb IP"
                  latency={link ? link.latencyMs : null}
                />
              )
            })}
```

- [ ] **Step 9: Step 3의 임시 assert 블록 제거 + 빌드 확인**

Step 3에서 추가한 `if (import.meta.env.DEV) { console.assert(...) }` 블록을 삭제.

Run: `cd frontend && npm run build`
Expected: 빌드 성공(에러 없음).

- [ ] **Step 10: 시각 확인 (수동)**

Run: `cd frontend && npm run dev` → 클러스터 > 클러스터 설정 > 노드관리 페이지의 HA Topology 확인.
Expected:
- 관리서버→각 노드 선이 `real IP` 라벨로, 해당 노드 serviceLink 상태대로 동작(ALIVE=초록 움직임 / DEAD=빨강 정지).
- 노드↔노드 선이 `hb IP` 라벨로, 하트비트 상태대로 동작.
- 한쪽 경로만 끊긴 상황(예: real ALIVE + hb DEAD, 또는 그 반대)이 선 색/움직임으로 구분돼 보임.

- [ ] **Step 11: 커밋**

```bash
git add frontend/src/components/ClusterTopologyPanel.jsx
git commit -m "feat(topology): mgmt→node를 real IP, node↔node를 hb IP 링크로 분리 표시"
```

---

## Self-Review 결과

**Spec 커버리지:**
- §2 결정1(두 링크 실측: hb=기존 매트릭스, real=제어포트 프로브) → Task 1·2. ✅
- §4.1 에이전트 변경 없음 → 어떤 Task도 agent/HeartbeatCache 미수정. ✅
- §4.2 백엔드(ServiceLinkCache/Prober/HaStatus serviceLink/폴백) → Task 1·2. ✅
- §4.3 프론트(폴링/real=mgmt선/hb=node선/linkVisual/폴백) → Task 4. ✅
- §6 테스트(프로버 소켓, 엔드포인트 serviceLink, 프론트 헬퍼+빌드+시각) → Task 3·4. ✅
- §2 결정3(표시 전용, 페일오버 로직 불변) → detection/failover 미수정. ✅

**Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음. ✅

**타입 일관성:**
- `ServiceLinkCache.Entry(status, latencyMs, receivedAt)` — Task 1 정의, `put`/`get` 시그니처 일치, Task 2에서 `sl.status()`/`sl.latencyMs()` 접근 일치. ✅
- `ServiceLinkProber.probe(String, int) -> Entry` — Task 1 정의, Task 3 테스트 호출 일치. ✅
- 응답 JSON 노드 뷰 `{serviceLink:{status,latencyMs}, heartbeats:[{toNodeId,status,latencyMs}]}` — Task 2 출력 ↔ Task 4 `getServiceLink`/`getHbLink` 소비 일치. ✅
- `linkVisual(status)` / `ConnLine({linkKind,status,fallbackAnimated,label,latency})` — Task 4 내부 정의·사용 일치. ✅

**알려진 제약:** frontend에 JS 테스트 러너가 없어 Task 4는 순수 헬퍼 자기검증 + build + 수동 시각 확인으로 검증한다(플랜에 명시). real IP는 제어포트 TCP connect 도달성만 본다(인증/명령 왕복 미측정 — spec §7).
```
