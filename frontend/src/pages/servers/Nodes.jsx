import React, { useEffect, useState } from 'react'
import { getClusters, getClusterStatus } from '../../api/client'
import { dot } from '../../lib/utils'
import { RefreshCw, ChevronDown } from 'lucide-react'

function GaugeBar({ value = 0, crit = 90, warn = 75 }) {
  const color = value >= crit ? '#f87171' : value >= warn ? '#fbbf24' : '#60a5fa'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-300 w-8 text-right">{value.toFixed(0)}%</span>
    </div>
  )
}

export default function Nodes() {
  const [clusters, setClusters] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading]   = useState(true)

  async function load() {
    setLoading(true)
    try {
      const listRes = await getClusters()
      const statuses = await Promise.all(
        listRes.data.map(c => getClusterStatus(c.id).then(r => r.data).catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] })))
      )
      setClusters(statuses)
      if (Object.keys(expanded).length === 0 && statuses.length > 0) {
        setExpanded({ [statuses[0].clusterId]: true })
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv) }, [])

  const toggle = id => setExpanded(e => ({ ...e, [id]: !e[id] }))

  return (
    <div className="p-8 pt-0 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">노드 현황</h2>
          <p className="text-xs text-gray-500 mt-1">클러스터별 노드 리소스 모니터링 · 5초 갱신</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 갱신
        </button>
      </div>

      {loading && clusters.length === 0
        ? <div className="text-center py-16 text-gray-500">로딩 중...</div>
        : clusters.map(c => (
          <div key={c.clusterId} className="card-bg rounded-xl overflow-hidden">
            <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5"
              onClick={() => toggle(c.clusterId)}>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${c.nodes?.some(n => n.state !== 'RUNNING') ? 'bg-red-400' : 'bg-green-400'}`} />
                <span className="font-bold text-white text-sm">{c.clusterName}</span>
                <span className="text-xs text-gray-500">{c.nodes?.length ?? 0}개 노드 · VIP {c.vip || '—'}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded[c.clusterId] ? 'rotate-180' : ''}`} />
            </button>

            {expanded[c.clusterId] && (
              <div className="border-t border-gray-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 uppercase border-b border-gray-800/60">
                      {['호스트','IP','역할','상태','CPU','메모리','디스크','네트워크 RX/TX'].map(h => (
                        <th key={h} className="text-left py-2.5 px-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(c.nodes ?? []).map(n => (
                      <tr key={n.nodeId} className="border-b border-gray-800/40 hover:bg-white/5">
                        <td className="py-3 px-4">
                          <span className={`font-medium ${dot(n.state)}`}>● </span>
                          <span className="text-white">{n.hostname}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-400 font-mono">{n.ipAddress ?? '—'}</td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            n.role === 'PRIMARY' || n.role === 'active' ? 'bg-blue-500/20 text-blue-400'
                            : n.role === 'FAULT' ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-500/20 text-gray-400'}`}>
                            {n.role}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={n.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}>
                            {n.state}
                          </span>
                        </td>
                        <td className="py-3 px-4 w-32"><GaugeBar value={n.metrics?.cpuPercent ?? 0} /></td>
                        <td className="py-3 px-4 w-32"><GaugeBar value={n.metrics?.memoryPercent ?? 0} crit={95} warn={85} /></td>
                        <td className="py-3 px-4 w-32"><GaugeBar value={n.metrics?.diskPercent ?? 0} crit={90} warn={80} /></td>
                        <td className="py-3 px-4 text-gray-400">
                          {n.metrics
                            ? `${((n.metrics.networkRxBytesPerSec ?? 0) / 1048576).toFixed(1)} / ${((n.metrics.networkTxBytesPerSec ?? 0) / 1048576).toFixed(1)} MB/s`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      }
    </div>
  )
}
