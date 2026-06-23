# HA Topology — real IP / heartbeat IP 링크 분리 표시 설계

- 작성일: 2026-06-23
- 위치: 클러스터 > 클러스터 설정 > 노드관리 페이지의 **HA Topology** 패널 (`frontend/src/components/ClusterTopologyPanel.jsx`)

## 1. 배경 / 문제

HA Topology는 노드 간 연결을 "움직이는 점선"으로 표현한다. 그러나 현재 이 점선은
실제 링크 상태가 아니라 단지 두 노드의 **에이전트 생존 여부**(`node.state === 'RUNNING'`)만
보고 움직인다. 즉 real IP(serviceIp)로 연결됐는지, heartbeat IP(heartbeatIp)로 연결됐는지
구분이 안 되고, 어느 쪽이든 에이전트만 살아 있으면 동일하게 움직인다.

운영자는 **real IP 경로**와 **heartbeat IP 경로**의 연결 상태를 각각 상세히 확인할 수
있어야 한다.

### 현재 구조 (실측 기준)

- 노드 DB(`Node.java`)에 `serviceIp`(real IP)와 `heartbeatIp`가 둘 다 존재.
- 에이전트(`nemesis-agent.py` `report_heartbeat()`)는 피어 연결을 **heartbeatIp로만** 측정해
  `{toNodeId, status(ALIVE/SLOW/DEAD), latencyMs}`를 `/api/agent/heartbeat`로 보고. serviceIp
  간 연결성은 측정하지 않는다.
- 백엔드 `HeartbeatCache` 저장 → `/api/ha/heartbeat/{clusterId}`가 매트릭스로 노출(에이전트
  보고 없으면 "두 노드 모두 fresh → ALIVE" 폴백).
- **토폴로지 패널은 이 매트릭스를 사용하지 않는다.** 노드 간 점선은 `node.state`만 보고 그린다.
- 피어 메타(`AgentMetaController`)에는 이미 `serviceIp`와 `heartbeatIp`가 둘 다 내려가므로,
  에이전트는 추가 데이터 없이 serviceIp도 ping할 수 있다.

## 2. 확정 결정

1. **측정 충실도: 두 링크 모두 실측.** 에이전트가 피어의 serviceIp와 heartbeatIp를 각각
   ping해 독립 상태를 보고한다.
2. **시각화: 평행 2선.** 노드 쌍 사이에 위(real IP)·아래(heartbeat IP) 두 선을 그리고, 각각
   독립적인 색/라벨/애니메이션을 갖는다. 한쪽만 끊겨도 즉시 구분된다.
3. **real IP 역할: 표시 전용.** 새로 측정하는 real IP 링크 상태는 토폴로지에만 표시한다.
   페일오버/감지 로직은 기존 heartbeat IP 이중화 기준 그대로 유지(불변).

## 3. 데이터 흐름

```
에이전트                      백엔드                          프론트
─────────                    ─────────                       ─────────
peer.serviceIp   ─ping─┐
peer.heartbeatIp ─ping─┴──▶ POST /api/agent/heartbeat
                            → HeartbeatCache (두 링크 저장)
                            → GET /api/ha/heartbeat/{cid} ──▶ ClusterTopologyPanel
                                                              평행 2선 렌더(3초 폴링)
```

## 4. 레이어별 변경

### 4.1 에이전트 (`agent/nemesis-agent.py`)

`report_heartbeat()`가 피어마다 heartbeatIp뿐 아니라 serviceIp도 측정한다.

```python
hb_status,  hb_lat  = measure_peer(p.get('heartbeatIp'))
svc_status, svc_lat = measure_peer(p.get('serviceIp'))
results.append({
    'toNodeId':     node_id,
    'status':       hb_status,  'latencyMs':    hb_lat,   # 기존 필드 = heartbeat 링크(하위호환)
    'svcStatus':    svc_status, 'svcLatencyMs': svc_lat,  # 신규 = real IP 링크
})
```

- 기존 `status`/`latencyMs`는 heartbeat 링크 의미 그대로 유지 → 백엔드 하위호환.
- `measure_peer`(ALIVE/SLOW/DEAD + latency)를 그대로 재사용.
- serviceIp == heartbeatIp(단일 NIC) 환경이면 두 결과가 동일하게 나오는 것이 정상.
- serviceIp가 비어 있으면 svc 측정을 건너뛰고 svc 필드를 생략(또는 null).

### 4.2 백엔드

- `HeartbeatCache.Entry`: `(status, latencyMs, receivedAt)`
  → `(hbStatus, hbLatencyMs, svcStatus, svcLatencyMs, receivedAt)`로 확장.
- `AgentHeartbeatController`: 신규 필드 파싱. 구버전 에이전트(svc 필드 없음)는 `svcStatus=hbStatus`,
  `svcLatencyMs=hbLatencyMs`로 폴백 저장.
- `HaStatusController` `/api/ha/heartbeat`: 각 hb 항목에 `serviceStatus`/`serviceLatencyMs`
  추가. 기존 `status`/`latencyMs`(=heartbeat)는 유지.
- 에이전트 보고 없을 때 폴백: 기존처럼 "둘 다 fresh면 ALIVE, 아니면 DEAD"를 real/hb 양쪽에
  동일 적용.
- **페일오버/감지(detection) 로직은 변경하지 않는다.**

### 4.3 프론트 (`frontend/src/components/ClusterTopologyPanel.jsx`)

- 폴링 `load()`에 `getHaHeartbeat(clusterId)`(이미 `api/client.js`에 존재) 추가 → 매트릭스를
  `POLL_MS`(3초)마다 갱신(상시 라이브).
- 노드 쌍마다 **평행 2선**으로 렌더:
  - **real IP 선** (중심 −9px, 위): `serviceStatus` 기준.
  - **heartbeat IP 선** (중심 +9px, 아래): `status`(hb) 기준.
  - 상태 매핑: `ALIVE` = 색 점선 움직임 / `SLOW` = 호박색(움직임 유지) / `DEAD` = 빨강 고정 점선(정지).
  - 각 선에 `real IP` · `hb` 라벨 + 개별 latency 배지.
- 기존 단일 하트비트선 로직(`bothUp = 두 노드 state RUNNING`)을 제거하고 매트릭스 기반으로 교체.
- `ConnLine`을 일반화: `linkKind`('real'|'hb'), `status`(ALIVE/SLOW/DEAD), `label`, y-offset를
  받도록 한다.
- 매트릭스가 아직 도착하지 않은 초기 상태: 노드 `state` 폴백으로 회색 정적선.

## 5. 컴포넌트 경계 (단위)

| 단위 | 역할 | 입력 | 출력 |
|------|------|------|------|
| `measure_peer` (agent) | 한 IP의 도달성·지연 측정 | ip | (status, latencyMs) |
| `report_heartbeat` (agent) | 피어별 두 링크 측정 보고 | peers 메타 | heartbeat 페이로드(svc 포함) |
| `HeartbeatCache` (be) | 링크 상태 캐시 | from/to/entry | Entry(두 링크) |
| `/api/ha/heartbeat` (be) | 매트릭스 노출 | clusterId | nodes[].heartbeats[]{hb+svc} |
| `ConnLine` (fe) | 단일 링크 선 1개 렌더 | kind/status/좌표/label | SVG `<g>` |

## 6. 테스트

- **백엔드**
  - `AgentHeartbeatController`: 신규 svc 필드 파싱 저장 / 구버전(필드 없음) 폴백(svc=hb).
  - `/api/ha/heartbeat`: 응답 항목에 `serviceStatus`·`serviceLatencyMs` 포함, 에이전트 보고
    없을 때 폴백값 검증.
- **에이전트**
  - `report_heartbeat` 페이로드가 피어별로 svc/hb 필드를 모두 포함하는지(가능 범위 내 검증).
- **프론트**
  - 매트릭스 응답으로 두 선이 독립 상태(예: real=ALIVE + hb=DEAD)로 렌더되는지.
  - 매트릭스 미수신 초기 상태에서 회색 폴백선 렌더.

## 7. 비범위 (YAGNI)

- real IP 링크 상태를 페일오버/감지/경보 트리거에 반영하지 않는다(표시 전용).
- 3개 이상 노드의 풀메시 시각화 최적화는 다루지 않는다(현행 인접 쌍 렌더 유지).
- latency 임계값 정책 변경 없음(기존 SLOW>500ms / >1.0ms 배지 색 규칙 재사용).
