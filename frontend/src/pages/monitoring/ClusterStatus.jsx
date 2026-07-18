import React, { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle2, RefreshCw, Heart, Database,
  AlertTriangle, Loader2, ArrowRightLeft, XCircle,
} from 'lucide-react'
import { getHaHeartbeat, getHaMetadataSync, triggerHaMetadataSync } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

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

// ── 탭: 하트비트 현황 ─────────────────────────────────────────
export function HeartbeatTab({ clusters }) {
  const [clusterId, setClusterId] = useState(null)
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    if (clusters.length > 0 && !clusterId) setClusterId(clusters[0].clusterId)
  }, [clusters])

  const load = useCallback(async () => {
    if (!clusterId) return
    setLoading(true)
    try { const r = await getHaHeartbeat(clusterId); setData(r.data); setError(null) }
    catch (e) { setError(e?.response?.data?.message ?? e.message) }
    finally { setLoading(false) }
  }, [clusterId])

  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv) }, [load])

  const nodes = data?.nodes ?? []
  const pairCounts = nodes.reduce((acc, from) => {
    (from.heartbeats ?? []).forEach(hb => { acc[hb.status] = (acc[hb.status] ?? 0) + 1 })
    return acc
  }, {})

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
        {nodes.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {Object.entries(HB_STATUS_META).map(([key, meta]) => (
              pairCounts[key] > 0 && (
                <span key={key} className={`text-[10px] font-bold px-2 py-1 rounded border ${meta.bg} ${meta.cls}`}>
                  {meta.label} {pairCounts[key]}
                </span>
              )
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">하트비트 조회 실패 — {error}</span>
        </div>
      )}

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
  const { isOperator } = useAuth()
  const [clusterId, setClusterId] = useState(null)
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [syncing, setSyncing]     = useState(false)
  const [syncMsg, setSyncMsg]     = useState(null)

  useEffect(() => {
    if (clusters.length > 0 && !clusterId) setClusterId(clusters[0].clusterId)
  }, [clusters])

  const load = useCallback(async () => {
    if (!clusterId) return
    setLoading(true)
    try { const r = await getHaMetadataSync(clusterId); setData(r.data); setError(null) }
    catch (e) { setError(e?.response?.data?.message ?? e.message) }
    finally { setLoading(false) }
  }, [clusterId])

  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv) }, [load])

  async function triggerSync() {
    setSyncing(true)
    try {
      const r = await triggerHaMetadataSync(clusterId)
      setSyncMsg({ ok: true, text: r.data.message ?? '동기화가 시작되었습니다.' })
      setTimeout(() => setSyncMsg(null), 3000)
      setTimeout(() => load(), 1500)
    } catch (e) {
      setSyncMsg({ ok: false, text: '동기화 요청 실패 — ' + (e?.response?.data?.message ?? e.message) })
    } finally { setSyncing(false) }
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
        <button onClick={triggerSync} disabled={!isOperator || syncing}
          title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-blue-600/15 border border-blue-600/30 text-blue-400 hover:bg-blue-600/25 disabled:opacity-40 disabled:cursor-not-allowed">
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
          {syncing ? '동기화 중...' : '수동 동기화'}
        </button>
        {syncMsg && <span className={`text-xs ${syncMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{syncMsg.text}</span>}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">메타데이터 동기화 상태 조회 실패 — {error}</span>
        </div>
      )}

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

