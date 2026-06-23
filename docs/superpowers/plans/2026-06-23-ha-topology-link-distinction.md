# HA Topology real IP / heartbeat IP 링크 분리 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HA Topology 패널에서 노드 간 연결을 real IP(serviceIp) 링크와 heartbeat IP(heartbeatIp) 링크로 분리해 각각 실측·표시한다.

**Architecture:** 에이전트가 피어의 serviceIp와 heartbeatIp를 각각 ping해 두 링크 상태를 보고하고, `HeartbeatCache`가 두 링크를 저장하며, `/api/ha/heartbeat`가 두 링크를 노출한다. 프론트는 이 매트릭스를 3초 폴링해 노드 쌍 사이에 평행 2선(위=real, 아래=hb)을 렌더한다. 페일오버/감지 로직은 변경하지 않는다(표시 전용).

**Tech Stack:** Java(Spring Boot, JUnit5 + MockMvc), Python(stdlib only), React(Vite, JSX/SVG)

## Global Constraints

- 기존 `status`/`latencyMs` 필드 의미는 **heartbeat 링크**로 유지(하위호환). real IP 링크는 신규 필드로 추가.
- 구버전 에이전트(svc 필드 없음) 호환: svc 누락 시 `svcStatus=hbStatus`, `svcLatencyMs=hbLatencyMs`로 폴백.
- 링크 상태 토큰은 `ALIVE` / `SLOW` / `DEAD` (에이전트 `measure_peer` 반환값과 동일).
- 페일오버·감지(detection)·경보 로직은 변경 금지.
- 에이전트는 stdlib만 사용(외부 의존성 추가 금지).
- 백엔드 테스트: `@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")` + MockMvc 패턴 사용.

---

## File Structure

- `agent/nemesis-agent.py` — `report_heartbeat()`가 serviceIp/heartbeatIp 둘 다 측정해 보고.
- `agent/test_report_heartbeat.py` (신규) — stdlib만 쓰는 standalone 검증 스크립트.
- `backend/.../ha/HeartbeatCache.java` — `Entry` 레코드에 svc 링크 필드 추가.
- `backend/.../agent/AgentHeartbeatController.java` — 신규 svc 필드 파싱 + 폴백.
- `backend/.../ha/HaStatusController.java` — `/api/ha/heartbeat` 응답에 serviceStatus/serviceLatencyMs 추가.
- `backend/.../ha/HaHeartbeatLinkTest.java` (신규) — end-to-end(보고→조회) 검증.
- `frontend/src/components/ClusterTopologyPanel.jsx` — 매트릭스 폴링 + 평행 2선 렌더.

---

## Task 1: HeartbeatCache.Entry에 real IP 링크 필드 추가

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/ha/HeartbeatCache.java:17`

**Interfaces:**
- Produces: `HeartbeatCache.Entry(String hbStatus, Integer hbLatencyMs, String svcStatus, Integer svcLatencyMs, long receivedAt)` — Task 2(쓰기)·Task 3(읽기)가 사용.

- [ ] **Step 1: Entry 레코드 확장**

`HeartbeatCache.java`의 17번째 줄을 교체:

```java
    public record Entry(String hbStatus, Integer hbLatencyMs,
                        String svcStatus, Integer svcLatencyMs,
                        long receivedAt) {}
```

나머지 `report`/`get` 메서드는 `Entry`를 불투명하게 다루므로 변경 불필요.

- [ ] **Step 2: 컴파일 확인 (호출부 깨짐 확인 목적)**

Run: `cd backend && ./gradlew compileJava -q`
Expected: `AgentHeartbeatController.java`와 `HaStatusController.java`에서 옛 생성자(`new Entry(status, latency, now)`, `e.status()`, `e.latencyMs()`) 사용으로 **컴파일 에러**. 이는 정상이며 Task 2·3에서 해소한다.

- [ ] **Step 3: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/ha/HeartbeatCache.java
git commit -m "refactor(ha): HeartbeatCache.Entry에 real IP 링크 필드 추가"
```

---

## Task 2: AgentHeartbeatController에서 두 링크 파싱 + 구버전 폴백

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/agent/AgentHeartbeatController.java:41-49`

**Interfaces:**
- Consumes: `HeartbeatCache.Entry(hbStatus, hbLatencyMs, svcStatus, svcLatencyMs, receivedAt)` (Task 1).
- Consumes(요청 JSON): peer 항목 `{toNodeId, status, latencyMs, svcStatus?, svcLatencyMs?}`.

- [ ] **Step 1: 파싱 로직 교체**

`AgentHeartbeatController.java`의 41-49번째 줄(`try { ... }` 블록 내부 본문)을 교체:

```java
                try {
                    UUID toNodeId = UUID.fromString(toId.toString());

                    Object hbStatusObj = p.get("status");
                    String hbStatus = hbStatusObj != null ? hbStatusObj.toString() : "DEAD";
                    Integer hbLatency = p.get("latencyMs") instanceof Number n ? n.intValue() : null;

                    // 구버전 에이전트는 svc 필드를 보내지 않는다 → heartbeat 값으로 폴백.
                    Object svcStatusObj = p.get("svcStatus");
                    String svcStatus = svcStatusObj != null ? svcStatusObj.toString() : hbStatus;
                    Integer svcLatency = p.get("svcLatencyMs") instanceof Number n2 ? n2.intValue() : hbLatency;

                    peers.put(toNodeId, new HeartbeatCache.Entry(
                            hbStatus, hbLatency, svcStatus, svcLatency, now));
                } catch (IllegalArgumentException ignore) {
                    // 잘못된 UUID는 건너뛴다
                }
```

- [ ] **Step 2: 컴파일 확인**

Run: `cd backend && ./gradlew compileJava -q`
Expected: 여전히 `HaStatusController.java`만 에러(`e.status()` / `e.latencyMs()`). `AgentHeartbeatController.java` 에러는 사라짐.

- [ ] **Step 3: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/agent/AgentHeartbeatController.java
git commit -m "feat(ha): 에이전트 하트비트 보고에서 real IP 링크 파싱 + 구버전 폴백"
```

---

## Task 3: /api/ha/heartbeat 응답에 real IP 링크 노출

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/ha/HaStatusController.java:42-61`

**Interfaces:**
- Consumes: `HeartbeatCache.Entry(hbStatus, hbLatencyMs, svcStatus, svcLatencyMs, receivedAt)` (Task 1).
- Produces(응답 JSON): 각 heartbeat 항목 `{toNodeId, status, latencyMs, serviceStatus, serviceLatencyMs}` — Task 6(프론트)이 사용. `status`/`latencyMs`는 heartbeat 링크.

- [ ] **Step 1: 매트릭스 빌드 루프 교체**

`HaStatusController.java`의 42-61번째 줄(`List<Map<String, Object>> hbs = ...` 부터 inner for 루프 끝까지)을 교체:

```java
            List<Map<String, Object>> hbs = new ArrayList<>();
            for (Node to : nodes) {
                if (to.getId().equals(from.getId())) continue;
                HeartbeatCache.Entry e = heartbeatCache.get(from.getId(), to.getId(), fresh);
                String  hbStatus, svcStatus;
                Integer hbLatency, svcLatency;
                if (e != null) {
                    hbStatus   = e.hbStatus();
                    hbLatency  = e.hbLatencyMs();
                    svcStatus  = e.svcStatus();
                    svcLatency = e.svcLatencyMs();
                } else {
                    // 폴백: 두 노드가 모두 신선하면 양쪽 링크 모두 살아있다고 본다.
                    boolean toAlive = metricsCache.isFresh(to.getId(), fresh);
                    String alive = (fromAlive && toAlive) ? "ALIVE" : "DEAD";
                    hbStatus = svcStatus = alive;
                    hbLatency = svcLatency = null;
                }
                Map<String, Object> hb = new LinkedHashMap<>();
                hb.put("toNodeId",         to.getId());
                hb.put("status",           hbStatus);   // heartbeat 링크(기존 의미 유지)
                hb.put("latencyMs",        hbLatency);
                hb.put("serviceStatus",    svcStatus);  // real IP 링크(신규)
                hb.put("serviceLatencyMs", svcLatency);
                hbs.add(hb);
            }
```

- [ ] **Step 2: 전체 컴파일 + 기존 테스트 통과 확인**

Run: `cd backend && ./gradlew compileJava compileTestJava -q`
Expected: BUILD SUCCESSFUL (컴파일 에러 없음).

- [ ] **Step 3: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/ha/HaStatusController.java
git commit -m "feat(ha): /api/ha/heartbeat 응답에 real IP 링크 상태 노출"
```

---

## Task 4: 백엔드 end-to-end 테스트 (보고 → 조회)

**Files:**
- Create: `backend/src/test/java/com/nemesis/ha/HaHeartbeatLinkTest.java`

**Interfaces:**
- Consumes: `POST /api/agent/heartbeat`(Task 2), `GET /api/ha/heartbeat/{clusterId}`(Task 3).

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/src/test/java/com/nemesis/ha/HaHeartbeatLinkTest.java` 생성:

```java
package com.nemesis.ha;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.agent.AgentKey;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HaHeartbeatLinkTest {

    @Autowired MockMvc            mockMvc;
    @Autowired ObjectMapper       objectMapper;
    @Autowired ClusterRepository  clusterRepository;
    @Autowired AgentKeyRepository agentKeyRepository;
    @Autowired NodeRepository     nodeRepository;

    private static final String FROM_KEY = "nmss-hb-link-from";
    private UUID clusterId;
    private UUID toNodeId;

    @BeforeEach
    void setUp() {
        agentKeyRepository.deleteAll();
        nodeRepository.deleteAll();
        clusterRepository.deleteAll();

        Cluster cluster = clusterRepository.save(Cluster.builder().name("HB링크테스트").build());
        clusterId = cluster.getId();

        Node from = nodeRepository.save(Node.builder()
                .cluster(cluster).hostname("node-from").osType(Node.OsType.LINUX).build());
        Node to = nodeRepository.save(Node.builder()
                .cluster(cluster).hostname("node-to").osType(Node.OsType.LINUX).build());
        toNodeId = to.getId();

        agentKeyRepository.save(AgentKey.builder()
                .cluster(cluster).apiKey(FROM_KEY).node(from).build());
    }

    @Test
    void real_IP와_heartbeat_IP_링크가_독립적으로_노출된다() throws Exception {
        // heartbeat 링크는 DEAD, real IP 링크는 ALIVE 로 보고
        Map<String, Object> peer = Map.of(
                "toNodeId",     toNodeId.toString(),
                "status",       "DEAD",  "latencyMs",    900,
                "svcStatus",    "ALIVE", "svcLatencyMs", 12);

        mockMvc.perform(post("/api/agent/heartbeat")
                        .header("Authorization", "Bearer " + FROM_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("peers", List.of(peer)))))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/ha/heartbeat/" + clusterId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[?(@.hostname=='node-from')].heartbeats[0].status").value("DEAD"))
                .andExpect(jsonPath("$.nodes[?(@.hostname=='node-from')].heartbeats[0].serviceStatus").value("ALIVE"))
                .andExpect(jsonPath("$.nodes[?(@.hostname=='node-from')].heartbeats[0].serviceLatencyMs").value(12));
    }

    @Test
    void 구버전_에이전트는_svc필드_없이_heartbeat값으로_폴백된다() throws Exception {
        // svc 필드 없이 보고 (구버전 에이전트)
        Map<String, Object> peer = Map.of(
                "toNodeId", toNodeId.toString(),
                "status",   "ALIVE", "latencyMs", 20);

        mockMvc.perform(post("/api/agent/heartbeat")
                        .header("Authorization", "Bearer " + FROM_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("peers", List.of(peer)))))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/ha/heartbeat/" + clusterId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[?(@.hostname=='node-from')].heartbeats[0].serviceStatus").value("ALIVE"))
                .andExpect(jsonPath("$.nodes[?(@.hostname=='node-from')].heartbeats[0].serviceLatencyMs").value(20));
    }
}
```

- [ ] **Step 2: 테스트 실행해서 통과 확인**

Run: `cd backend && ./gradlew test --tests "com.nemesis.ha.HaHeartbeatLinkTest" -q`
Expected: 두 테스트 모두 PASS. (Task 1~3가 이미 구현돼 있으므로 통과해야 한다. 실패하면 해당 Task로 돌아가 수정.)

- [ ] **Step 3: 커밋**

```bash
git add backend/src/test/java/com/nemesis/ha/HaHeartbeatLinkTest.java
git commit -m "test(ha): real IP/heartbeat IP 링크 분리 노출 end-to-end 테스트"
```

---

## Task 5: 에이전트가 serviceIp/heartbeatIp 둘 다 측정해 보고

**Files:**
- Modify: `agent/nemesis-agent.py:262-268`
- Create: `agent/test_report_heartbeat.py`

**Interfaces:**
- Consumes: `measure_peer(ip) -> (status, latencyMs)` (기존, 변경 없음), `STATE.snapshot()` 의 `meta['peers']` 항목 `{nodeId, heartbeatIp, serviceIp}`.
- Produces(보고 JSON): peer 항목 `{toNodeId, status, latencyMs, svcStatus, svcLatencyMs}`.

- [ ] **Step 1: 실패하는 standalone 테스트 작성**

`agent/test_report_heartbeat.py` 생성:

```python
"""report_heartbeat 가 heartbeatIp/serviceIp 두 링크를 모두 측정·보고하는지 검증.
stdlib만 사용. 실행: python3 agent/test_report_heartbeat.py"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("nemesis_agent",
                                              os.path.join(HERE, "nemesis-agent.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


def test_two_links_reported():
    # heartbeatIp 와 serviceIp 가 다른 상태를 내도록 measure_peer 를 가짜로 대체
    def fake_measure(ip):
        return {"10.0.0.1": ("ALIVE", 5),    # heartbeatIp
                "192.168.0.1": ("DEAD", None) # serviceIp
                }.get(ip, ("DEAD", None))
    agent.measure_peer = fake_measure

    captured = {}
    def fake_request(url, data=None, headers=None):
        import json
        captured["payload"] = json.loads(data.decode())
        return {}
    agent._request = fake_request

    agent.STATE.set_meta({"peers": [
        {"nodeId": "n-to", "heartbeatIp": "10.0.0.1", "serviceIp": "192.168.0.1"}
    ]})

    agent.report_heartbeat("http://mgmt", "key")

    peers = captured["payload"]["peers"]
    assert len(peers) == 1, peers
    p = peers[0]
    assert p["toNodeId"] == "n-to"
    assert p["status"] == "ALIVE" and p["latencyMs"] == 5, p          # heartbeat 링크
    assert p["svcStatus"] == "DEAD" and p["svcLatencyMs"] is None, p  # real IP 링크
    print("OK test_two_links_reported")


if __name__ == "__main__":
    test_two_links_reported()
    print("ALL PASS")
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `python3 agent/test_report_heartbeat.py`
Expected: `KeyError: 'svcStatus'` (현재 report_heartbeat는 svc 필드를 보내지 않음).

- [ ] **Step 3: report_heartbeat 구현 수정**

`agent/nemesis-agent.py`의 262-268번째 줄(`results = []` 부터 inner for 루프 끝까지)을 교체:

```python
    results = []
    for p in peers:
        node_id = p.get('nodeId')
        if not node_id:
            continue
        hb_status,  hb_lat  = measure_peer(p.get('heartbeatIp'))
        svc_status, svc_lat = measure_peer(p.get('serviceIp'))
        results.append({
            'toNodeId':  node_id,
            'status':    hb_status,  'latencyMs':    hb_lat,   # heartbeat 링크(기존)
            'svcStatus': svc_status, 'svcLatencyMs': svc_lat,  # real IP 링크(신규)
        })
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `python3 agent/test_report_heartbeat.py`
Expected: `OK test_two_links_reported` 후 `ALL PASS`.

- [ ] **Step 5: 커밋**

```bash
git add agent/nemesis-agent.py agent/test_report_heartbeat.py
git commit -m "feat(agent): 피어 heartbeatIp/serviceIp 두 링크 측정·보고"
```

---

## Task 6: 프론트 — 매트릭스 폴링 + 평행 2선 렌더

**Files:**
- Modify: `frontend/src/components/ClusterTopologyPanel.jsx`
- Reference: `frontend/src/api/client.js:101` (`getHaHeartbeat` 이미 존재)

**Interfaces:**
- Consumes: `getHaHeartbeat(clusterId)` → `{ nodes: [{ nodeId, hostname, role, state, heartbeats: [{ toNodeId, status, latencyMs, serviceStatus, serviceLatencyMs }] }] }` (Task 3).

> 참고: frontend에는 JS 테스트 러너가 없다(package.json scripts = dev/build/preview만). 따라서 이 Task의 검증은 `linkVisual` 순수 헬퍼의 인라인 자기검증 + `npm run build` + 개발 서버 시각 확인으로 한다.

- [ ] **Step 1: import에 getHaHeartbeat 추가**

`ClusterTopologyPanel.jsx`의 2번째 줄(import)을 교체:

```jsx
import { getClusterStatus, getClusterGpfs, getClusterNetwork, getClusterVipStatus, getHaHeartbeat } from '../api/client'
```

- [ ] **Step 2: 링크 상태 → 시각 속성 순수 헬퍼 추가**

`ClusterTopologyPanel.jsx`에서 `ROLE_LABEL`/`OS_ICON` 상수 정의 바로 아래(29번째 줄 다음)에 추가:

```jsx
/* 링크 상태(ALIVE/SLOW/DEAD) → 선 시각 속성. real/hb 공통. */
function linkVisual(status) {
  switch (status) {
    case 'ALIVE': return { color: '#34d399', animated: true,  dash: '7 4', label: '' }
    case 'SLOW':  return { color: '#fbbf24', animated: true,  dash: '7 4', label: 'SLOW' }
    default:      return { color: '#ef4444', animated: false, dash: '4 4', label: 'DOWN' } // DEAD/미상
  }
}
```

- [ ] **Step 3: 헬퍼 자기검증(임시 콘솔)으로 매핑 확인**

`ClusterTopologyPanel.jsx` 파일 맨 아래 `export default` 위에 임시로 추가하고 dev에서 콘솔 확인:

```jsx
if (import.meta.env.DEV) {
  console.assert(linkVisual('ALIVE').animated === true,  'ALIVE animated')
  console.assert(linkVisual('DEAD').animated === false,  'DEAD static')
  console.assert(linkVisual('SLOW').color === '#fbbf24', 'SLOW amber')
}
```

Run: `cd frontend && npm run dev` 후 브라우저 콘솔에 assert 실패 메시지가 없는지 확인.
Expected: 콘솔에 `Assertion failed` 없음. 확인 후 이 임시 블록은 Step 8에서 제거한다.

- [ ] **Step 4: 매트릭스 상태/폴링 추가**

`ClusterTopologyPanel.jsx`의 컴포넌트 상태 선언부(`const [diag, setDiag] = ...` 다음 줄)에 추가:

```jsx
  const [hbMatrix, setHbMatrix] = useState(null)
```

이어서 `load` 함수의 `Promise.allSettled([...])` 호출을 교체:

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

- [ ] **Step 5: 두 노드 간 링크 상태 조회 헬퍼 추가**

`getLatency` 함수 정의 바로 아래에 추가:

```jsx
  function getLink(fromId, toId) {
    const fromNode = hbMatrix?.nodes?.find(n => n.nodeId === fromId)
    const hb = fromNode?.heartbeats?.find(h => h.toNodeId === toId)
    if (!hb) return null
    return {
      hb:  { status: hb.status,        latency: hb.latencyMs },
      svc: { status: hb.serviceStatus, latency: hb.serviceLatencyMs },
    }
  }
```

- [ ] **Step 6: ConnLine을 linkKind 기반으로 일반화**

`ConnLine` 컴포넌트(32-65번째 줄) 전체를 교체. ctrl(제어선)는 기존 동작 유지하고, link(real/hb) 모드를 추가:

```jsx
/* ---------- 연결선 ---------- */
function ConnLine({ x1, y1, x2, y2, type = 'ctrl', linkKind = null, status = null,
                   animated = false, latency = null, label = null }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const isLink = linkKind != null            // 'real' | 'hb'
  const vis    = isLink ? linkVisual(status) : null

  const color   = isLink ? vis.color : '#38bdf8'
  const width   = isLink ? 3 : 1.5
  const opacity = isLink ? 0.85 : 0.5
  const anim    = isLink ? vis.animated : animated
  const dash    = isLink ? vis.dash : (animated ? '7 4' : 'none')
  const latColor = latency === null ? '#64748b' : latency > 500 ? '#fbbf24' : '#34d399'

  return (
    <g>
      {isLink && (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="8" opacity="0.08" />
      )}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={width} strokeDasharray={dash} opacity={opacity}>
        {anim && (
          <animate attributeName="stroke-dashoffset" from="0" to="-22" dur="0.9s" repeatCount="indefinite" />
        )}
      </line>
      {label && (
        <text x={x1 + 6} y={y1 - 4} fill={color} fontSize="8"
          fontFamily="monospace" fontWeight="bold">{label}</text>
      )}
      {latency !== null && (
        <g>
          <rect x={mx - 18} y={my - 10} width={36} height={14} rx={3}
            fill="rgba(10,15,20,0.92)" stroke={latColor} strokeWidth="0.8" />
          <text x={mx} y={my + 1} textAnchor="middle" fill={latColor}
            fontSize="8" fontFamily="monospace" fontWeight="bold">{latency}ms</text>
        </g>
      )}
    </g>
  )
}
```

- [ ] **Step 7: 하트비트선 렌더를 평행 2선으로 교체**

`ClusterTopologyPanel.jsx`의 "── 2. 하트비트선 ──" 블록(437-448번째 줄, `nodePositions.slice(1).map(...)`)을 교체:

```jsx
            {/* ── 2. 노드 간 링크 (real IP / heartbeat IP 평행 2선) ── */}
            {nodePositions.slice(1).map(({ node, x }, i) => {
              const fromNode = nodePositions[i].node
              const link = getLink(fromNode.nodeId, node.nodeId)
              const cy = NODE_Y + BOX_H / 2
              const x1 = nodePositions[i].x + BOX_W
              const x2 = x
              // 매트릭스 미수신 초기: 노드 state 폴백(회색 정적). RUNNING이면 ALIVE 취급.
              const bothUp = node.state === 'RUNNING' && fromNode.state === 'RUNNING'
              const svcStatus = link ? link.svc.status : (bothUp ? 'ALIVE' : 'DEAD')
              const hbStatus  = link ? link.hb.status  : (bothUp ? 'ALIVE' : 'DEAD')
              return (
                <g key={`link-${node.nodeId}`}>
                  <ConnLine x1={x1} y1={cy - 9} x2={x2} y2={cy - 9}
                    linkKind="real" status={svcStatus} label="real IP"
                    latency={link ? link.svc.latency : null} />
                  <ConnLine x1={x1} y1={cy + 9} x2={x2} y2={cy + 9}
                    linkKind="hb" status={hbStatus} label="hb IP"
                    latency={link ? link.hb.latency : null} />
                </g>
              )
            })}
```

- [ ] **Step 8: Step 3의 임시 assert 블록 제거 + 빌드 확인**

Step 3에서 추가한 `if (import.meta.env.DEV) { console.assert(...) }` 블록을 삭제.

Run: `cd frontend && npm run build`
Expected: 빌드 성공(에러 없음).

- [ ] **Step 9: 시각 확인 (수동)**

Run: `cd frontend && npm run dev` → 클러스터 > 클러스터 설정 > 노드관리 페이지의 HA Topology 확인.
Expected: 노드 사이에 위(real IP)·아래(hb IP) 두 선이 보이고, 각 선이 자기 상태대로 동작(ALIVE=초록 움직임 / DEAD=빨강 정지). 한쪽만 끊긴 상황이 구분돼 보임.

- [ ] **Step 10: 커밋**

```bash
git add frontend/src/components/ClusterTopologyPanel.jsx
git commit -m "feat(topology): 노드 간 링크를 real IP/heartbeat IP 평행 2선으로 분리 표시"
```

---

## Self-Review 결과

**Spec 커버리지:**
- §4.1 에이전트 두 링크 측정 → Task 5. ✅
- §4.2 백엔드(Entry/Controller/HaStatus/폴백) → Task 1·2·3. ✅
- §4.3 프론트(폴링/평행 2선/ConnLine 일반화/폴백) → Task 6. ✅
- §6 테스트(백엔드 신규필드+폴백, 에이전트 페이로드, 프론트 독립 상태) → Task 4·5·6. ✅
- §2 결정3(표시 전용, 페일오버 로직 불변) → 어떤 Task도 detection/failover 미수정. ✅

**Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음. ✅

**타입 일관성:**
- `Entry(hbStatus, hbLatencyMs, svcStatus, svcLatencyMs, receivedAt)` — Task 1 정의, Task 2 생성, Task 3 접근자 일치. ✅
- 보고 JSON `{status, latencyMs, svcStatus, svcLatencyMs}` — Task 5(에이전트 출력) ↔ Task 2(백엔드 파싱) 일치. ✅
- 응답 JSON `{status, latencyMs, serviceStatus, serviceLatencyMs}` — Task 3(백엔드 출력) ↔ Task 6 `getLink`(프론트 소비) 일치. ✅
- `linkVisual(status)` / `getLink(fromId,toId)` / `ConnLine({linkKind,status,label,...})` — Task 6 내부 정의·사용 일치. ✅

**알려진 제약:** frontend에 JS 테스트 러너가 없어 Task 6은 순수 헬퍼 자기검증 + build + 수동 시각 확인으로 검증한다(플랜에 명시).
