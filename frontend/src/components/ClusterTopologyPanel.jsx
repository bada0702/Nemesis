import React, { useEffect, useState } from 'react'
import { getClusterStatus, getClusterGpfs, getClusterNetwork, getClusterVipStatus, getHaHeartbeat } from '../api/client'

const POLL_MS = 3000

function statusGlow(role, state) {
  if (state === 'STOPPED' || role === 'FAULT') return 'red'
  if (role === 'RECOVERING')                   return 'amber'
  if (role === 'PRIMARY')                      return 'sky'
  return 'emerald'
}

const GLOW = {
  sky:    { border: 'border-sky-500/60',     glow: 'shadow-[0_0_20px_rgba(14,165,233,0.3)]',  dot: 'bg-sky-400',     text: 'text-sky-400',     badge: 'bg-sky-500/10 text-sky-400 border-sky-500/30'         },
  emerald:{ border: 'border-emerald-500/60', glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]',  dot: 'bg-emerald-400', text: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  amber:  { border: 'border-amber-500/60',   glow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]',  dot: 'bg-amber-400',   text: 'text-amber-400',   badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30'    },
  red:    { border: 'border-red-500/60',     glow: 'shadow-[0_0_20px_rgba(239,68,68,0.3)]',   dot: 'bg-red-400',     text: 'text-red-400',     badge: 'bg-red-500/10 text-red-400 border-red-500/30'          },
}

const GPFS_CFG = {
  active:      { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  arbitrating: { color: 'text-amber-400',   bg: 'bg-amber-500/10  border-amber-500/30',   dot: 'bg-amber-400'   },
  unmounted:   { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30',  dot: 'bg-orange-400'  },
  down:        { color: 'text-red-400',     bg: 'bg-red-500/10    border-red-500/30',     dot: 'bg-red-400'     },
}

const ROLE_LABEL = { PRIMARY: 'PRIMARY', STANDBY: 'STANDBY', FAULT: 'FAULT', RECOVERING: 'RECOVERY' }

const OS_ICON = { LINUX: 'terminal', AIX: 'settings_applications', UNKNOWN: 'device_unknown' }

/* 링크 상태(ALIVE/SLOW/DEAD) → 선 시각 속성. real/hb 공통. */
function linkVisual(status) {
  switch (status) {
    case 'ALIVE': return { color: '#34d399', animated: true,  dash: '7 4' }
    case 'SLOW':  return { color: '#fbbf24', animated: true,  dash: '7 4' }
    default:      return { color: '#ef4444', animated: false, dash: '4 4' } // DEAD/미상
  }
}

/* ---------- 연결선 ---------- */
function ConnLine({ x1, y1, x2, y2, linkKind = 'hb', status = null,
                   latency = null, label = null }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const vis = status ? linkVisual(status) : null

  // real(mgmt→node)=가는 선, hb(node↔node)=굵은 선
  const isReal  = linkKind === 'real'
  // 매트릭스 미수신(status=null) 폴백 = 회색 정적선
  const color   = vis ? vis.color : '#64748b'
  const width   = isReal ? 1.5 : 3
  const opacity = isReal ? 0.6 : 0.85
  const animated = vis ? vis.animated : false
  const dash     = vis ? vis.dash : 'none'
  const latColor = latency === null ? '#64748b' : latency > 500 ? '#fbbf24' : '#34d399'

  return (
    <g>
      {!isReal && (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="8" opacity="0.08" />
      )}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={width} strokeDasharray={dash} opacity={opacity}>
        {animated && (
          <animate attributeName="stroke-dashoffset" from="0" to="-22" dur="0.9s" repeatCount="indefinite" />
        )}
      </line>
      {label && (
        <text x={mx} y={my - 6} textAnchor="middle" fill={color} fontSize="8"
          fontFamily="monospace" fontWeight="bold">{label}</text>
      )}
      {latency !== null && (
        <g>
          <rect x={mx - 18} y={my + 1} width={36} height={14} rx={3}
            fill="rgba(10,15,20,0.92)" stroke={latColor} strokeWidth="0.8" />
          <text x={mx} y={my + 12} textAnchor="middle" fill={latColor}
            fontSize="8" fontFamily="monospace" fontWeight="bold">{latency}ms</text>
        </g>
      )}
    </g>
  )
}

/* ---------- VIP 배지 (노드 박스 아래쪽에 붙임 — z-order 문제 회피) ---------- */
function VipBadge({ cx, y }) {
  const w = 96
  return (
    <g>
      <rect x={cx - w / 2} y={y} width={w} height={20} rx={4}
        fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.6)" strokeWidth="1.2" />
      <circle cx={cx - w / 2 + 10} cy={y + 10} r={3} fill="#38bdf8">
        <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <text x={cx - w / 2 + 18} y={y + 14} fill="#38bdf8"
        fontSize="9" fontFamily="monospace" fontWeight="bold">VIP Active</text>
    </g>
  )
}

/* ---------- 노드 박스 ---------- */
function NodeBox({ x, y, w, h, node, gpfsState, hasVip, selected, onClick }) {
  const g  = GLOW[statusGlow(node.role, node.state)]
  const isUp = node.state === 'RUNNING'
  const gf = gpfsState ? GPFS_CFG[gpfsState] : null
  const procs = node.metrics?.processes ?? []
  const runningProcs = procs.filter(p => p.status === 'running')

  return (
    <foreignObject x={x} y={y} width={w} height={h}>
      <div xmlns="http://www.w3.org/1999/xhtml"
        onClick={onClick}
        className={`w-full h-full flex flex-col cursor-pointer rounded-xl border-2 ${g.border} ${g.glow} transition-all duration-300 bg-surface-container
          ${selected ? 'ring-2 ring-white/20' : 'hover:brightness-110'}`}
        style={{ padding: '10px 12px' }}
      >
        {/* 호스트명 + 역할 */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[13px] text-slate-400">dns</span>
            <span className="text-[10px] font-black text-on-surface font-display truncate">{node.hostname}</span>
          </div>
          <div className={`text-[7px] font-bold border rounded px-1 py-0.5 ${g.badge}`}>
            {ROLE_LABEL[node.role] ?? node.role}
          </div>
        </div>

        {/* OS + Real IP */}
        <div className="flex items-center gap-1 mb-1">
          <span className="material-symbols-outlined text-[9px] text-slate-600">
            {OS_ICON[node.osType] ?? 'device_unknown'}
          </span>
          <span className="text-[8px] text-slate-600 font-mono">{node.osType ?? '—'}</span>
        </div>
        <div className="mb-1.5 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono truncate">
            <span className="text-slate-600 w-5 shrink-0">real</span>
            <span className="text-slate-400">{node.ipAddress ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-mono truncate">
            <span className="text-slate-600 w-5 shrink-0">hb</span>
            <span className="text-slate-400">{node.heartbeatIp ?? '—'}</span>
          </div>
        </div>

        {/* GPFS 상태 */}
        {gf ? (
          <div className={`flex items-center gap-1 text-[7px] font-bold border rounded px-1.5 py-0.5 mb-1.5 w-fit ${gf.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${gf.dot} ${gpfsState === 'active' ? 'animate-pulse' : ''}`} />
            <span className={gf.color}>GPFS: {gpfsState}</span>
          </div>
        ) : null}

        {/* 구동 서비스 미리보기 */}
        {runningProcs.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1">
            {runningProcs.slice(0, 3).map(p => (
              <span key={p.name}
                className="text-[7px] font-mono bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 rounded px-1 py-0.5">
                {p.name}
              </span>
            ))}
            {runningProcs.length > 3 && (
              <span className="text-[7px] text-slate-600">+{runningProcs.length - 3}</span>
            )}
          </div>
        ) : (
          <div className="mt-auto">
            {!isUp && (
              <div className="flex items-center gap-1 text-[9px] text-red-400">
                <span className="material-symbols-outlined text-[11px]">power_off</span>
                STOPPED
              </div>
            )}
          </div>
        )}
      </div>
    </foreignObject>
  )
}

/* ---------- 서비스 목록 ---------- */
function ServiceList({ processes }) {
  if (!processes || processes.length === 0) {
    return (
      <div className="text-[10px] text-slate-600 italic py-3 text-center">감지된 서비스 없음</div>
    )
  }
  return (
    <div className="space-y-1.5">
      {processes.map(p => {
        const isRunning = p.status === 'running'
        return (
          <div key={p.name}
            className={`flex items-center justify-between rounded-lg px-3 py-2 border
              ${isRunning
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : 'bg-red-500/5 border-red-500/20'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[11px] font-mono text-slate-300">{p.name}</span>
              {p.pid && (
                <span className="text-[9px] font-mono text-slate-600">PID {p.pid}</span>
              )}
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-wide
              ${isRunning ? 'text-emerald-400' : 'text-red-400'}`}>
              {isRunning ? '운영중' : '중지'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 노드 상세 ---------- */
function NodeDetail({ node, gpfsState, netRows, onClose }) {
  if (!node) return null
  const m  = node.metrics
  const g  = GLOW[statusGlow(node.role, node.state)]
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
    <div className="bg-surface-container border border-surface-variant rounded-xl p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${g.dot} animate-pulse`} />
          <span className="text-sm font-black text-on-surface font-display">{node.hostname}</span>
          <span className={`text-[9px] font-bold border rounded px-1.5 py-0.5 ${g.badge}`}>
            {ROLE_LABEL[node.role] ?? node.role}
          </span>
          {node.ipAddress && (
            <span className="text-[10px] font-mono text-slate-500">{node.ipAddress}</span>
          )}
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {/* 메타 뱃지 */}
      <div className="flex flex-wrap gap-2">
        {[['OS', node.osType ?? '—'], ['State', node.state ?? '—']].map(([k, v]) => (
          <div key={k} className="bg-slate-900/50 rounded-lg px-3 py-1.5">
            <p className="text-[8px] text-slate-600 uppercase tracking-widest">{k}</p>
            <p className={`text-[11px] font-mono font-bold mt-0.5 ${g.text}`}>{v}</p>
          </div>
        ))}
        {gf && (
          <div className={`rounded-lg px-3 py-1.5 border ${gf.bg}`}>
            <p className="text-[8px] text-slate-600 uppercase tracking-widest">GPFS</p>
            <p className={`text-[11px] font-mono font-bold mt-0.5 ${gf.color}`}>{gpfsState.toUpperCase()}</p>
          </div>
        )}
      </div>

      {/* 2컬럼: 메트릭(좌) + 서비스(우) */}
      <div className="grid grid-cols-2 gap-4">
        {/* 왼쪽: CPU / Memory / Disk */}
        <div>
          <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">리소스 사용률</p>
          {m ? (
            <>
              <Bar label="CPU"    value={m.cpuPercent}    color="bg-sky-500"     />
              <Bar label="Memory" value={m.memoryPercent} color="bg-indigo-500"  />
              <Bar label="Disk"   value={m.diskPercent}   color="bg-emerald-500" />
            </>
          ) : (
            <div className="text-[10px] text-slate-600 italic py-3">메트릭 없음</div>
          )}
        </div>

        {/* 오른쪽: 서비스 목록 */}
        <div>
          <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">구동 서비스</p>
          <ServiceList processes={m?.processes ?? []} />
        </div>
      </div>

      {/* 네트워크 레이턴시 (진단 실행 시) */}
      {netRows && netRows.length > 0 && (
        <div>
          <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-2">Peer 네트워크</p>
          <div className="flex flex-wrap gap-2">
            {netRows.map(r => (
              <div key={r.to} className={`flex items-center gap-2 text-[10px] border rounded-lg px-3 py-1.5 font-mono
                ${r.status === 'ok'          ? 'border-emerald-500/30 bg-emerald-500/5'
                : r.status === 'slow'        ? 'border-amber-500/30  bg-amber-500/5'
                :                              'border-red-500/30    bg-red-500/5'}`}>
                <span className="text-slate-400">{r.toHost}</span>
                <span className={`font-bold ${r.status === 'ok' ? 'text-emerald-400' : r.status === 'slow' ? 'text-amber-400' : 'text-red-400'}`}>
                  {r.status === 'unreachable' ? 'UNREACHABLE' : `${r.latencyMs}ms`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ========== 메인 컴포넌트 ========== */
export default function ClusterTopologyPanel({ clusterId }) {
  const [status,    setStatus]    = useState(null)
  const [vipStatus, setVipStatus] = useState(null)
  const [selected,  setSelected]  = useState(null)
  const [diag,      setDiag]      = useState({ gpfs: null, network: null, loading: false, lastCheck: null })
  const [hbMatrix, setHbMatrix] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [statusRes, vipRes, hbRes] = await Promise.allSettled([
          getClusterStatus(clusterId),
          getClusterVipStatus(clusterId),
          getHaHeartbeat(clusterId),
        ])
        if (cancelled) return
        if (statusRes.status === 'fulfilled') setStatus(statusRes.value.data)
        if (vipRes.status   === 'fulfilled') setVipStatus(vipRes.value.data)
        if (hbRes.status    === 'fulfilled') setHbMatrix(hbRes.value.data)
      } catch {}
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [clusterId])

  async function runDiag() {
    setDiag(d => ({ ...d, loading: true }))
    try {
      const [gpfsRes, netRes] = await Promise.all([
        getClusterGpfs(clusterId),
        getClusterNetwork(clusterId),
      ])
      setDiag({ gpfs: gpfsRes.data, network: netRes.data, loading: false,
                lastCheck: new Date().toLocaleTimeString('ko-KR') })
    } catch {
      setDiag(d => ({ ...d, loading: false }))
    }
  }

  if (!status) return (
    <div className="flex items-center justify-center h-48 bg-surface-container border border-surface-variant rounded-xl">
      <div className="flex items-center gap-3 text-slate-500">
        <div className="w-4 h-4 border-2 border-t-sky-500 rounded-full animate-spin" />
        <span className="text-sm">토폴로지 로딩 중...</span>
      </div>
    </div>
  )

  const primary  = status.nodes.find(n => n.role === 'PRIMARY')
  const standbys = status.nodes.filter(n => n.role !== 'PRIMARY')
  const allNodes = [primary, ...standbys].filter(Boolean)

  const gpfsMap = {}
  diag.gpfs?.nodes?.forEach(n => { gpfsMap[n.nodeId] = n.gpfsState })

  const vipNodeId = vipStatus?.nodes?.find(n => n.vipPresent === true)?.nodeId ?? null

  // 관리서버→노드 real IP 링크 상태.
  function getServiceLink(nodeId) {
    const n = hbMatrix?.nodes?.find(x => x.nodeId === nodeId)
    return n?.serviceLink ?? null   // { status, latencyMs } | null
  }
  // 노드↔노드 hb 링크 상태.
  function getHbLink(fromId, toId) {
    const from = hbMatrix?.nodes?.find(x => x.nodeId === fromId)
    return from?.heartbeats?.find(h => h.toNodeId === toId) ?? null // { status, latencyMs } | null
  }

  const SVG_W = 700
  const BOX_W = 175
  const BOX_H = 145   // 조금 더 높게 (서비스 뱃지 포함)
  const MGMT_W = 160
  const MGMT_H = 90
  const MGMT_Y = 10
  const MGMT_X = (SVG_W - MGMT_W) / 2
  const NODE_Y = MGMT_Y + MGMT_H + 60  // VIP 배지 공간
  const VIP_Y  = NODE_Y - 26           // VIP 배지 y 위치
  const SVG_H  = NODE_Y + BOX_H + 20

  const nodeSpacing   = Math.min((SVG_W - 30) / Math.max(allNodes.length, 1), 195)
  const totalW        = nodeSpacing * (Math.max(allNodes.length, 1) - 1) + BOX_W
  const startX        = (SVG_W - totalW) / 2
  const nodePositions = allNodes.map((n, i) => ({ node: n, x: startX + i * nodeSpacing }))

  const mgmtNode = {
    nodeId: 'mgmt', hostname: 'Management Server', role: 'MANAGEMENT',
    state: 'RUNNING', osType: 'Linux', ipAddress: '—', metrics: null,
  }

  const selectedNode = selected?.nodeId === 'mgmt'
    ? mgmtNode
    : status.nodes.find(n => n.nodeId === selected?.nodeId)

  const selectedNetRows = selected && diag.network?.results
    ? diag.network.results.filter(r => r.from === selected.nodeId)
    : []

  return (
    <div className="space-y-3">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.18em] font-display flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          HA Topology
        </h2>
        <div className="flex items-center gap-2">
          {vipStatus?.vip && (
            <div className={`flex items-center gap-1.5 text-[10px] font-mono border rounded-lg px-2.5 py-1
              ${vipNodeId
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                : 'bg-slate-800/60 border-slate-700 text-slate-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${vipNodeId ? 'bg-sky-400 animate-pulse' : 'bg-slate-600'}`} />
              VIP {vipStatus.vip}{vipNodeId ? ' ✓' : ' 없음'}
            </div>
          )}
          <button onClick={runDiag} disabled={diag.loading}
            className="flex items-center gap-1.5 text-[11px] font-bold bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-indigo-400 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50">
            {diag.loading
              ? <span className="w-3 h-3 border border-t-indigo-300 rounded-full animate-spin" />
              : <span className="material-symbols-outlined text-[13px]">terminal</span>}
            {diag.loading ? '점검 중...' : '진단 실행'}
            {diag.lastCheck && <span className="text-indigo-600 font-mono text-[9px]">{diag.lastCheck}</span>}
          </button>
        </div>
      </div>

      {/* SVG 캔버스 */}
      <div className="bg-surface-container border border-surface-variant rounded-xl overflow-hidden">
        <div className="p-4">
          <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="overflow-visible"
            style={{ height: SVG_H * 0.9 }}>

            {/* ── 1. real IP 링크 (관리서버 → 노드 serviceIp 제어포트) ── */}
            {nodePositions.map(({ node, x }) => {
              const sl = getServiceLink(node.nodeId)
              return (
                <ConnLine key={`real-${node.nodeId}`}
                  x1={MGMT_X + MGMT_W / 2} y1={MGMT_Y + MGMT_H}
                  x2={x + BOX_W / 2}        y2={NODE_Y}
                  linkKind="real"
                  status={sl ? sl.status : null}
                  label="real IP"
                  latency={sl ? sl.latencyMs : null}
                />
              )
            })}

            {/* ── 2. heartbeat IP 링크 (노드 ↔ 노드) ── */}
            {nodePositions.slice(1).map(({ node, x }, i) => {
              const fromNode = nodePositions[i].node
              const link = getHbLink(fromNode.nodeId, node.nodeId)
              return (
                <ConnLine key={`hb-${node.nodeId}`}
                  x1={nodePositions[i].x + BOX_W} y1={NODE_Y + BOX_H / 2}
                  x2={x}                          y2={NODE_Y + BOX_H / 2}
                  linkKind="hb"
                  status={link ? link.status : null}
                  label="hb IP"
                  latency={link ? link.latencyMs : null}
                />
              )
            })}

            {/* ── 3. Management Server ── */}
            <foreignObject x={MGMT_X} y={MGMT_Y} width={MGMT_W} height={MGMT_H}>
              <div xmlns="http://www.w3.org/1999/xhtml"
                onClick={() => setSelected(v => v?.nodeId === 'mgmt' ? null : mgmtNode)}
                className={`w-full h-full flex flex-col cursor-pointer rounded-xl border-2 border-sky-500/60
                  shadow-[0_0_20px_rgba(14,165,233,0.3)] transition-all bg-surface-container hover:brightness-110
                  ${selected?.nodeId === 'mgmt' ? 'ring-2 ring-white/20' : ''}`}
                style={{ padding: '10px 12px' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-[14px] text-sky-400">computer</span>
                  <span className="text-[9px] font-black text-on-surface font-display">Management</span>
                </div>
                <div className="text-[8px] text-slate-600 mb-1">Nemesis Control Plane</div>
                <div className="flex items-center gap-1 mt-auto">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  <span className="text-[8px] text-sky-400 font-bold">ACTIVE</span>
                </div>
              </div>
            </foreignObject>

            {/* ── 4. 클러스터 노드 박스 ── */}
            {nodePositions.map(({ node, x }) => (
              <NodeBox key={node.nodeId}
                x={x} y={NODE_Y} w={BOX_W} h={BOX_H}
                node={node}
                gpfsState={gpfsMap[node.nodeId] ?? null}
                hasVip={node.nodeId === vipNodeId}
                selected={selected?.nodeId === node.nodeId}
                onClick={() => setSelected(v => v?.nodeId === node.nodeId ? null : node)}
              />
            ))}

            {/* ── 5. VIP 배지 — 노드 박스보다 나중에 그려서 항상 위에 표시 ── */}
            {vipNodeId && vipStatus?.vip && nodePositions.map(({ node, x }) =>
              node.nodeId === vipNodeId
                ? <VipBadge key="vip" cx={x + BOX_W / 2} y={VIP_Y} />
                : null
            )}
          </svg>
        </div>

        {/* 범례 — 색=상태, 선 종류=링크 */}
        <div className="border-t border-slate-800/60 px-4 py-2.5 flex items-center gap-4 text-[11px] text-slate-500 font-mono flex-wrap">
          {/* 상태(색) */}
          {[
            { color: '#34d399', label: '정상' },
            { color: '#fbbf24', label: '느림' },
            { color: '#ef4444', label: '끊김' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
          <span className="text-slate-700">·</span>
          {/* 링크(선 굵기) */}
          {[
            { label: 'real IP (관리↔노드)', w: 1.5 },
            { label: 'hb IP (노드↔노드)',   w: 3   },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-2">
              <svg width="26" height="8">
                <line x1="0" y1="4" x2="26" y2="4" stroke="#94a3b8"
                  strokeWidth={l.w} strokeDasharray="5 3" />
              </svg>
              {l.label}
            </div>
          ))}
          <span className="ml-auto text-slate-600">클릭: 노드 상세</span>
        </div>
      </div>

      {/* 노드 상세 (선택 시) */}
      {selected && selectedNode && (
        <NodeDetail
          node={selectedNode}
          gpfsState={gpfsMap[selected?.nodeId] ?? null}
          netRows={selectedNetRows}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
