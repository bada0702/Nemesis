import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClusters, getClusterStatus } from '../../api/client'

const POLL_MS = 5000

// ── 상태 색상 ─────────────────────────────────────────────────
// 노드: PRIMARY=Active(sky), STANDBY 정상=emerald, FAULT/STOPPED=red, RECOVERING=amber
function nodeTone(role, state) {
  if (state === 'STOPPED' || role === 'FAULT') return 'red'
  if (role === 'RECOVERING')                   return 'amber'
  if (role === 'PRIMARY')                       return 'sky'
  return 'emerald'
}

const TONE = {
  sky:     { dot: 'bg-sky-400',     text: 'text-sky-400',     badge: 'bg-sky-500/10 text-sky-300 border-sky-500/30'     },
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  amber:   { dot: 'bg-amber-400',   text: 'text-amber-400',   badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30'  },
  red:     { dot: 'bg-red-400',     text: 'text-red-400',     badge: 'bg-red-500/10 text-red-300 border-red-500/30'     },
}

// PRIMARY → Active, 그 외 → 역할 그대로
const ROLE_LABEL = { PRIMARY: 'ACTIVE', STANDBY: 'STANDBY', FAULT: 'FAULT', RECOVERING: 'RECOVERY' }

// ── 서비스(보호 대상) 행 ──────────────────────────────────────
function ServiceRow({ app }) {
  const up = app.state === 'running'
  return (
    <div className="flex items-center gap-2 pl-[68px] pr-4 py-1.5 hover:bg-white/[0.03] group">
      <span className={`material-symbols-outlined text-[15px] ${up ? 'text-slate-400' : 'text-slate-700'}`}>
        {app.icon ?? 'deployed_code'}
      </span>
      <span className={`text-[12px] font-medium ${up ? 'text-slate-300' : 'text-slate-600'}`}>{app.name}</span>
      {app.port && <span className="text-[10px] font-mono text-slate-700">:{app.port}</span>}

      {/* HA 역할 태그 */}
      {app.haRole === 'ACTIVE' && (
        <span className="text-[8px] font-bold border border-sky-500/30 bg-sky-500/10 text-sky-300 rounded px-1.5 py-0.5">ACTIVE</span>
      )}

      {/* 상태 */}
      <div className="ml-auto flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${up ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className={`text-[10px] font-mono font-bold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
          {up ? 'running' : 'stopped'}
        </span>
      </div>
    </div>
  )
}

// ── 노드 행 + 자식(서비스 + 에이전트) ─────────────────────────
function NodeBranch({ node, clusterId, open, onToggle, onOpenNode }) {
  const t        = TONE[nodeTone(node.role, node.state)]
  // 서비스 목록: 백엔드 status 응답은 node.apps를 채우지 않고 에이전트가 보고한
  // 프로세스를 metrics.processes({name,pid,status})로 싣는다. 이를 서비스 행으로 매핑한다.
  const apps     = node.apps ?? (node.metrics?.processes ?? []).map((p, i) => ({
    id:    p.pid ?? `${node.nodeId}-${p.name ?? i}`,
    name:  p.name ?? 'unknown',
    state: p.status ?? 'running',
  }))
  const running  = apps.filter(a => a.state === 'running').length
  const agentUp  = node.lastSeenAt != null && (Date.now() - new Date(node.lastSeenAt).getTime()) < 30_000

  return (
    <div>
      {/* 노드 행 */}
      <div className="group flex items-center gap-2 pl-9 pr-4 py-2 hover:bg-white/[0.04] cursor-pointer"
        onClick={onToggle}>
        <span className={`material-symbols-outlined text-[16px] text-slate-600 transition-transform ${open ? 'rotate-90' : ''}`}>
          chevron_right
        </span>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.dot} ${node.state === 'RUNNING' ? 'animate-pulse' : ''}`} />
        <span className="material-symbols-outlined text-[15px] text-slate-500">dns</span>
        <span className="text-[12px] font-bold text-slate-100">{node.hostname}</span>

        <span className={`text-[8px] font-bold border rounded px-1.5 py-0.5 ${t.badge}`}>
          {ROLE_LABEL[node.role] ?? node.role}
        </span>
        <span className="text-[10px] font-mono text-slate-600">{node.ipAddress ?? '—'}</span>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-slate-600 font-mono">
            서비스 {running}/{apps.length}
          </span>
          {node.metrics && (
            <span className="text-[10px] text-slate-600 font-mono">
              CPU {node.metrics.cpuPercent?.toFixed(0)}%
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onOpenNode() }}
            className="text-[10px] text-slate-600 hover:text-sky-400 font-bold opacity-0 group-hover:opacity-100"
            title="토폴로지에서 보기"
          >
            <span className="material-symbols-outlined text-[15px]">open_in_new</span>
          </button>
        </div>
      </div>

      {/* 자식: 보호 대상 서비스 + 에이전트 */}
      {open && (
        <div className="border-l border-slate-800 ml-[46px]">
          {apps.length > 0 ? (
            apps.map(app => <ServiceRow key={app.id} app={app} />)
          ) : (
            <div className="pl-[22px] py-1.5 text-[11px] text-slate-700">서비스 없음</div>
          )}

          {/* 에이전트 = 노드 구성요소 */}
          <div className="flex items-center gap-2 pl-[22px] pr-4 py-1.5 hover:bg-white/[0.03] border-t border-slate-800/50">
            <span className="material-symbols-outlined text-[15px] text-indigo-400/70">smart_toy</span>
            <span className="text-[12px] font-medium text-slate-400">Nemesis Agent</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${agentUp ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className={`text-[10px] font-mono font-bold ${agentUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {agentUp ? 'connected' : 'offline'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 클러스터 행 + 노드들 ──────────────────────────────────────
function ClusterBranch({ cluster, open, onToggle, openNodes, toggleNode, onOpenCluster, onOpenNode }) {
  const nodes    = cluster.nodes ?? []
  const faulted  = nodes.filter(n => n.state === 'STOPPED' || n.role === 'FAULT').length
  const healthy  = faulted === 0
  const primary  = nodes.find(n => n.role === 'PRIMARY')

  return (
    <div className="card-bg rounded-2xl overflow-hidden">
      {/* 클러스터 헤더 */}
      <div className="flex items-center gap-2.5 px-4 py-3 hover:bg-white/[0.04] cursor-pointer" onClick={onToggle}>
        <span className={`material-symbols-outlined text-[18px] text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}>
          chevron_right
        </span>
        <span className={`material-symbols-outlined text-[18px] ${healthy ? 'text-sky-400' : 'text-red-400'}`}>hub</span>
        <span className="text-[13px] font-black text-slate-100 tracking-tight">{cluster.clusterName}</span>

        <span className="text-[9px] font-bold font-mono border border-sky-500/30 bg-sky-500/10 text-sky-300 rounded px-1.5 py-0.5">
          VIP {cluster.vip ?? '—'}
        </span>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-slate-500 font-mono">노드 {nodes.length}</span>
          {faulted > 0 ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
              <span className="material-symbols-outlined text-[14px]">error</span>
              장애 {faulted}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              정상
            </span>
          )}
          {primary && (
            <span className="text-[10px] text-slate-600 font-mono hidden md:inline">Active: {primary.hostname}</span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onOpenCluster() }}
            className="text-[10px] text-slate-500 hover:text-sky-400 font-bold"
            title="클러스터 상세"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>
      </div>

      {/* 노드들 */}
      {open && (
        <div className="border-t border-[#2d333b] divide-y divide-slate-800/40">
          {nodes.length > 0 ? (
            nodes.map(node => (
              <NodeBranch
                key={node.nodeId}
                node={node}
                clusterId={cluster.clusterId}
                open={openNodes[node.nodeId] ?? false}
                onToggle={() => toggleNode(node.nodeId)}
                onOpenNode={() => onOpenNode(cluster.clusterId)}
              />
            ))
          ) : (
            <div className="px-9 py-3 text-[11px] text-slate-700">노드가 없습니다</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 메인 ──────────────────────────────────────────────────────
export default function ClusterTree() {
  const navigate = useNavigate()
  const [data,      setData]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('')
  const [openCl,    setOpenCl]    = useState({})
  const [openNodes, setOpenNodes] = useState({})
  const [inited,    setInited]    = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { data: clusters } = await getClusters()
        const statuses = await Promise.all(
          clusters.map(c =>
            getClusterStatus(c.id).then(r => r.data)
              .catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] }))
          )
        )
        if (cancelled) return
        setData(statuses)
        // 최초 1회만: 클러스터·노드 전부 펼친 상태로 시작
        if (!inited) {
          const oc = {}, on = {}
          statuses.forEach(s => {
            oc[s.clusterId] = true
            s.nodes?.forEach(n => { on[n.nodeId] = true })
          })
          setOpenCl(oc); setOpenNodes(on); setInited(true)
        }
      } catch {} finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [inited])

  function toggleCluster(id) { setOpenCl(o => ({ ...o, [id]: !o[id] })) }
  function toggleNode(id)    { setOpenNodes(o => ({ ...o, [id]: !o[id] })) }

  function setAll(open) {
    const oc = {}, on = {}
    data.forEach(s => {
      oc[s.clusterId] = open
      s.nodes?.forEach(n => { on[n.nodeId] = open })
    })
    setOpenCl(oc); setOpenNodes(on)
  }

  // 필터: 클러스터명 / 호스트명 / IP / 서비스명
  const q = filter.trim().toLowerCase()
  const filtered = !q ? data : data
    .map(s => {
      const clusterHit = s.clusterName?.toLowerCase().includes(q)
      const nodes = (s.nodes ?? []).filter(n =>
        clusterHit ||
        n.hostname?.toLowerCase().includes(q) ||
        n.ipAddress?.includes(q) ||
        (n.apps ?? []).some(a => a.name?.toLowerCase().includes(q))
      )
      return clusterHit ? s : { ...s, nodes }
    })
    .filter(s => s.clusterName?.toLowerCase().includes(q) || (s.nodes?.length ?? 0) > 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <div className="w-5 h-5 border-2 border-t-sky-500 rounded-full animate-spin" />
          <span className="text-sm">클러스터 트리 로딩 중...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 pt-0 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-100 tracking-tight italic uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-sky-400 text-[24px]">account_tree</span>
            Cluster Tree
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono ml-9">
            Cluster → Node → 보호 대상 서비스 · Agent
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <span className="material-symbols-outlined text-[16px] text-slate-600 absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="클러스터 / 노드 / IP / 서비스"
              className="bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200 w-56 focus:outline-none focus:border-sky-500 transition-colors placeholder-slate-700"
            />
          </div>
          <button onClick={() => setAll(true)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700 hover:bg-white/5">
            <span className="material-symbols-outlined text-[15px]">unfold_more</span>모두 펼치기
          </button>
          <button onClick={() => setAll(false)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700 hover:bg-white/5">
            <span className="material-symbols-outlined text-[15px]">unfold_less</span>모두 접기
          </button>
        </div>
      </div>

      {/* 트리 */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-600 text-sm">검색 결과가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(cluster => (
            <ClusterBranch
              key={cluster.clusterId}
              cluster={cluster}
              open={openCl[cluster.clusterId] ?? false}
              onToggle={() => toggleCluster(cluster.clusterId)}
              openNodes={openNodes}
              toggleNode={toggleNode}
              onOpenCluster={() => navigate(`/cluster/${cluster.clusterId}`)}
              onOpenNode={(cid) => navigate(`/cluster/${cid}/topology`)}
            />
          ))}
        </div>
      )}

      {/* 범례 */}
      <div className="flex items-center gap-5 text-[10px] text-slate-600 font-mono flex-wrap pt-1">
        {[
          ['bg-sky-400', 'ACTIVE (Primary)'],
          ['bg-emerald-400', 'STANDBY (정상)'],
          ['bg-red-400', 'FAULT / STOPPED'],
          ['bg-amber-400', 'RECOVERING'],
        ].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${c}`} />{l}
          </div>
        ))}
      </div>
    </div>
  )
}
