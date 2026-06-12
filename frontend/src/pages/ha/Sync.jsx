import React, { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle2, AlertCircle, RefreshCw, Heart, Database,
  Activity, Wifi, WifiOff, AlertTriangle, Loader2, ArrowRightLeft,
} from 'lucide-react'
import { getClusters, getClusterStatus, getHaHeartbeat, getHaMetadataSync, triggerHaMetadataSync } from '../../api/client'
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
  ALIVE:   { cls: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30',  icon: '●', label: 'ALIVE' },
  SLOW:    { cls: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', icon: '●', label: 'SLOW'  },
  TIMEOUT: { cls: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',       icon: '●', label: 'T/O'   },
  DEAD:    { cls: 'text-gray-600',   bg: 'bg-gray-800 border-gray-700',           icon: '○', label: 'DEAD'  },
}

const META_STATUS_META = {
  IN_SYNC:  { cls: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30', label: 'IN_SYNC'  },
  DIVERGED: { cls: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', label: 'DIVERGED' },
  SYNCING:  { cls: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30',   label: 'SYNCING'  },
  UNKNOWN:  { cls: 'text-gray-500',   bg: 'bg-gray-800 border-gray-700',         label: '—'        },
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

            {(c.nodes?.length ?? 0) > 2 && (
              <div className="mt-4 border-t border-gray-800 pt-4 grid grid-cols-6 gap-2 text-[10px]">
                {c.nodes.map(n => (
                  <div key={n.nodeId} className="bg-gray-900/50 rounded-lg p-2 text-center">
                    <p className="text-gray-400 truncate">{n.hostname}</p>
                    <p className={`mt-0.5 font-bold ${n.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}`}>{n.role}</p>
                  </div>
                ))}
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
  const allNodes = nodes

  return (
    <div className="space-y-5">
      <ComingSoon feature="HA 메타데이터 동기화·하트비트 조회" />
      {/* 클러스터 선택 */}
      <div className="flex items-center gap-3">
        <select value={clusterId ?? ''} onChange={e => setClusterId(+e.target.value)}
          className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500">
          {clusters.map(c => <option key={c.clusterId} value={c.clusterId}>{c.clusterName}</option>)}
        </select>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white border border-gray-700 rounded-lg">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {data && (
          <span className="text-[10px] text-gray-600">마지막 수신: {fmtTime(data.timestamp)}</span>
        )}
      </div>

      {loading && !data ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : (
        <>
          {/* 하트비트 매트릭스 */}
          <div className="card-bg rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-800 flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-400" />
              <span className="text-sm font-bold text-white">하트비트 매트릭스</span>
              <span className="text-xs text-gray-500">— 각 노드의 상대 노드 감지 상태</span>
            </div>

            <div className="p-4 overflow-x-auto">
              {allNodes.length === 0 ? (
                <p className="text-center py-8 text-gray-500 text-sm">노드 없음</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium w-48">송신 \ 수신</th>
                      {allNodes.map(n => (
                        <th key={n.nodeId} className="py-2 px-3 text-center min-w-[120px]">
                          <div className="text-gray-400 font-medium">{n.hostname}</div>
                          <div className={`text-[10px] mt-0.5 ${n.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}`}>
                            {n.role}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allNodes.map(fromNode => (
                      <tr key={fromNode.nodeId} className="border-t border-gray-800/50">
                        <td className="py-3 px-3">
                          <div className="font-medium text-white">{fromNode.hostname}</div>
                          <div className={`text-[10px] mt-0.5 ${fromNode.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}`}>
                            {fromNode.role} · {fromNode.state}
                          </div>
                        </td>
                        {allNodes.map(toNode => {
                          if (fromNode.nodeId === toNode.nodeId) {
                            return (
                              <td key={toNode.nodeId} className="py-3 px-3 text-center">
                                <span className="text-gray-700">—</span>
                              </td>
                            )
                          }
                          const hb   = fromNode.heartbeats?.find(h => h.toNodeId === toNode.nodeId)
                          const meta = HB_STATUS_META[hb?.status ?? 'DEAD']
                          return (
                            <td key={toNode.nodeId} className="py-3 px-3 text-center">
                              <div className={`inline-flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg border ${meta.bg}`}>
                                <span className={`text-[10px] font-bold ${meta.cls}`}>
                                  {meta.icon} {meta.label}
                                </span>
                                {hb?.latencyMs != null ? (
                                  <span className="text-[10px] text-gray-500">{hb.latencyMs}ms</span>
                                ) : (
                                  hb?.consecutiveFailures > 0 && (
                                    <span className="text-[10px] text-red-400">{hb.consecutiveFailures}회 실패</span>
                                  )
                                )}
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

          {/* 노드별 하트비트 수신 현황 */}
          <div className="grid grid-cols-2 gap-4">
            {allNodes.map(node => {
              const alive  = node.heartbeats?.filter(h => h.status === 'ALIVE' || h.status === 'SLOW').length ?? 0
              const total  = node.heartbeats?.length ?? 0
              const health = total === 0 ? 'DEAD' : alive === total ? 'OK' : alive > 0 ? 'PARTIAL' : 'DEAD'
              return (
                <div key={node.nodeId} className={`card-bg rounded-xl p-4 border ${
                  health === 'OK'      ? 'border-green-500/20' :
                  health === 'PARTIAL' ? 'border-yellow-500/20' : 'border-red-500/20'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {node.state === 'RUNNING'
                        ? <Wifi className="w-4 h-4 text-green-400" />
                        : <WifiOff className="w-4 h-4 text-red-400" />}
                      <span className="text-sm font-bold text-white">{node.hostname}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold
                        ${node.role === 'PRIMARY' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-400'}`}>
                        {node.role}
                      </span>
                    </div>
                    <span className={`text-xs font-bold
                      ${health === 'OK' ? 'text-green-400' : health === 'PARTIAL' ? 'text-yellow-400' : 'text-red-400'}`}>
                      {alive}/{total}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {node.heartbeats?.map(hb => {
                      const meta = HB_STATUS_META[hb.status ?? 'DEAD']
                      return (
                        <div key={hb.toNodeId} className="flex items-center justify-between text-xs">
                          <span className="text-gray-400">→ {hb.toHostname}</span>
                          <div className="flex items-center gap-2">
                            {hb.latencyMs != null && (
                              <span className="text-gray-600">{hb.latencyMs}ms</span>
                            )}
                            {hb.consecutiveFailures > 0 && (
                              <span className="text-red-400 text-[10px]">{hb.consecutiveFailures}회 연속실패</span>
                            )}
                            <span className={`text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {node.state !== 'RUNNING' && (
                    <p className="text-[10px] text-red-400 mt-2 pt-2 border-t border-gray-800">
                      노드 비가동 — 하트비트 전송 불가
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
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
      {/* 클러스터 선택 + 동기화 버튼 */}
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

      {/* 전체 상태 요약 */}
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
            <p className={`text-2xl font-bold mt-1 ${divergedCount > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
              {divergedCount}
            </p>
          </div>
          <div className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">마지막 동기화</p>
            <p className="text-sm font-bold text-white mt-1">{fmtTime(data.lastSyncAt)}</p>
          </div>
        </div>
      )}

      {/* 항목별 동기화 현황 */}
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
                  <span className={`text-[10px] font-bold px-2 py-1 rounded border
                    ${item.allInSync
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
                          {n.status === 'DIVERGED' && ` (마스터 v${item.masterVersion})`}
                        </span>
                        {n.lastSyncAt && (
                          <span className="text-[10px] text-gray-600">{fmtTime(n.lastSyncAt)}</span>
                        )}
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

// ── 메인 ──────────────────────────────────────────────────────
const TABS = [
  { key: 'replication', label: '복제 현황',       icon: Activity       },
  { key: 'heartbeat',   label: '하트비트 현황',   icon: Heart          },
  { key: 'metadata',    label: '메타데이터 동기화', icon: Database      },
]

export default function HaSync() {
  const [clusters,  setClusters]  = useState([])
  const [statuses,  setStatuses]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('replication')

  async function load() {
    setLoading(true)
    try {
      const listRes = await getClusters()
      setClusters(listRes.data)
      const stats = await Promise.all(
        listRes.data.map(c =>
          getClusterStatus(c.id)
            .then(r => r.data)
            .catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] }))
        )
      )
      setStatuses(stats)
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
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">동기화 현황</h2>
          <p className="text-xs text-gray-500 mt-1">HA 복제 상태 · 하트비트 · 메타데이터 동기화</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 수동 갱신
        </button>
      </div>

      {/* 탭 */}
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

      {/* 탭 컨텐츠 */}
      {activeTab === 'replication' && (
        <ReplicationTab clusters={statuses} loading={loading} />
      )}
      {activeTab === 'heartbeat' && (
        <HeartbeatTab clusters={statuses} />
      )}
      {activeTab === 'metadata' && (
        <MetadataSyncTab clusters={statuses} />
      )}
    </div>
  )
}
