import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Zap, RefreshCw } from 'lucide-react'
import { getClusters, getClusterStatus } from '../../api/client'
import { statusBadge, dot } from '../../lib/utils'

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
            const primary = c.nodes?.find(n => n.role === 'PRIMARY' || n.role === 'active')
            const standby = c.nodes?.find(n => n.role === 'STANDBY' || n.role === 'standby')
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

                <div className="grid grid-cols-3 gap-4">
                  {/* Primary */}
                  <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/30">
                    <p className="text-[10px] text-blue-400 font-bold mb-2">PRIMARY</p>
                    <div className="flex items-center gap-2">
                      <Server className="w-8 h-8 text-blue-400" />
                      <div>
                        <p className="text-sm font-bold text-white">{primary?.hostname ?? '—'}</p>
                        <p className="text-xs text-gray-500">{primary?.ipAddress ?? ''}</p>
                      </div>
                    </div>
                    {primary?.metrics && (
                      <div className="mt-3 grid grid-cols-3 gap-1 text-[10px]">
                        {[['CPU', primary.metrics.cpuPercent], ['MEM', primary.metrics.memoryPercent], ['DISK', primary.metrics.diskPercent]].map(([k, v]) => (
                          <div key={k} className="bg-black/20 rounded p-1 text-center">
                            <p className="text-gray-500">{k}</p>
                            <p className="text-white font-bold">{v?.toFixed(0) ?? 0}%</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sync */}
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className={`text-xs font-bold ${hasFault ? 'text-red-400' : 'text-green-400'}`}>
                      {hasFault ? '⚠ DEGRADED' : '✓ SYNC OK'}
                    </div>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${hasFault ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`} style={{ width: hasFault ? '30%' : '100%' }} />
                    </div>
                    <p className="text-[10px] text-gray-600">Active / Standby</p>
                  </div>

                  {/* Standby */}
                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <p className="text-[10px] text-gray-400 font-bold mb-2">STANDBY</p>
                    <div className="flex items-center gap-2">
                      <Server className="w-8 h-8 text-gray-500" />
                      <div>
                        <p className="text-sm font-bold text-white">{standby?.hostname ?? '—'}</p>
                        <p className="text-xs text-gray-500">{standby?.ipAddress ?? ''}</p>
                      </div>
                    </div>
                    {standby?.metrics && (
                      <div className="mt-3 grid grid-cols-3 gap-1 text-[10px]">
                        {[['CPU', standby.metrics.cpuPercent], ['MEM', standby.metrics.memoryPercent], ['DISK', standby.metrics.diskPercent]].map(([k, v]) => (
                          <div key={k} className="bg-black/20 rounded p-1 text-center">
                            <p className="text-gray-500">{k}</p>
                            <p className="text-white font-bold">{v?.toFixed(0) ?? 0}%</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 이외 노드 */}
                {(c.nodes?.length ?? 0) > 2 && (
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {c.nodes.slice(2).map(n => (
                      <span key={n.nodeId} className={`${statusBadge(n.role)} text-[10px]`}>
                        {n.hostname} ({n.role})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
