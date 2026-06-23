# HA Topology — real IP / heartbeat IP 링크 분리 표시 설계

- 작성일: 2026-06-23 (개정: 링크 매핑 변경 — 관리서버↔노드=real IP, 노드↔노드=hb IP)
- 위치: 클러스터 > 클러스터 설정 > 노드관리 페이지의 **HA Topology** 패널 (`frontend/src/components/ClusterTopologyPanel.jsx`)

## 1. 배경 / 문제

HA Topology는 노드 간 연결을 "움직이는 점선"으로 표현한다. 그러나 현재 이 점선은
실제 링크 상태가 아니라 단지 두 노드의 **에이전트 생존 여부**(`node.state === 'RUNNING'`)만
보고 움직인다. 즉 real IP(serviceIp) 경로로 연결됐는지, heartbeat IP(heartbeatIp) 경로로
연결됐는지 구분이 안 된다.

운영자는 **real IP 경로**와 **heartbeat IP 경로**의 연결 상태를 각각 상세히 확인할 수 있어야 한다.

### 링크-선 매핑 (핵심 결정)

토폴로지의 물리적 실체에 맞춰 두 종류의 선에 각각 의미를 부여한다.

- **관리서버 ↔ 노드 선 = real IP 링크.** 관리서버가 노드의 serviceIp(real IP) 제어포트로
  도달 가능한지를 나타낸다.
- **노드 ↔ 노드 선 = heartbeat IP 링크.** 노드들이 서로 heartbeatIp로 도달 가능한지를 나타낸다.

### 현재 구조 (실측 기준)

- 노드 DB(`Node.java`)에 `serviceIp`(real IP)와 `heartbeatIp`가 둘 다 존재.
- 에이전트(`nemesis-agent.py` `report_heartbeat()`)는 피어 연결을 **heartbeatIp로** 측정해
  `{toNodeId, status(ALIVE/SLOW/DEAD), latencyMs}`를 `/api/agent/heartbeat`로 보고.
- 백엔드 `HeartbeatCache` 저장 → `/api/ha/heartbeat/{clusterId}`가 노드↔노드 매트릭스로 노출.
- 관리서버는 노드 제어포트 `http://{serviceIp}:17001`(`AgentCommandClient`)로 명령을 보낸다.
  단, serviceIp 도달성 자체를 주기적으로 측정·노출하는 기능은 **없다.**
- **토폴로지 패널은 hb 매트릭스를 사용하지 않는다.** mgmt→node 선(ctrl)과 node↔node 선 모두
  `node.state`만 보고 그린다.

## 2. 확정 결정

1. **측정 충실도: 두 링크 모두 실측.**
   - heartbeat IP 링크(노드↔노드): 에이전트가 heartbeatIp를 실측한 기존 하트비트 매트릭스 사용.
   - real IP 링크(관리서버↔노드): 관리서버가 각 노드 serviceIp 제어포트(17001)에 TCP로 도달
     가능한지 주기적으로 실측.
2. **시각화: 선 종류로 구분.** 관리서버↔노드 선 = real IP, 노드↔노드 선 = hb IP. 각 선은 자기
   링크 상태(ALIVE/SLOW/DEAD)에 따라 색·애니메이션이 달라진다.
3. **real IP 역할: 표시 전용.** real IP 링크 상태는 토폴로지에만 표시한다. 페일오버/감지 로직은
   기존 heartbeat IP 이중화 기준 그대로 유지(불변).

## 3. 데이터 흐름

```
관리서버                                          프론트
─────────                                         ─────────
ServiceLinkProber(@Scheduled)
  └ TCP connect → node.serviceIp:17001
      → ServiceLinkCache (노드별 real IP 링크)

에이전트 ─heartbeatIp 측정─▶ /api/agent/heartbeat
                            → HeartbeatCache (노드↔노드 hb 링크)

GET /api/ha/heartbeat/{cid}
   nodes[].serviceLink   (real IP, mgmt→node)  ──▶ ClusterTopologyPanel
   nodes[].heartbeats[]  (hb IP, node↔node)        (3초 폴링)
```

## 4. 레이어별 변경

### 4.1 에이전트 (`agent/nemesis-agent.py`)

**변경 없음.** 노드↔노드 hb 링크는 기존 heartbeatIp 측정·보고를 그대로 사용한다.

### 4.2 백엔드

- **`ServiceLinkCache`** (신규, `HeartbeatCache`와 동형의 인메모리 캐시): nodeId → `Entry(status,
  latencyMs, receivedAt)`.
- **`ServiceLinkProber`** (신규, `@Scheduled`): 클러스터의 각 노드 serviceIp에 대해
  `controlPort`(`${nemesis.control-port:17001}`)로 TCP connect를 시도해 도달성·지연을 측정하고
  `ServiceLinkCache`에 저장한다. 상태 매핑: 연결 성공 + 지연 ≤ 임계 = `ALIVE`, 성공 + 임계 초과 =
  `SLOW`, 실패/타임아웃/serviceIp 미설정 = `DEAD`.
- **`HaStatusController`** `/api/ha/heartbeat`: 각 노드 뷰에 `serviceLink: {status, latencyMs}`를
  추가한다(real IP, mgmt→node). 캐시 미스 시 폴백: `node.state` 신선하면 `ALIVE`, 아니면 `DEAD`.
  노드↔노드 `heartbeats[]`(hb IP)는 기존 형식 그대로 유지.
- **페일오버/감지(detection) 로직은 변경하지 않는다.**

### 4.3 프론트 (`frontend/src/components/ClusterTopologyPanel.jsx`)

- 폴링 `load()`에 `getHaHeartbeat(clusterId)`(이미 `api/client.js`에 존재) 추가 → 매트릭스를
  `POLL_MS`(3초)마다 갱신(상시 라이브).
- **관리서버 → 노드 선(ctrl)**: `node.serviceLink.status`(real IP)로 구동. ALIVE = 색 점선 움직임 /
  SLOW = 호박색 / DEAD = 빨강 고정. 라벨 `real IP`, latency 배지.
- **노드 ↔ 노드 선**: hb 매트릭스의 `status`(heartbeat IP)로 구동(기존 `bothUp` 폴백 로직 대체).
  라벨 `hb IP`, latency 배지.
- 상태 토큰 → 시각 속성 매핑은 순수 헬퍼 `linkVisual(status)`로 일원화.
- 매트릭스 미수신 초기 상태: 노드 `state` 폴백(회색 정적선).

## 5. 컴포넌트 경계 (단위)

| 단위 | 역할 | 입력 | 출력 |
|------|------|------|------|
| `ServiceLinkProber` (be) | 노드 serviceIp 제어포트 TCP 실측 | nodes | ServiceLinkCache 갱신 |
| `ServiceLinkCache` (be) | real IP 링크 상태 캐시 | nodeId/entry | Entry(status, latencyMs) |
| `HeartbeatCache` (be) | hb 링크 상태 캐시(기존) | from/to/entry | Entry |
| `/api/ha/heartbeat` (be) | 매트릭스+serviceLink 노출 | clusterId | nodes[]{serviceLink, heartbeats[]} |
| `linkVisual` (fe) | 상태→선 시각 속성 | status | {color, animated, dash, label} |
| `ConnLine` (fe) | 단일 선 1개 렌더 | kind/status/좌표 | SVG `<g>` |

## 6. 테스트

- **백엔드**
  - `ServiceLinkProber`: 로컬 `ServerSocket`을 띄운 포트로 프로브 → `ALIVE`, 닫힌 포트 →
    `DEAD`(결정적 테스트).
  - `/api/ha/heartbeat`: 응답 각 노드 뷰에 `serviceLink.status`가 포함되고, 캐시 미스 시 node.state
    폴백값이 나오는지 검증.
- **에이전트**: 변경 없음(테스트 없음).
- **프론트**: JS 테스트 러너 부재 → 순수 헬퍼 `linkVisual` 자기검증 + `npm run build` + 개발
  서버에서 mgmt→node(real) / node↔node(hb) 선이 각자 상태대로 동작하는지 시각 확인.

## 7. 비범위 (YAGNI)

- real IP 링크 상태를 페일오버/감지/경보 트리거에 반영하지 않는다(표시 전용).
- 노드↔노드 serviceIp 측정은 하지 않는다(real IP는 관리서버 관점에서만 측정).
- 제어포트 TCP connect 도달성만 본다(애플리케이션 레벨 인증/명령 왕복은 측정하지 않음).
- latency 임계값은 ALIVE/SLOW 경계 1개(기본 500ms)만 사용한다.
