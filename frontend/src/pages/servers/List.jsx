import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, RefreshCw, Search, List, LayoutGrid, ChevronDown, Network } from 'lucide-react'
import { getClusters, getClusterStatus } from '../../api/client'
import { statusBadge, dot } from '../../lib/utils'

// ── 공통 바 ───────────────────────────────────────────────────
function MiniBar({ value = 0, crit = 90, warn = 75 }) {
  const color = value >= crit ? 'bg-red-500' : value >= warn ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-gray-300 w-7 text-right">{value.toFixed(0)}%</span>
    </div>
  )
}

function GaugeBar({ value = 0, crit = 90, warn = 75 }) {
  const color = value >= crit ? '#f87171' : value >= warn ? '#fbbf24' : '#60a5fa'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-300 w-8 text-right">{value.toFixed(0)}%</span>
    </div>
  )
}

// ── 미니 토폴로지 SVG ─────────────────────────────────────────
function ClusterTopology({ nodes, vip }) {
  const primary = nodes.find(n => n.role === 'PRIMARY')
  const others  = nodes.filter(n => n.role !== 'PRIMARY')
  const ordered = [primary, ...others].filter(Boolean)
  if (ordered.length === 0) return null

  const BW = 168, BH = 118, GAP = 76
  const N     = ordered.length
  const SVG_W = N * BW + (N - 1) * GAP + 20
  const NY    = 36
  const SVG_H = NY + BH + 10

  const positions = ordered.map((n, i) => ({ node: n, x: 10 + i * (BW + GAP) }))
  const pPos = positions[0]

  const nodeColor = n =>
    n.state !== 'RUNNING' ? '#f87171' :
    n.role === 'PRIMARY'  ? '#60a5fa' :
    n.role === 'FAULT'    ? '#f87171' : '#4ade80'

  const barColor = v => v > 85 ? '#f87171' : v > 70 ? '#fbbf24' : '#60a5fa'
  const trunc    = (s, l) => s.length > l ? s.slice(0, l - 1) + '…' : s

  return (
    <div className="bg-gray-950/50 rounded-xl p-4 border border-gray-800/50 overflow-x-auto">
      <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
        <Network className="w-3 h-3" /> Cluster Topology
      </p>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        style={{ height: SVG_H, minWidth: Math.min(SVG_W, 300) }}>

        <defs>
          <filter id="topo-glow-blue" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* VIP 배지 */}
        {pPos && vip && (
          <>
            <line x1={pPos.x + BW / 2} y1={20} x2={pPos.x + BW / 2} y2={NY}
              stroke="#60a5fa" strokeWidth="1" strokeDasharray="3 2" opacity="0.4" />
            <rect x={pPos.x + BW / 2 - 50} y={2} width={100} height={19} rx={4}
              fill="rgba(96,165,250,0.08)" stroke="rgba(96,165,250,0.4)" strokeWidth="1" />
            <text x={pPos.x + BW / 2} y={16} textAnchor="middle"
              fill="#93c5fd" fontSize="9" fontFamily="monospace" fontWeight="700">
              ▲ VIP {vip}
            </text>
          </>
        )}

        {/* 하트비트 연결선 */}
        {positions.slice(1).map(({ node, x }, i) => {
          const prev  = positions[i]
          const alive = node.state === 'RUNNING' && prev.node.state === 'RUNNING'
          const ly    = NY + BH / 2
          const midX  = (prev.x + BW + x) / 2
          return (
            <g key={'hb-' + node.nodeId}>
              <line x1={prev.x + BW} y1={ly} x2={x} y2={ly}
                stroke={alive ? '#4ade80' : '#f87171'} strokeWidth="1.5"
                strokeDasharray="6 3" opacity="0.75">
                {alive && (
                  <animate attributeName="stroke-dashoffset"
                    from="0" to="-18" dur="1.2s" repeatCount="indefinite" />
                )}
              </line>
              <rect x={midX - 24} y={ly - 11} width={48} height={14} rx={3}
                fill="#090d13" stroke={alive ? '#4ade8035' : '#f8717135'} />
              <text x={midX} y={ly + 1} textAnchor="middle"
                fill={alive ? '#4ade80' : '#f87171'} fontSize="8" fontWeight="700">
                {alive ? '▶ HB OK' : '✕ HB DOWN'}
              </text>
            </g>
          )
        })}

        {/* 노드 박스 */}
        {positions.map(({ node, x }) => {
          const color = nodeColor(node)
          const isUp  = node.state === 'RUNNING'
          const cpu   = node.metrics?.cpuPercent  ?? 0
          const mem   = node.metrics?.memoryPercent ?? 0
          const BY    = NY
          const bw    = 88  // bar width

          return (
            <g key={node.nodeId} opacity={isUp ? 1 : 0.65}>
              {/* 박스 배경 */}
              <rect x={x} y={BY} width={BW} height={BH} rx={8}
                fill="#161b22" stroke={color} strokeWidth={node.role === 'PRIMARY' ? 2 : 1.5}
                filter={node.role === 'PRIMARY' ? 'url(#topo-glow-blue)' : undefined} />

              {/* 역할 배지 (오른쪽 상단) */}
              <rect x={x + BW - 64} y={BY + 7} width={60} height={15} rx={3}
                fill={`${color}18`} stroke={`${color}50`} strokeWidth="1" />
              <text x={x + BW - 34} y={BY + 18} textAnchor="middle"
                fill={color} fontSize="8" fontWeight="700" letterSpacing="0.5">
                {node.role}
              </text>

              {/* 호스트명 */}
              <text x={x + 10} y={BY + 24} fill="#f3f4f6" fontSize="11" fontWeight="700">
                {trunc(node.hostname, 14)}
              </text>

              {/* IP */}
              <text x={x + 10} y={BY + 37} fill="#6b7280" fontSize="9" fontFamily="monospace">
                {node.ipAddress ?? '—'}
              </text>

              {/* 상태 도트 + 텍스트 */}
              <circle cx={x + 12} cy={BY + 51} r={3.5} fill={isUp ? '#4ade80' : '#f87171'} />
              <text x={x + 22} y={BY + 55}
                fill={isUp ? '#4ade80' : '#f87171'} fontSize="9" fontWeight="600">
                {isUp ? 'RUNNING' : 'STOPPED'}
              </text>

              {/* 메트릭 바 */}
              {isUp && node.metrics ? (
                <>
                  <text x={x + 10} y={BY + 72} fill="#6b7280" fontSize="8">CPU</text>
                  <rect x={x + 32} y={BY + 64} width={bw} height={5} rx={2.5} fill="#1f2937" />
                  <rect x={x + 32} y={BY + 64}
                    width={Math.round(bw * Math.min(cpu, 100) / 100)} height={5} rx={2.5}
                    fill={barColor(cpu)} />
                  <text x={x + 32 + bw + 4} y={BY + 72} fill="#9ca3af" fontSize="8">
                    {cpu.toFixed(0)}%
                  </text>

                  <text x={x + 10} y={BY + 86} fill="#6b7280" fontSize="8">MEM</text>
                  <rect x={x + 32} y={BY + 78} width={bw} height={5} rx={2.5} fill="#1f2937" />
                  <rect x={x + 32} y={BY + 78}
                    width={Math.round(bw * Math.min(mem, 100) / 100)} height={5} rx={2.5}
                    fill={barColor(mem)} />
                  <text x={x + 32 + bw + 4} y={BY + 86} fill="#9ca3af" fontSize="8">
                    {mem.toFixed(0)}%
                  </text>
                </>
              ) : !isUp ? (
                <text x={x + 10} y={BY + 85} fill="#f87171" fontSize="9">서비스 중지됨</text>
              ) : (
                <text x={x + 10} y={BY + 80} fill="#374151" fontSize="9">메트릭 없음</text>
              )}
            </g>
          )
        })}
      </svg>

      {/* 범례 */}
      <div className="flex gap-4 mt-2 text-[10px] text-gray-600">
        {[
          { color: '#60a5fa', label: 'PRIMARY' },
          { color: '#4ade80', label: 'STANDBY' },
          { color: '#f87171', label: 'FAULT/STOPPED' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
        <span className="ml-auto">━ Heartbeat 연결</span>
      </div>
    </div>
  )
}

// ── 테이블 뷰 ─────────────────────────────────────────────────
function TableView({ nodes, loading, navigate }) {
  return (
    <div className="card-bg rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <thead className="border-b border-gray-800">
          <tr className="text-gray-500 uppercase">
            {['', '호스트명', 'IP 주소', '역할', '상태', 'CPU', '메모리', '디스크', 'NET RX/TX', '클러스터', ''].map((h, i) => (
              <th key={i} className="text-left py-3 px-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && nodes.length === 0 ? (
            <tr><td colSpan="11" className="text-center py-12 text-gray-500">로딩 중...</td></tr>
          ) : nodes.length === 0 ? (
            <tr><td colSpan="11" className="text-center py-12 text-gray-500">검색 결과가 없습니다.</td></tr>
          ) : nodes.map((n, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-white/5 transition-colors">
              <td className="py-3 px-3">
                <Server className={`w-4 h-4 ${n.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}`} />
              </td>
              <td className="py-3 px-3 font-medium text-white">{n.hostname}</td>
              <td className="py-3 px-3 text-gray-400 font-mono">{n.ipAddress ?? '—'}</td>
              <td className="py-3 px-3"><span className={statusBadge(n.role)}>{n.role}</span></td>
              <td className="py-3 px-3"><span className={statusBadge(n.state)}>{n.state}</span></td>
              <td className="py-3 px-3"><MiniBar value={n.metrics?.cpuPercent ?? 0} /></td>
              <td className="py-3 px-3"><MiniBar value={n.metrics?.memoryPercent ?? 0} crit={95} warn={85} /></td>
              <td className="py-3 px-3"><MiniBar value={n.metrics?.diskPercent ?? 0} crit={90} warn={80} /></td>
              <td className="py-3 px-3 text-gray-400">
                {n.metrics
                  ? `${((n.metrics.networkRxBytesPerSec ?? 0) / 1048576).toFixed(1)} / ${((n.metrics.networkTxBytesPerSec ?? 0) / 1048576).toFixed(1)} MB/s`
                  : '—'}
              </td>
              <td className="py-3 px-3 text-gray-400">{n.clusterName}</td>
              <td className="py-3 px-3">
                <button onClick={() => navigate(`/cluster/${n.clusterId}`)}
                  className="text-xs text-blue-400 hover:text-blue-300">상세 →</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 클러스터별 아코디언 뷰 ────────────────────────────────────
function GroupedView({ clusters, loading, navigate }) {
  const [expanded,  setExpanded]  = useState({})
  const [showTopo,  setShowTopo]  = useState({})

  useEffect(() => {
    if (clusters.length > 0 && Object.keys(expanded).length === 0) {
      setExpanded({ [clusters[0].clusterId]: true })
      setShowTopo({ [clusters[0].clusterId]: true })
    }
  }, [clusters])

  const toggle     = id => setExpanded(e => ({ ...e, [id]: !e[id] }))
  const toggleTopo = (e, id) => { e.stopPropagation(); setShowTopo(t => ({ ...t, [id]: !t[id] })) }

  if (loading && clusters.length === 0) {
    return <div className="text-center py-16 text-gray-500">로딩 중...</div>
  }

  return (
    <div className="space-y-4">
      {clusters.map(c => {
        const hasIssue  = c.nodes?.some(n => n.state !== 'RUNNING')
        const isOpen    = !!expanded[c.clusterId]
        const topoOpen  = !!showTopo[c.clusterId]

        return (
          <div key={c.clusterId} className="card-bg rounded-xl overflow-hidden">
            {/* 아코디언 헤더 */}
            <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5"
              onClick={() => toggle(c.clusterId)}>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${hasIssue ? 'bg-red-400' : 'bg-green-400'}`} />
                <span className="font-bold text-white text-sm">{c.clusterName}</span>
                <span className="text-xs text-gray-500">
                  {c.nodes?.length ?? 0}개 노드 · VIP {c.vip || '—'}
                  {hasIssue && <span className="text-red-400 ml-2">⚠ 장애 있음</span>}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* 노드 상태 요약 */}
                <div className="flex gap-2 text-[10px]">
                  <span className="text-green-400">{c.nodes?.filter(n => n.state === 'RUNNING').length ?? 0} 운영</span>
                  {hasIssue && <span className="text-red-400">{c.nodes?.filter(n => n.state !== 'RUNNING').length} 장애</span>}
                </div>
                {/* 토폴로지 토글 버튼 */}
                {isOpen && (
                  <button
                    onClick={e => toggleTopo(e, c.clusterId)}
                    className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border transition-all ${
                      topoOpen
                        ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}>
                    <Network className="w-3 h-3" />
                    토폴로지
                  </button>
                )}
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {/* 노드 테이블 */}
            {isOpen && (
              <div className="border-t border-gray-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 uppercase border-b border-gray-800/60">
                      {['호스트', 'IP', '역할', '상태', 'CPU', '메모리', '디스크', 'NET RX/TX', ''].map(h => (
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
                            n.role === 'PRIMARY' ? 'bg-blue-500/20 text-blue-400'
                            : n.role === 'FAULT' ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-500/20 text-gray-400'}`}>
                            {n.role}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={n.state === 'RUNNING' ? 'text-green-400' : 'text-red-400'}>{n.state}</span>
                        </td>
                        <td className="py-3 px-4 w-32"><GaugeBar value={n.metrics?.cpuPercent ?? 0} /></td>
                        <td className="py-3 px-4 w-32"><GaugeBar value={n.metrics?.memoryPercent ?? 0} crit={95} warn={85} /></td>
                        <td className="py-3 px-4 w-32"><GaugeBar value={n.metrics?.diskPercent ?? 0} crit={90} warn={80} /></td>
                        <td className="py-3 px-4 text-gray-400">
                          {n.metrics
                            ? `${((n.metrics.networkRxBytesPerSec ?? 0) / 1048576).toFixed(1)} / ${((n.metrics.networkTxBytesPerSec ?? 0) / 1048576).toFixed(1)} MB/s`
                            : '—'}
                        </td>
                        <td className="py-3 px-4">
                          <button onClick={() => navigate(`/cluster/${c.clusterId}`)}
                            className="text-xs text-blue-400 hover:text-blue-300">상세 →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* 토폴로지 영역 */}
                {topoOpen && c.nodes?.length > 0 && (
                  <div className="p-4 border-t border-gray-800/60">
                    <ClusterTopology nodes={c.nodes} vip={c.vip} />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 메인 ──────────────────────────────────────────────────────
export default function ServerList() {
  const [allNodes,  setAllNodes]  = useState([])
  const [clusters,  setClusters]  = useState([])
  const [filter,    setFilter]    = useState('')
  const [clsFilter, setClsFilter] = useState('all')
  const [view,      setView]      = useState('grouped')
  const [loading,   setLoading]   = useState(true)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    try {
      const listRes  = await getClusters()
      const statuses = await Promise.all(
        listRes.data.map(c =>
          getClusterStatus(c.id)
            .then(r => ({ ...r.data, clusterId: c.id, clusterName: c.name }))
            .catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] }))
        )
      )
      setClusters(statuses)
      const flat = []
      statuses.forEach(c => c.nodes?.forEach(n => flat.push({ ...n, clusterName: c.clusterName, clusterId: c.clusterId, vip: c.vip })))
      setAllNodes(flat)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv) }, [])

  const clusterNames = [...new Set(allNodes.map(n => n.clusterName))]
  const filtered     = allNodes.filter(n =>
    (clsFilter === 'all' || n.clusterName === clsFilter) &&
    (n.hostname?.toLowerCase().includes(filter.toLowerCase()) || n.ipAddress?.includes(filter))
  )
  const filteredClusters = clsFilter === 'all' ? clusters : clusters.filter(c => c.clusterName === clsFilter)

  const running  = allNodes.filter(n => n.state === 'RUNNING').length
  const problems = allNodes.length - running

  return (
    <div className="p-8 pt-0 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">서버 현황</h2>
          <p className="text-xs text-gray-500 mt-1">전체 노드 목록 및 리소스 모니터링 · 5초 갱신</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 서버', value: allNodes.length,  color: 'text-white'     },
          { label: '운영 중',   value: running,           color: 'text-green-400' },
          { label: '중지/장애', value: problems,          color: problems > 0 ? 'text-red-400' : 'text-gray-500' },
          { label: '클러스터', value: clusters.length,   color: 'text-blue-400'  },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 필터 + 뷰 토글 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="호스트명 / IP 검색..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
        </div>
        <select value={clsFilter} onChange={e => setClsFilter(e.target.value)}
          className="text-xs bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 outline-none">
          <option value="all">전체 클러스터</option>
          {clusterNames.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex border border-gray-700 rounded-lg overflow-hidden ml-auto">
          <button onClick={() => setView('grouped')}
            className={`px-3 py-2 flex items-center gap-1.5 text-xs transition-colors ${
              view === 'grouped' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
            <LayoutGrid className="w-3.5 h-3.5" /> 클러스터별
          </button>
          <button onClick={() => setView('table')}
            className={`px-3 py-2 flex items-center gap-1.5 text-xs border-l border-gray-700 transition-colors ${
              view === 'table' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
            <List className="w-3.5 h-3.5" /> 전체 목록
          </button>
        </div>
      </div>

      {view === 'table'
        ? <TableView nodes={filtered} loading={loading} navigate={navigate} />
        : <GroupedView clusters={filteredClusters} loading={loading} navigate={navigate} />
      }
    </div>
  )
}
