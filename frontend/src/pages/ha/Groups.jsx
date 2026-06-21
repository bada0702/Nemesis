import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Zap, RefreshCw, ChevronRight, Bot } from 'lucide-react'
import { getClusters, getClusterStatus } from '../../api/client'
import { statusBadge, dot } from '../../lib/utils'

const ROLE_BADGE = {
  PRIMARY:    'text-sky-400 border-sky-500/30 bg-sky-500/10',
  STANDBY:    'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  FAULT:      'text-red-400 border-red-500/30 bg-red-500/10',
  RECOVERING: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
}

// 노드 + 그 노드의 트리뷰 내용(서비스 목록 + 에이전트 상태)
function NodeTreeRow({ node }) {
  const [open, setOpen] = useState(true)
  const procs   = node.metrics?.processes ?? []
  const running = procs.filter(p => p.status === 'running').length
  const agentUp = node.lastSeenAt != null && (Date.now() - new Date(node.lastSeenAt).getTime()) < 30_000
  const toneIcon = node.state === 'STOPPED' || node.role === 'FAULT' ? 'text-red-400'
    : node.role === 'PRIMARY' ? 'text-sky-400'
    : node.role === 'RECOVERING' ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03]" onClick={() => setOpen(o => !o)}>
        <ChevronRight className={`w-4 h-4 text-gray-600 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Server className={`w-4 h-4 ${toneIcon}`} />
        <span className="text-sm font-bold text-white">{node.hostname ?? '—'}</span>
        <span className={`text-[9px] font-bold border rounded px-1.5 py-0.5 ${ROLE_BADGE[node.role] ?? 'text-gray-400 border-gray-700'}`}>
          {node.role ?? '-'}
        </span>
        <span className="text-[10px] text-gray-600 font-mono">{node.ipAddress ?? '—'}</span>
        <span className="ml-auto text-[10px] text-gray-500 font-mono">서비스 {running}/{procs.length}</span>
      </div>
      {open && (
        <div className="border-t border-gray-800/60 divide-y divide-gray-800/30 bg-black/10">
          {procs.length === 0 ? (
            <p className="text-[11px] text-gray-600 pl-9 py-2">서비스 없음</p>
          ) : procs.map((p, i) => (
            <div key={`${p.name}-${i}`} className="flex items-center gap-2 pl-9 pr-4 py-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${p.status === 'running' ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-[12px] text-gray-300">{p.name}</span>
              <span className={`ml-auto text-[10px] font-mono font-bold ${p.status === 'running' ? 'text-emerald-400' : 'text-red-400'}`}>
                {p.status ?? 'unknown'}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 pl-9 pr-4 py-1.5">
            <Bot className="w-3.5 h-3.5 text-indigo-400/70" />
            <span className="text-[12px] text-gray-400">Nemesis Agent</span>
            <span className={`ml-auto text-[10px] font-mono font-bold ${agentUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {agentUp ? 'connected' : 'offline'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HaGroups() {
  const [clusters, setClusters] = useState([])
  const [loading, setLoading]   = useState(true)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    try {
      const listRes = await getClusters()
      const statuses = await Promise.all(
        listRes.data.map(c => getClusterStatus(c.id).then(r => r.data).catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] })))
      )
      setClusters(statuses)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv) }, [])

  const healthy = clusters.filter(c => !c.nodes?.some(n => n.role === 'FAULT' || n.state === 'STOPPED')).length

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">이중화(HA) 그룹 목록</h2>
          <p className="text-xs text-gray-500 mt-1">Active/Standby 클러스터 쌍 현황</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체 클러스터', value: clusters.length,    color: 'text-white' },
          { label: '정상',          value: healthy,             color: 'text-green-400' },
          { label: '이상',          value: clusters.length - healthy, color: 'text-red-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {loading && clusters.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">로딩 중...</div>
      ) : (
        <div className="space-y-4">
          {clusters.map(c => {
            const primary = c.nodes?.find(n => n.role === 'PRIMARY') ?? null
            const standby = c.nodes?.find(n => n.role === 'STANDBY') ?? null
            const hasFault = c.nodes?.some(n => n.role === 'FAULT' || n.state === 'STOPPED')
            return (
              <div key={c.clusterId} className="card-bg rounded-xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${hasFault ? 'bg-red-400' : 'bg-green-400'}`} />
                    <span className="font-bold text-white">{c.clusterName}</span>
                    <span className="text-xs text-gray-500">VIP: {c.vip || '—'}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => navigate(`/cluster/${c.clusterId}`)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600">
                      상세 보기
                    </button>
                    <button onClick={() => navigate(`/cluster/${c.clusterId}`)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20">
                      <Zap className="w-3 h-3" /> Failover
                    </button>
                  </div>
                </div>

                {/* 동기화 상태 바 */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`text-xs font-bold ${hasFault ? 'text-red-400' : 'text-green-400'}`}>
                    {hasFault ? '⚠ DEGRADED' : '✓ SYNC OK'}
                  </div>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${hasFault ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`} style={{ width: hasFault ? '30%' : '100%' }} />
                  </div>
                  <p className="text-[10px] text-gray-600">Active / Standby</p>
                </div>

                {/* 노드별 트리 — 각 노드 밑에 서비스/에이전트 */}
                <div className="space-y-2">
                  {(c.nodes?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-600 py-2">등록된 노드가 없습니다.</p>
                  ) : (
                    c.nodes.map(n => <NodeTreeRow key={n.nodeId} node={n} />)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
