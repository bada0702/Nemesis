import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getClusterStatus, getClusterGpfs, getClusterNetwork } from '../api/client'

const POLL_MS = 3000

// ── 상수 ──────────────────────────────────────────────────────
function statusGlow(role, state) {
  if (state === 'STOPPED' || role === 'FAULT') return 'red'
  if (role === 'RECOVERING')                   return 'amber'
  if (role === 'PRIMARY')                      return 'sky'
  return 'emerald'
}

const GLOW = {
  sky:    { border: 'border-sky-500/60',     glow: 'shadow-[0_0_24px_rgba(14,165,233,0.35)]',  dot: 'bg-sky-400',     text: 'text-sky-400',     badge: 'bg-sky-500/10 text-sky-400 border-sky-500/30'         },
  emerald:{ border: 'border-emerald-500/60', glow: 'shadow-[0_0_24px_rgba(16,185,129,0.35)]',  dot: 'bg-emerald-400', text: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  amber:  { border: 'border-amber-500/60',   glow: 'shadow-[0_0_24px_rgba(245,158,11,0.35)]',  dot: 'bg-amber-400',   text: 'text-amber-400',   badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30'    },
  red:    { border: 'border-red-500/60',     glow: 'shadow-[0_0_24px_rgba(239,68,68,0.35)]',   dot: 'bg-red-400',     text: 'text-red-400',     badge: 'bg-red-500/10 text-red-400 border-red-500/30'          },
}

const ROLE_LABEL = { PRIMARY: 'PRIMARY', STANDBY: 'STANDBY', FAULT: 'FAULT', RECOVERING: 'RECOVERY' }

const GPFS_CFG = {
  active:      { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  arbitrating: { color: 'text-amber-400',   bg: 'bg-amber-500/10  border-amber-500/30',   dot: 'bg-amber-400'   },
  unmounted:   { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30',  dot: 'bg-orange-400'  },
  down:        { color: 'text-red-400',     bg: 'bg-red-500/10    border-red-500/30',     dot: 'bg-red-400'     },
}

const NET_COLOR = { ok: '#34d399', slow: '#fbbf24', unreachable: '#ef4444' }

// ── 상세 패널 ─────────────────────────────────────────────────
function DetailPanel({ node, gpfsState, netRows, onClose }) {
  if (!node) return null
  const m = node.metrics
  const g = GLOW[statusGlow(node.role, node.state)]
  const gf = gpfsState ? GPFS_CFG[gpfsState] : null

  function Bar({ label, value, color }) {
    const pct = Math.min(value ?? 0, 100)
    const c = pct > 85 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : color
    return (
      <div className="mb-3">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-slate-500 uppercase tracking-widest">{label}</span>
          <span className="font-mono font-bold text-slate-300">{pct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${c} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  return (
    <div className="absolute top-0 right-0 w-72 h-full bg-slate-900/95 border-l border-slate-700 backdrop-blur-sm z-10 flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${g.dot} animate-pulse`} />
          <span className="text-sm font-black text-on-surface font-display">{node.hostname}</span>
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <div>
          <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">Node Info</p>
          <div className="space-y-1.5">
            {[
              ['Role',  node.role,             'lan'],
              ['State', node.state ?? 'UNKNOWN','power_settings_new'],
              ['IP',    node.ipAddress ?? '—',  'router'],
              ['OS',    node.osType ?? '—',     'computer'],
            ].map(([k, v, icon]) => (
              <div key={k} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-500">
                  <span className="material-symbols-outlined text-[13px]">{icon}</span>
                  {k}
                </div>
                <span className={`font-mono font-bold ${g.text}`}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* GPFS 상태 */}
        {gf && (
          <div>
            <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">GPFS (Spectrum Scale)</p>
            <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${gf.bg}`}>
              <span className={`w-2 h-2 rounded-full ${gf.dot} ${gpfsState === 'active' ? 'animate-pulse' : ''}`} />
              <span className={`text-[11px] font-bold font-mono ${gf.color}`}>{gpfsState.toUpperCase()}</span>
              <span className="text-[9px] text-slate-600 ml-auto">mmgetstate</span>
            </div>
          </div>
        )}

        {m ? (
          <div>
            <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-3">Resource Usage</p>
            <Bar label="CPU"    value={m.cpuPercent}    color="bg-sky-500"     />
            <Bar label="Memory" value={m.memoryPercent} color="bg-indigo-500"  />
            <Bar label="Disk"   value={m.diskPercent}   color="bg-emerald-500" />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-slate-600 py-2">
            <span className="material-symbols-outlined text-[14px]">signal_disconnected</span>
            메트릭 수신 없음
          </div>
        )}

        {/* 네트워크 연결 현황 */}
        {netRows && netRows.length > 0 && (
          <div>
            <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">Network to Peers</p>
            <div className="space-y-1.5">
              {netRows.map(r => (
                <div key={r.to} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-mono truncate">{r.toHost}</span>
                  <span className={`font-mono font-bold ${r.status === 'ok' ? 'text-emerald-400' : r.status === 'slow' ? 'text-amber-400' : 'text-red-400'}`}>
                    {r.status === 'unreachable' ? 'UNREACHABLE' : `${r.latencyMs} ms`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">Network Interfaces</p>
          <div className="space-y-1.5">
            {['eth0 (Public)', 'eth1 (Heartbeat)', 'eth2 (Storage)'].map(iface => (
              <div key={iface} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-mono">{iface}</span>
                <span className={`font-mono font-bold ${node.state === 'RUNNING' ? 'text-emerald-400' : 'text-slate-700'}`}>
                  {node.state === 'RUNNING' ? 'UP' : 'DOWN'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">Mount Points</p>
          <div className="space-y-1.5">
            {['/data', '/log', '/backup'].map(mp => (
              <div key={mp} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-mono">{mp}</span>
                <span className={`font-mono text-[10px] ${node.state === 'RUNNING' ? 'text-sky-400' : 'text-slate-700'}`}>
                  {node.state === 'RUNNING' ? 'mounted' : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SVG 연결선 ────────────────────────────────────────────────
function ConnLine({ x1, y1, x2, y2, color = '#38bdf8', animated = false, label = '', latency = null }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const latColor = latency === null ? '#64748b' : latency > 1.0 ? '#fbbf24' : '#34d399'

  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth="1.5" strokeDasharray={animated ? '6 4' : 'none'} opacity="0.6">
        {animated && (
          <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1s" repeatCount="indefinite" />
        )}
      </line>
      {/* 라벨 */}
      {label && !latency && (
        <text x={mx + 5} y={my} fill="#64748b" fontSize="9" fontFamily="monospace">{label}</text>
      )}
      {/* latency 배지 */}
      {latency !== null && (
        <g>
          <rect x={mx - 18} y={my - 9} width={36} height={13} rx={3}
            fill="rgba(15,20,24,0.9)" stroke={latColor} strokeWidth="0.8" />
          <text x={mx} y={my + 1} textAnchor="middle" fill={latColor} fontSize="8" fontFamily="monospace" fontWeight="bold">
            {latency}ms
          </text>
        </g>
      )}
      {latency === null && label === 'unreachable' && (
        <text x={mx + 5} y={my} fill="#ef4444" fontSize="8" fontFamily="monospace">✕</text>
      )}
    </g>
  )
}

// ── 노드 박스 ─────────────────────────────────────────────────
function NodeBox({ x, y, w, h, node, gpfsState, selected, onClick }) {
  const g    = GLOW[statusGlow(node.role, node.state)]
  const isUp = node.state === 'RUNNING'
  const gf   = gpfsState ? GPFS_CFG[gpfsState] : null

  return (
    <foreignObject x={x} y={y} width={w} height={h}>
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        onClick={onClick}
        className={`w-full h-full flex flex-col cursor-pointer rounded-xl border-2 ${g.border} ${g.glow} transition-all duration-300 bg-surface-container
          ${selected ? 'ring-2 ring-white/20' : 'hover:brightness-110'}`}
        style={{ padding: '12px 14px' }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-slate-400">dns</span>
            <span className="text-[11px] font-black text-on-surface font-display truncate">{node.hostname}</span>
          </div>
          <div className={`text-[8px] font-bold border rounded px-1.5 py-0.5 ${g.badge}`}>
            {ROLE_LABEL[node.role] ?? node.role}
          </div>
        </div>

        <div className="text-[9px] font-mono text-slate-500 mb-1.5">{node.ipAddress ?? node.nodeId}</div>

        {/* GPFS 상태 배지 */}
        {gf ? (
          <div className={`flex items-center gap-1 text-[8px] font-bold border rounded px-1.5 py-0.5 mb-1.5 w-fit ${gf.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${gf.dot} ${gpfsState === 'active' ? 'animate-pulse' : ''}`} />
            <span className={gf.color}>GPFS: {gpfsState}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[8px] text-slate-700 mb-1.5">
            <span className="material-symbols-outlined text-[10px]">database</span>
            GPFS: —
          </div>
        )}

        {node.metrics && (
          <div className="space-y-1 mt-auto">
            {[['CPU', node.metrics.cpuPercent, 'bg-sky-500'], ['MEM', node.metrics.memoryPercent, 'bg-indigo-500']].map(([l, v, c]) => (
              <div key={l} className="flex items-center gap-1.5">
                <span className="text-[8px] text-slate-600 w-6">{l}</span>
                <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full ${c} rounded-full`} style={{ width: `${Math.min(v, 100)}%` }} />
                </div>
                <span className="text-[8px] font-mono text-slate-500 w-7 text-right">{v?.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}
        {!isUp && (
          <div className="flex items-center gap-1 mt-auto text-[9px] text-red-400">
            <span className="material-symbols-outlined text-[11px]">power_off</span>
            STOPPED
          </div>
        )}
      </div>
    </foreignObject>
  )
}

// ── 진단 터미널 패널 ──────────────────────────────────────────
function DiagPanel({ diag, onClose }) {
  const [tab, setTab] = useState('gpfs')
  const termRef = useRef(null)

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [diag, tab])

  const output = tab === 'gpfs' ? diag.gpfs?.output : diag.network?.output

  // 출력 라인별 색상 적용
  function colorize(line) {
    if (line.startsWith('[nemesis-ctl'))    return 'text-sky-400 font-bold'
    if (/active/.test(line))               return 'text-emerald-400'
    if (/down|timeout|loss/.test(line))    return 'text-red-400'
    if (/unmounted|arbitrating/.test(line))return 'text-amber-400'
    if (/packet loss/.test(line) && !/0%/.test(line)) return 'text-red-300'
    if (/0% packet loss/.test(line))       return 'text-emerald-300'
    if (/round-trip/.test(line))           return 'text-slate-400'
    if (/PING|---/.test(line))             return 'text-slate-500'
    if (/Node number/.test(line))          return 'text-slate-300 font-bold'
    return 'text-slate-400'
  }

  return (
    <div className="bg-surface-container border border-surface-variant rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-black/30">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[16px] text-slate-500">terminal</span>
          <div className="flex gap-1">
            {[
              { id: 'gpfs',    icon: 'database',  label: 'GPFS — mmgetstate -a'  },
              { id: 'network', icon: 'lan',       label: 'Network — ping'         },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all
                  ${tab === t.id ? 'bg-slate-700 text-slate-200' : 'text-slate-600 hover:text-slate-400'}`}
              >
                <span className="material-symbols-outlined text-[13px]">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-600 font-mono">{diag.lastCheck}</span>
          <button onClick={onClose} className="text-slate-700 hover:text-slate-400 transition-colors">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      <div ref={termRef} className="bg-black/60 p-4 h-56 overflow-y-auto font-mono text-[11px] leading-5">
        {diag.loading ? (
          <div className="flex items-center gap-2 text-sky-400">
            <span className="w-3 h-3 border border-t-sky-400 rounded-full animate-spin" />
            명령어 실행 중...
          </div>
        ) : output ? (
          output.split('\n').map((line, i) => (
            <div key={i} className={colorize(line)}>{line || ' '}</div>
          ))
        ) : (
          <span className="text-slate-700">출력 없음</span>
        )}
        {!diag.loading && <span className="text-slate-600 animate-pulse">█</span>}
      </div>

      {/* 네트워크 매트릭스 표 (network 탭) */}
      {tab === 'network' && diag.network?.results && (
        <div className="border-t border-slate-800 px-5 py-3">
          <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">Connectivity Matrix (from Management)</p>
          <div className="flex flex-wrap gap-2">
            {diag.network.results
              .filter(r => r.from === 'mgmt')
              .map(r => (
                <div key={r.to}
                  className={`flex items-center gap-2 text-[10px] border rounded-lg px-3 py-1.5 font-mono
                    ${r.status === 'ok'          ? 'border-emerald-500/30 bg-emerald-500/5' :
                      r.status === 'slow'        ? 'border-amber-500/30  bg-amber-500/5'  :
                                                   'border-red-500/30    bg-red-500/5'    }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full
                    ${r.status === 'ok' ? 'bg-emerald-400' : r.status === 'slow' ? 'bg-amber-400' : 'bg-red-400'}`} />
                  <span className="text-slate-400">{r.toHost}</span>
                  <span className={`font-bold
                    ${r.status === 'ok' ? 'text-emerald-400' : r.status === 'slow' ? 'text-amber-400' : 'text-red-400'}`}>
                    {r.status === 'unreachable' ? 'UNREACHABLE' : `${r.latencyMs}ms`}
                  </span>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function Topology() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [status,   setStatus]   = useState(null)
  const [selected, setSelected] = useState(null)
  const [simMode,  setSimMode]  = useState(false)
  const [simNode,  setSimNode]  = useState(null)
  const [diag,     setDiag]     = useState({ gpfs: null, network: null, loading: false, lastCheck: null, open: false })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await getClusterStatus(id)
        if (!cancelled) setStatus(res.data)
      } catch {}
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [id])

  async function runDiag() {
    setDiag(d => ({ ...d, loading: true, open: true }))
    try {
      const [gpfsRes, netRes] = await Promise.all([
        getClusterGpfs(id),
        getClusterNetwork(id),
      ])
      setDiag({
        gpfs:      gpfsRes.data,
        network:   netRes.data,
        loading:   false,
        lastCheck: new Date().toLocaleTimeString('ko-KR'),
        open:      true,
      })
    } catch {
      setDiag(d => ({ ...d, loading: false }))
    }
  }

  const displayStatus = simMode && simNode && status
    ? {
        ...status,
        nodes: status.nodes.map(n =>
          n.nodeId === simNode
            ? { ...n, role: 'FAULT', state: 'STOPPED', metrics: null }
            : n.role === 'STANDBY' ? { ...n, role: 'PRIMARY' } : n
        )
      }
    : status

  if (!status) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <div className="w-5 h-5 border-2 border-t-sky-500 rounded-full animate-spin" />
          <span className="text-sm">토폴로지 로딩 중...</span>
        </div>
      </div>
    )
  }

  const primary      = displayStatus.nodes.find(n => n.role === 'PRIMARY')
  const standbys     = displayStatus.nodes.filter(n => n.role !== 'PRIMARY')
  const allNodes     = [primary, ...standbys].filter(Boolean)

  // 진단 데이터 인덱스
  const gpfsMap = {}
  diag.gpfs?.nodes?.forEach(n => { gpfsMap[n.nodeId] = n.gpfsState })

  function getLatency(fromId, toId) {
    if (!diag.network?.results) return null
    const r = diag.network.results.find(x => x.from === fromId && x.to === toId)
    return r ? (r.status === 'unreachable' ? null : r.latencyMs) : null
  }

  // SVG 레이아웃
  const SVG_W  = 700
  const SVG_H  = 300
  const BOX_W  = 170
  const BOX_H  = 120
  const MGMT_Y = 10
  const MGMT_X = (SVG_W - BOX_W) / 2
  const NODE_Y = 150

  const nodeCount   = allNodes.length
  const nodeSpacing = Math.min((SVG_W - 30) / nodeCount, 190)
  const totalW      = nodeSpacing * (nodeCount - 1) + BOX_W
  const startX      = (SVG_W - totalW) / 2
  const nodePositions = allNodes.map((n, i) => ({ node: n, x: startX + i * nodeSpacing }))

  const mgmtNode = {
    nodeId: 'mgmt', hostname: 'Management Server', role: 'MANAGEMENT',
    state: 'RUNNING', osType: 'Linux', ipAddress: '10.0.0.254',
    metrics: { cpuPercent: 8, memoryPercent: 22, diskPercent: 35 },
  }

  const selectedNode = selected?.nodeId === 'mgmt'
    ? mgmtNode
    : displayStatus.nodes.find(n => n.nodeId === selected?.nodeId)

  const selectedNetRows = selected && diag.network?.results
    ? diag.network.results.filter(r => r.from === selected.nodeId)
    : []

  return (
    <>
      {/* 브레드크럼 */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(`/cluster/${id}`)}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-xs font-bold">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          클러스터 상세
        </button>
        <span className="text-slate-700">/</span>
        <span className="text-xs text-slate-400 font-mono">{status.clusterName}</span>
        <span className="text-slate-700">/</span>
        <span className="text-xs text-sky-400 font-bold">Topology</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-on-surface font-display tracking-tight italic uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-sky-400 text-[24px]">account_tree</span>
            HA Cluster Topology
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono ml-9">
            {status.clusterName} — VIP: {status.vip}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* 진단 실행 버튼 */}
          <button
            onClick={runDiag}
            disabled={diag.loading}
            className="flex items-center gap-2 bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-300 rounded-lg px-4 py-2 text-xs font-bold transition-all disabled:opacity-50"
          >
            {diag.loading ? (
              <span className="w-4 h-4 border border-t-indigo-300 rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-[16px]">terminal</span>
            )}
            진단 실행
            {diag.lastCheck && <span className="text-indigo-500 font-mono text-[9px]">{diag.lastCheck}</span>}
          </button>

          {/* Failover 시뮬레이션 */}
          <div className={`flex items-center gap-2 rounded-lg border px-4 py-2 transition-all ${simMode ? 'bg-amber-500/10 border-amber-500/40' : 'bg-surface-container border-surface-variant'}`}>
            <span className={`material-symbols-outlined text-[16px] ${simMode ? 'text-amber-400' : 'text-slate-600'}`}>science</span>
            <span className="text-[10px] font-bold text-slate-400">FAILOVER SIM</span>
            <button
              onClick={() => { setSimMode(v => !v); setSimNode(null) }}
              className={`w-10 h-5 rounded-full transition-all relative ${simMode ? 'bg-amber-500' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${simMode ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>

          {simMode && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <span className="text-[10px] text-amber-400 font-bold">장애 노드:</span>
              {allNodes.filter(n => n.state === 'RUNNING').map(n => (
                <button key={n.nodeId}
                  onClick={() => setSimNode(v => v === n.nodeId ? null : n.nodeId)}
                  className={`text-[10px] font-mono px-2 py-1 rounded border transition-all
                    ${simNode === n.nodeId ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'border-slate-700 text-slate-400 hover:border-amber-500/50'}`}
                >
                  {n.hostname}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 토폴로지 캔버스 */}
      <div className={`bg-surface-container border rounded-2xl overflow-hidden relative transition-all ${simMode ? 'border-amber-500/30' : 'border-surface-variant'}`}>
        {simMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-amber-500/20 border border-amber-500/40 rounded-full px-4 py-1 flex items-center gap-2 text-[10px] text-amber-400 font-bold">
            <span className="material-symbols-outlined text-[12px] animate-pulse">warning</span>
            SIMULATION MODE — 실제 장애가 발생하지 않습니다
          </div>
        )}

        <div className="flex" style={{ minHeight: 320 }}>
          <div className="flex-1 p-4">
            <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="overflow-visible" style={{ height: 280 }}>

              {/* Management → Nodes 제어선 */}
              {nodePositions.map(({ node, x }) => (
                <ConnLine key={`ctrl-${node.nodeId}`}
                  x1={MGMT_X + BOX_W / 2} y1={MGMT_Y + BOX_H}
                  x2={x + BOX_W / 2}      y2={NODE_Y}
                  color="#38bdf8"
                  animated={node.state === 'RUNNING'}
                  label="ctrl"
                  latency={getLatency('mgmt', node.nodeId)}
                />
              ))}

              {/* Heartbeat: Primary ↔ 나머지 노드 */}
              {nodePositions.slice(1).map(({ node, x }, i) => {
                const prevX  = nodePositions[i].x
                const isUp   = node.state === 'RUNNING'
                const lat    = getLatency(nodePositions[0].node.nodeId, node.nodeId)
                return (
                  <ConnLine key={`hb-${node.nodeId}`}
                    x1={nodePositions[i].x + BOX_W} y1={NODE_Y + BOX_H / 2}
                    x2={x}                          y2={NODE_Y + BOX_H / 2}
                    color={isUp ? '#34d399' : '#ef4444'}
                    animated={isUp}
                    label={isUp ? 'heartbeat' : 'DOWN'}
                    latency={lat}
                  />
                )
              })}


              {/* VIP 배지 */}
              {nodePositions[0] && (
                <g>
                  <rect x={nodePositions[0].x + BOX_W / 2 - 42} y={NODE_Y - 30} width={84} height={22}
                    rx={4} fill="rgba(14,165,233,0.12)" stroke="rgba(14,165,233,0.4)" strokeWidth="1" />
                  <text x={nodePositions[0].x + BOX_W / 2} y={NODE_Y - 14} textAnchor="middle"
                    fill="#38bdf8" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    VIP {status.vip}
                  </text>
                </g>
              )}

              {/* Management Server */}
              <foreignObject x={MGMT_X} y={MGMT_Y} width={BOX_W} height={BOX_H}>
                <div xmlns="http://www.w3.org/1999/xhtml"
                  onClick={() => setSelected(v => v?.nodeId === 'mgmt' ? null : mgmtNode)}
                  className={`w-full h-full flex flex-col cursor-pointer rounded-xl border-2 border-sky-500/60 shadow-[0_0_24px_rgba(14,165,233,0.35)] transition-all bg-surface-container hover:brightness-110 ${selected?.nodeId === 'mgmt' ? 'ring-2 ring-white/20' : ''}`}
                  style={{ padding: '10px 12px' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-[14px] text-sky-400">computer</span>
                    <span className="text-[9px] font-black text-on-surface font-display">Management Server</span>
                  </div>
                  <div className="text-[8px] font-mono text-slate-500 mb-1">{mgmtNode.ipAddress}</div>
                  <div className="text-[8px] text-slate-700 mb-1">Nemesis Control Plane</div>
                  <div className="flex items-center gap-1 mt-auto">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    <span className="text-[8px] text-sky-400 font-bold">ACTIVE</span>
                    {diag.gpfs && (
                      <span className="ml-auto text-[8px] text-emerald-400 font-mono border border-emerald-500/20 rounded px-1">GPFS ✓</span>
                    )}
                  </div>
                </div>
              </foreignObject>

              {/* Cluster Nodes */}
              {nodePositions.map(({ node, x }) => (
                <NodeBox key={node.nodeId}
                  x={x} y={NODE_Y} w={BOX_W} h={BOX_H}
                  node={node}
                  gpfsState={gpfsMap[node.nodeId] ?? null}
                  selected={selected?.nodeId === node.nodeId}
                  onClick={() => setSelected(v => v?.nodeId === node.nodeId ? null : node)}
                />
              ))}


            </svg>
          </div>

          {/* 상세 패널 */}
          {selected && (
            <div className="relative w-72 border-l border-slate-800">
              <DetailPanel
                node={selectedNode}
                gpfsState={gpfsMap[selected?.nodeId] ?? null}
                netRows={selectedNetRows}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* 진단 터미널 패널 */}
      {diag.open && (
        <DiagPanel diag={diag} onClose={() => setDiag(d => ({ ...d, open: false }))} />
      )}

      {/* 범례 */}
      <div className="flex items-center gap-5 text-[10px] text-slate-600 font-mono flex-wrap">
        {[
          { color: '#38bdf8', label: 'Control (Mgmt → Node)' },
          { color: '#34d399', label: 'Heartbeat (OK)' },
          { color: '#ef4444', label: 'Heartbeat (Down)' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray="4 2" /></svg>
            {l.label}
          </div>
        ))}
        <div className="ml-auto text-slate-700">
          클릭: 노드 상세 · 진단 실행: GPFS + 네트워크 점검
        </div>
      </div>
    </>
  )
}
