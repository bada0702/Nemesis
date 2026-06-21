import React, { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle2, AlertCircle, RefreshCw, Heart, Database,
  Activity, AlertTriangle, Loader2, ArrowRightLeft, Server,
} from 'lucide-react'
import {
  getClusters, getClusterStatus, getClusterNodes,
  getHaHeartbeat, getHaMetadataSync, triggerHaMetadataSync,
} from '../../api/client'
import { statusBadge, dot } from '../../lib/utils'

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
export function ReplicationTab({ clusters, loading }) {
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
export function HeartbeatTab({ clusters }) {
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
      <div className="flex items-center gap-3">
        <select value={clusterId ?? ''} onChange={e => setClusterId(e.target.value)}
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
export function MetadataSyncTab({ clusters }) {
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
        <select value={clusterId ?? ''} onChange={e => setClusterId(e.target.value)}
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
export function AgentStatusTab({ clusters, nodeMap, loading }) {
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

  const load = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(() => {
      if (activeTab === 'replication') load()
    }, 5000)
    return () => clearInterval(iv)
  }, [load, activeTab])

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
