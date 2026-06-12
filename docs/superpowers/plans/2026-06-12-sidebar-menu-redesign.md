# Nemesis 사이드바 메뉴 개편 v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HA 운영자 업무 흐름 중심으로 사이드바 메뉴를 6개 섹션으로 개편하고, 동기화 현황·에이전트 상태를 클러스터 상태 단일 페이지로 통합한다.

**Architecture:** Sidebar.jsx의 MENU 상수만 교체하면 대부분 완료된다. 신규 페이지는 ClusterStatus.jsx 하나뿐 — 기존 HaSync.jsx의 3개 탭 + 에이전트 탭으로 구성. HaSequence.jsx에 Runbook 탭을 추가해 운영 절차를 한 곳에 모은다.

**Tech Stack:** React 18, React Router v6, lucide-react, Vite

---

## File Map

| 작업 | 파일 경로 |
|------|-----------|
| 수정 | `frontend/src/components/Sidebar.jsx` |
| 수정 | `frontend/src/App.jsx` |
| 신규 | `frontend/src/pages/monitoring/ClusterStatus.jsx` |
| 수정 | `frontend/src/pages/ha/Sequence.jsx` |

---

## Task 1: Sidebar.jsx — MENU 배열 교체

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx`

- [ ] **Step 1: 아이콘 import 수정**

`Sidebar.jsx` 상단의 import를 아래로 교체한다. `Layers`, `Server`, `PlayCircle`을 제거하고 `Shield`, `Zap`을 추가한다.

```jsx
import {
  LayoutDashboard, GitBranch, Shield, Zap,
  Activity, Settings,
  ChevronDown, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
```

- [ ] **Step 2: MENU 상수 교체**

기존 `const MENU = [...]` 전체를 아래로 교체한다.

```jsx
const MENU = [
  { label: '대시보드', icon: LayoutDashboard, path: '/' },

  { label: '클러스터', icon: GitBranch, path: null, children: [
    { label: '트리 뷰',      path: '/clusters/tree'     },
    { label: '클러스터 목록', path: '/ha/groups'         },
    { label: '클러스터 설정', path: '/settings/clusters' },
    { label: 'HA 운영 절차', path: '/ha/sequence'       },
  ]},

  { label: '서비스', icon: Shield, path: null, children: [
    { label: '전체 서비스',  path: '/services'           },
    { label: 'DB',          path: '/db'                 },
    { label: 'Application', path: '/sw'                 },
    { label: '컨테이너',    path: '/docker/containers'  },
  ]},

  { label: '운영', icon: Zap, path: null, children: [
    { label: '점검 관리', path: '/inspection' },
  ]},

  { label: '모니터링', icon: Activity, path: null, children: [
    { label: '클러스터 상태', path: '/monitoring/cluster' },
    { label: '리포트',        path: '/reports'            },
  ]},

  { label: '시스템', icon: Settings, path: null, children: [
    { label: '시스템 설정', path: '/settings/system' },
  ]},
]
```

- [ ] **Step 3: 브라우저 확인**

`npm run dev` 실행 후 사이드바에 6개 섹션이 올바르게 표시되는지 확인한다.

- 대시보드 / 클러스터(4) / 서비스(4) / 운영(1) / 모니터링(2) / 시스템(1)
- 모든 기존 링크가 정상 동작하는지 각 메뉴 클릭 확인

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Sidebar.jsx
git commit -m "feat: rebuild sidebar menu — 6-section HA operator layout"
```

---

## Task 2: App.jsx — 신규 라우트 및 redirect 추가

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: ClusterStatus import 추가**

`App.jsx`의 import 목록 하단에 추가한다.

```jsx
import ClusterStatus    from './pages/monitoring/ClusterStatus'
```

- [ ] **Step 2: 라우트 추가**

`<Routes>` 안의 `{/* 알람 */}` 블록 바로 위에 아래를 삽입한다.

```jsx
{/* 모니터링 */}
<Route path="/monitoring/cluster"    element={<ClusterStatus />} />
<Route path="/ha/sync"               element={<Navigate to="/monitoring/cluster" replace />} />
<Route path="/runbook"               element={<Navigate to="/ha/sequence" replace />} />
```

- [ ] **Step 3: Navigate import 확인**

파일 상단에 이미 `import { Navigate } from 'react-router-dom'`이 있는지 확인한다 (이미 있음).

- [ ] **Step 4: 브라우저 확인**

- `/ha/sync` → `/monitoring/cluster`로 리다이렉트되는지 확인
- `/runbook` → `/ha/sequence`로 리다이렉트되는지 확인

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: add /monitoring/cluster route, redirect /ha/sync and /runbook"
```

---

## Task 3: ClusterStatus.jsx — 통합 클러스터 상태 페이지 생성

**Files:**
- Create: `frontend/src/pages/monitoring/ClusterStatus.jsx`

이 페이지는 기존 `HaSync.jsx`의 3개 탭(복제 현황·하트비트·메타데이터 동기화)에 **에이전트** 탭을 추가한 통합 뷰다. HaSync.jsx는 수정하지 않는다.

- [ ] **Step 1: 디렉토리 생성 확인**

```bash
mkdir -p frontend/src/pages/monitoring
```

- [ ] **Step 2: ClusterStatus.jsx 생성**

`frontend/src/pages/monitoring/ClusterStatus.jsx`를 아래 내용으로 생성한다.

```jsx
import React, { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle2, AlertCircle, RefreshCw, Heart, Database,
  Activity, Wifi, WifiOff, AlertTriangle, Loader2, ArrowRightLeft, Server,
} from 'lucide-react'
import {
  getClusters, getClusterStatus, getClusterNodes,
  getHaHeartbeat, getHaMetadataSync, triggerHaMetadataSync,
} from '../../api/client'
import { statusBadge, dot } from '../../lib/utils'
import ComingSoon from '../../components/ComingSoon'

// ── 공통 유틸 ──────────────────────────────────────────────────
function MetricBar({ label, value = 0, warn = 80, crit = 90 }) {
  const pct   = Math.min(100, value)
  const color = pct >= crit ? 'bg-red-500' : pct >= warn ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="text-white">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%`, transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

const HB_STATUS_META = {
  ALIVE:   { cls: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30',   icon: '●', label: 'ALIVE' },
  SLOW:    { cls: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', icon: '●', label: 'SLOW'  },
  TIMEOUT: { cls: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',       icon: '●', label: 'T/O'   },
  DEAD:    { cls: 'text-gray-600',   bg: 'bg-gray-800 border-gray-700',           icon: '○', label: 'DEAD'  },
}

const META_STATUS_META = {
  IN_SYNC:  { cls: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30',  label: 'IN_SYNC'  },
  DIVERGED: { cls: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', label: 'DIVERGED' },
  SYNCING:  { cls: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30',    label: 'SYNCING'  },
  UNKNOWN:  { cls: 'text-gray-500',   bg: 'bg-gray-800 border-gray-700',          label: '—'        },
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── 탭: 복제 현황 ──────────────────────────────────────────────
function ReplicationTab({ clusters, loading }) {
  return (
    <div className="space-y-5">
      {loading && clusters.length === 0 ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : clusters.map(c => {
        const primary = c.nodes?.find(n => n.role === 'PRIMARY')
        const standby = c.nodes?.find(n => n.role === 'STANDBY')
        const faults  = c.nodes?.filter(n => n.role === 'FAULT' || n.state === 'STOPPED') ?? []
        const syncOk  = faults.length === 0 && primary && standby

        return (
          <div key={c.clusterId} className="card-bg rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                {syncOk
                  ? <CheckCircle2 className="w-5 h-5 text-green-400" />
                  : <AlertCircle  className="w-5 h-5 text-red-400" />}
                <span className="font-bold text-white">{c.clusterName}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${syncOk
                  ? 'bg-green-500/15 text-green-400 border-green-500/30'
                  : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                  {syncOk ? 'SYNC OK' : 'DEGRADED'}
                </span>
              </div>
              <div className="text-xs text-gray-500">VIP: {c.vip || '—'}</div>
            </div>

            <div className="grid grid-cols-5 gap-6 items-center">
              <div className="col-span-2 space-y-3">
                <p className="text-[10px] text-blue-400 font-bold uppercase mb-2">PRIMARY · {primary?.hostname ?? '—'}</p>
                <MetricBar label="CPU"  value={primary?.metrics?.cpuPercent} />
                <MetricBar label="MEM"  value={primary?.metrics?.memoryPercent} />
                <MetricBar label="DISK" value={primary?.metrics?.diskPercent} warn={75} crit={85} />
              </div>
              <div className="col-span-1 flex flex-col items-center gap-3">
                <div className={`text-[10px] font-bold ${syncOk ? 'text-green-400' : 'text-red-400'}`}>복제</div>
                <div className="space-y-1.5 w-full">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`h-1 rounded-full ${syncOk ? 'bg-green-500/60 animate-pulse' : 'bg-red-500/40'}`}
                      style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-gray-500">지연</p>
                  <p className="text-xs font-bold text-white">0ms</p>
                </div>
              </div>
              <div className="col-span-2 space-y-3">
                <p className="text-[10px] text-gray-400 font-bold uppercase mb-2">STANDBY · {standby?.hostname ?? '—'}</p>
                <MetricBar label="CPU"  value={standby?.metrics?.cpuPercent} />
                <MetricBar label="MEM"  value={standby?.metrics?.memoryPercent} />
                <MetricBar label="DISK" value={standby?.metrics?.diskPercent} warn={75} crit={85} />
              </div>
            </div>

            {faults.length > 0 && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300">
                ⚠ 장애 노드: {faults.map(n => n.hostname).join(', ')}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 탭: 하트비트 현황 ─────────────────────────────────────────
function HeartbeatTab({ clusters }) {
  const [clusterId, setClusterId] = useState(null)
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    if (clusters.length > 0 && !clusterId) setClusterId(clusters[0].clusterId)
  }, [clusters])

  const load = useCallback(async () => {
    if (!clusterId) return
    setLoading(true)
    try { const r = await getHaHeartbeat(clusterId); setData(r.data) }
    catch { /* ignore */ } finally { setLoading(false) }
  }, [clusterId])

  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv) }, [load])

  const nodes = data?.nodes ?? []

  return (
    <div className="space-y-5">
      <ComingSoon feature="HA 메타데이터 동기화·하트비트 조회" />
      <div className="flex items-center gap-3">
        <select value={clusterId ?? ''} onChange={e => setClusterId(+e.target.value)}
          className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500">
          {clusters.map(c => <option key={c.clusterId} value={c.clusterId}>{c.clusterName}</option>)}
        </select>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white border border-gray-700 rounded-lg">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {data && <span className="text-[10px] text-gray-600">마지막 수신: {fmtTime(data.timestamp)}</span>}
      </div>

      {loading && !data ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : (
        <div className="card-bg rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
            <Heart className="w-4 h-4 text-red-400" />
            <span className="text-sm font-bold text-white">하트비트 매트릭스</span>
          </div>
          <div className="p-4 overflow-x-auto">
            {nodes.length === 0 ? (
              <p className="text-center py-8 text-gray-500 text-sm">노드 없음</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 text-gray-500 font-medium w-48">송신 \ 수신</th>
                    {nodes.map(n => (
                      <th key={n.nodeId} className="py-2 px-3 text-center min-w-[120px]">
                        <div className="text-gray-400 font-medium">{n.hostname}</div>
                        <div className={`text-[10px] mt-0.5 ${n.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}`}>{n.role}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {nodes.map(fromNode => (
                    <tr key={fromNode.nodeId} className="border-t border-gray-800/50">
                      <td className="py-3 px-3">
                        <div className="font-medium text-white">{fromNode.hostname}</div>
                        <div className={`text-[10px] mt-0.5 ${fromNode.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}`}>
                          {fromNode.role} · {fromNode.state}
                        </div>
                      </td>
                      {nodes.map(toNode => {
                        if (fromNode.nodeId === toNode.nodeId) {
                          return <td key={toNode.nodeId} className="py-3 px-3 text-center"><span className="text-gray-700">—</span></td>
                        }
                        const hb   = fromNode.heartbeats?.find(h => h.toNodeId === toNode.nodeId)
                        const meta = HB_STATUS_META[hb?.status ?? 'DEAD']
                        return (
                          <td key={toNode.nodeId} className="py-3 px-3 text-center">
                            <div className={`inline-flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg border ${meta.bg}`}>
                              <span className={`text-[10px] font-bold ${meta.cls}`}>{meta.icon} {meta.label}</span>
                              {hb?.latencyMs != null && <span className="text-[10px] text-gray-500">{hb.latencyMs}ms</span>}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 탭: 메타데이터 동기화 ──────────────────────────────────────
function MetadataSyncTab({ clusters }) {
  const [clusterId, setClusterId] = useState(null)
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [syncing, setSyncing]     = useState(false)
  const [syncMsg, setSyncMsg]     = useState(null)

  useEffect(() => {
    if (clusters.length > 0 && !clusterId) setClusterId(clusters[0].clusterId)
  }, [clusters])

  const load = useCallback(async () => {
    if (!clusterId) return
    setLoading(true)
    try { const r = await getHaMetadataSync(clusterId); setData(r.data) }
    catch { /* ignore */ } finally { setLoading(false) }
  }, [clusterId])

  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv) }, [load])

  async function triggerSync() {
    setSyncing(true)
    try {
      const r = await triggerHaMetadataSync(clusterId)
      setSyncMsg(r.data.message ?? '동기화가 시작되었습니다.')
      setTimeout(() => setSyncMsg(null), 3000)
      setTimeout(() => load(), 1500)
    } catch { setSyncMsg('동기화 요청 실패') }
    finally { setSyncing(false) }
  }

  const items = data?.items ?? []
  const divergedCount = items.filter(i => !i.allInSync).length

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <select value={clusterId ?? ''} onChange={e => setClusterId(+e.target.value)}
          className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500">
          {clusters.map(c => <option key={c.clusterId} value={c.clusterId}>{c.clusterName}</option>)}
        </select>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white border border-gray-700 rounded-lg">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button onClick={triggerSync} disabled={syncing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-blue-600/15 border border-blue-600/30 text-blue-400 hover:bg-blue-600/25 disabled:opacity-50">
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
          {syncing ? '동기화 중...' : '수동 동기화'}
        </button>
        {syncMsg && <span className="text-xs text-green-400">{syncMsg}</span>}
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">전체 상태</p>
            <p className={`text-lg font-bold mt-1 ${data.overallStatus === 'IN_SYNC' ? 'text-green-400' : 'text-yellow-400'}`}>
              {data.overallStatus === 'IN_SYNC' ? '● 동기화 완료' : '⚠ 불일치 감지'}
            </p>
          </div>
          <div className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">불일치 항목</p>
            <p className={`text-2xl font-bold mt-1 ${divergedCount > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{divergedCount}</p>
          </div>
          <div className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">마지막 동기화</p>
            <p className="text-sm font-bold text-white mt-1">{fmtTime(data.lastSyncAt)}</p>
          </div>
        </div>
      )}

      <div className="card-bg rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold text-white">메타데이터 항목별 동기화 현황</span>
        </div>
        {loading && !data ? (
          <div className="text-center py-16 text-gray-500">로딩 중...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-gray-500">데이터 없음</div>
        ) : (
          <div className="divide-y divide-gray-800/60">
            {items.map(item => (
              <div key={item.key} className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {item.allInSync
                      ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                      : <AlertTriangle className="w-4 h-4 text-yellow-400" />}
                    <span className="text-sm font-medium text-white">{item.label}</span>
                    <span className="text-[10px] text-gray-600">마스터 v{item.masterVersion}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded border ${item.allInSync
                    ? 'bg-green-500/15 text-green-400 border-green-500/30'
                    : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'}`}>
                    {item.allInSync ? 'IN_SYNC' : 'DIVERGED'}
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {item.nodes.map(n => {
                    const meta = META_STATUS_META[n.status] ?? META_STATUS_META.UNKNOWN
                    return (
                      <div key={n.nodeId} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${meta.bg}`}>
                        <span className={`font-bold ${meta.cls}`}>{n.status !== 'UNKNOWN' ? meta.label : '—'}</span>
                        <span className="text-gray-400">{n.hostname}</span>
                        <span className={`text-[10px] ${n.status === 'DIVERGED' ? 'text-yellow-400 font-bold' : 'text-gray-600'}`}>
                          v{n.version}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 탭: 에이전트 상태 (읽기 전용) ────────────────────────────
function AgentStatusTab({ clusters, nodeMap, loading }) {
  return (
    <div className="space-y-5">
      {loading && clusters.length === 0 ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : clusters.map(c => {
        const nodes = nodeMap[c.id] ?? []
        const running = nodes.filter(n => n.state === 'RUNNING').length
        return (
          <div key={c.id} className="card-bg rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
              <Server className="w-4 h-4 text-blue-400" />
              <span className="font-bold text-white text-sm">{c.name}</span>
              <span className="text-xs text-gray-500">VIP: {c.vip || '—'}</span>
              <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full border ${
                running === nodes.length && nodes.length > 0
                  ? 'bg-green-500/15 text-green-400 border-green-500/30'
                  : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
              }`}>
                {running}/{nodes.length} RUNNING
              </span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-800/60">
                  {['호스트명', 'IP 주소', '역할', 'OS', '상태'].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nodes.map(n => (
                  <tr key={n.nodeId} className="border-b border-gray-800/40 hover:bg-white/5">
                    <td className="py-3 px-4">
                      <span className={`${dot(n.state)} mr-1`}>●</span>
                      <span className="font-medium text-white">{n.hostname}</span>
                    </td>
                    <td className="py-3 px-4 text-gray-400 font-mono">{n.ipAddress ?? '—'}</td>
                    <td className="py-3 px-4"><span className={statusBadge(n.role)}>{n.role}</span></td>
                    <td className="py-3 px-4 text-gray-400">{n.osType ?? 'Linux'}</td>
                    <td className="py-3 px-4"><span className={statusBadge(n.state)}>{n.state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// ── 메인 ──────────────────────────────────────────────────────
const TABS = [
  { key: 'replication', label: '복제 현황',        icon: Activity       },
  { key: 'heartbeat',   label: '하트비트 현황',    icon: Heart          },
  { key: 'metadata',    label: '메타데이터 동기화', icon: Database       },
  { key: 'agents',      label: '에이전트',          icon: Server         },
]

export default function ClusterStatus() {
  const [clusters,  setClusters]  = useState([])
  const [statuses,  setStatuses]  = useState([])
  const [nodeMap,   setNodeMap]   = useState({})
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('replication')

  async function load() {
    setLoading(true)
    try {
      const listRes = await getClusters()
      setClusters(listRes.data)

      const [stats, nm] = await Promise.all([
        Promise.all(listRes.data.map(c =>
          getClusterStatus(c.id)
            .then(r => r.data)
            .catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] }))
        )),
        (async () => {
          const m = {}
          await Promise.all(listRes.data.map(async c => {
            try { const r = await getClusterNodes(c.id); m[c.id] = r.data } catch { m[c.id] = [] }
          }))
          return m
        })(),
      ])

      setStatuses(stats)
      setNodeMap(nm)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const iv = setInterval(() => {
      if (activeTab === 'replication') load()
    }, 5000)
    return () => clearInterval(iv)
  }, [activeTab])

  return (
    <div className="p-8 pt-0 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">클러스터 상태</h2>
          <p className="text-xs text-gray-500 mt-1">복제 현황 · 하트비트 · 메타데이터 동기화 · 에이전트</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 수동 갱신
        </button>
      </div>

      <div className="flex gap-2 border-b border-gray-800 pb-0">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-white border-blue-500'
                  : 'text-gray-500 border-transparent hover:text-gray-300 hover:border-gray-600'
              }`}>
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'replication' && <ReplicationTab clusters={statuses} loading={loading} />}
      {activeTab === 'heartbeat'   && <HeartbeatTab   clusters={statuses} />}
      {activeTab === 'metadata'    && <MetadataSyncTab clusters={statuses} />}
      {activeTab === 'agents'      && <AgentStatusTab  clusters={clusters} nodeMap={nodeMap} loading={loading} />}
    </div>
  )
}
```

- [ ] **Step 3: 브라우저에서 /monitoring/cluster 확인**

- 4개 탭(복제 현황 / 하트비트 / 메타데이터 동기화 / 에이전트)이 표시되는지 확인
- 에이전트 탭: 노드 목록이 읽기 전용으로 표시되는지 확인 (편집 버튼 없음)
- 수동 갱신 버튼 동작 확인

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/monitoring/ClusterStatus.jsx
git commit -m "feat: add ClusterStatus page — merge sync, heartbeat, metadata, agent tabs"
```

---

## Task 4: HaSequence.jsx — 운영 Runbook 탭 추가

**Files:**
- Modify: `frontend/src/pages/ha/Sequence.jsx`

- [ ] **Step 1: import 추가**

`Sequence.jsx` 상단 import에 아래를 추가한다.

```jsx
import { ClipboardList, Play, Check, SkipForward } from 'lucide-react'
import { getRunbook, createRunbook, updateRunbookStep } from '../../api/client'
import { fmt } from '../../lib/utils'
```

> `Play`, `Check`, `SkipForward`는 이미 import되어 있으므로 중복 제거 후 추가한다. `getRunbook`, `createRunbook`, `updateRunbookStep`, `fmt`만 추가하면 된다.

- [ ] **Step 2: TABS 상수에 Runbook 탭 추가**

기존 `const TABS = [...]` 배열에 항목을 추가한다.

```jsx
const TABS = [
  { key: 'STARTUP',  label: '기동 절차',     icon: Power,          color: 'text-green-400'  },
  { key: 'SHUTDOWN', label: '중지 절차',     icon: PowerOff,       color: 'text-red-400'    },
  { key: 'FAILOVER', label: 'Failover 절차', icon: ArrowRightLeft,  color: 'text-purple-400' },
  { key: 'RUNBOOK',  label: '운영 Runbook',  icon: ClipboardList,  color: 'text-orange-400' },
]
```

- [ ] **Step 3: RunbookTab 컴포넌트 추가**

`HaSequence.jsx`의 `// ── 메인 ──` 주석 바로 위에 아래 컴포넌트를 삽입한다.

```jsx
// ── 탭: 운영 Runbook ──────────────────────────────────────────
const TYPE_LABELS   = { MAINTENANCE: '정기점검', BACKUP: 'DB백업', FAILOVER: 'Failover', PATCH: '패치', OTHER: '기타' }
const STATUS_COLORS = { COMPLETED: 'text-green-400', IN_PROGRESS: 'text-blue-400', SCHEDULED: 'text-yellow-400' }

function RunbookTab() {
  const [list,    setList]    = useState([])
  const [active,  setActive]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState({ title: '', type: 'MAINTENANCE', target: '' })
  const [saving,  setSaving]  = useState(false)

  async function load() {
    setLoading(true)
    try { const r = await getRunbook(); setList(r.data ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function createNew(e) {
    e.preventDefault()
    setSaving(true)
    try { await createRunbook(form); await load(); setAdding(false) }
    finally { setSaving(false) }
  }

  async function advanceStep(runbookId, stepIndex) {
    try { await updateRunbookStep(runbookId, stepIndex); await load() }
    catch { /* ignore */ }
  }

  const sel = active ? list.find(r => r.id === active) : null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">운영 절차 실행 이력 및 단계별 진행 관리</p>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-600/10 border border-blue-600/20 text-blue-400 hover:bg-blue-600/20">
          <Plus className="w-3.5 h-3.5" /> 신규 작성
        </button>
      </div>

      {adding && (
        <div className="card-bg rounded-xl p-5">
          <p className="text-sm font-bold text-white mb-4">새 Runbook</p>
          <form onSubmit={createNew} className="space-y-3">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="제목 (예: 정기 점검 2026-06-12)"
              className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                placeholder="대상 클러스터"
                className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(false)}
                className="flex-1 py-2 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
              <button type="submit" disabled={saving}
                className="flex-1 py-2 rounded-lg text-xs bg-blue-600 text-white disabled:opacity-50">
                {saving ? '생성 중...' : '생성'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : list.length === 0 ? (
        <div className="text-center py-16 text-gray-500">Runbook이 없습니다</div>
      ) : (
        <div className="space-y-3">
          {list.map(rb => (
            <div key={rb.id} className="card-bg rounded-xl overflow-hidden">
              <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 text-left"
                onClick={() => setActive(active === rb.id ? null : rb.id)}>
                <div className="flex items-center gap-3">
                  <ClipboardList className="w-4 h-4 text-orange-400" />
                  <div>
                    <p className="text-sm font-bold text-white">{rb.title}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {TYPE_LABELS[rb.type] ?? rb.type} · {rb.target} · {fmt(rb.createdAt)}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-bold ${STATUS_COLORS[rb.status] ?? 'text-gray-400'}`}>
                  {rb.status}
                </span>
              </button>

              {active === rb.id && rb.steps && (
                <div className="border-t border-gray-800 px-5 py-4 space-y-2">
                  {rb.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <button onClick={() => advanceStep(rb.id, i)} disabled={step.done}
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all
                          ${step.done   ? 'bg-green-500' : step.active ? 'bg-blue-600 animate-pulse' : 'bg-gray-700 hover:bg-gray-600'}`}>
                        {step.done   && <Check    className="w-3 h-3 text-white" />}
                        {step.active && <Play     className="w-3 h-3 text-white" />}
                        {!step.done && !step.active && <SkipForward className="w-3 h-3 text-gray-500" />}
                      </button>
                      <span className={`text-xs ${step.done ? 'text-gray-500 line-through' : step.active ? 'text-white' : 'text-gray-400'}`}>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 메인 컴포넌트에서 RunbookTab 렌더링 추가**

`HaSequence.jsx`의 메인 컴포넌트 return 안, 기존 탭 컨텐츠 렌더링 아래에 추가한다.

기존 코드에서 탭 컨텐츠 렌더링 부분을 찾아(보통 `{activeTab === 'STARTUP' && ...}` 형태), 그 끝에 아래를 추가한다.

```jsx
{activeTab === 'RUNBOOK' && <RunbookTab />}
```

- [ ] **Step 5: Plus 아이콘 import 확인**

`Sequence.jsx` 상단에 `Plus` 아이콘이 이미 import되어 있는지 확인한다 (이미 있음).

- [ ] **Step 6: 브라우저에서 /ha/sequence 확인**

- 탭 4개: 기동 절차 / 중지 절차 / Failover 절차 / 운영 Runbook 표시 확인
- 운영 Runbook 탭 클릭 → 목록 로드, 신규 작성 버튼 동작 확인

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ha/Sequence.jsx
git commit -m "feat: add Runbook tab to HA Sequence page"
```

---

## 최종 확인 체크리스트

- [ ] 사이드바 6개 섹션이 올바르게 렌더링된다
- [ ] 사이드바에서 제거된 항목(노드, 알람 현황, 알람 설정, 이미지)이 메뉴에 보이지 않는다
- [ ] `/ha/sync` → `/monitoring/cluster` redirect 동작
- [ ] `/runbook` → `/ha/sequence` redirect 동작
- [ ] `/monitoring/cluster` 4개 탭 모두 동작
- [ ] `/ha/sequence` 운영 Runbook 탭 동작
- [ ] 기존 페이지(/settings/clusters, /settings/agents 등)는 직접 URL 접근 가능
