import React from 'react'

const STATUS = {
  normal:   { color: 'emerald', label: 'NORMAL',    icon: 'check_circle'       },
  warning:  { color: 'amber',   label: 'WARNING',   icon: 'warning'            },
  fault:    { color: 'red',     label: 'FAULT',     icon: 'error'              },
  failover: { color: 'violet',  label: 'FAILOVER',  icon: 'swap_horiz'         },
}

const ROLE_ICON = {
  PRIMARY: { icon: 'star',         color: 'text-sky-400'    },
  STANDBY: { icon: 'backup',       color: 'text-slate-400'  },
  FAULT:   { icon: 'error',        color: 'text-red-400'    },
}

function resolveStatus(nodes) {
  if (!nodes || nodes.length === 0) return 'warning'
  if (nodes.some(n => n.role === 'FAULT' || n.role === 'fault'))           return 'fault'
  if (nodes.some(n => n.role === 'RECOVERING' || n.role === 'recovering')) return 'failover'
  return 'normal'
}

export default function ClusterCard({ cluster, onClick }) {
  const statusKey = resolveStatus(cluster.nodes)
  const st        = STATUS[statusKey]
  const primary   = cluster.nodes?.find(n => n.role === 'PRIMARY' || n.role === 'active')
  const nodeCount = cluster.nodes?.length ?? 0
  const runCount  = cluster.nodes?.filter(n => n.state === 'RUNNING').length ?? 0

  const borderClass = {
    emerald: 'border-emerald-500/40 hover:border-emerald-400/70',
    amber:   'border-amber-500/40  hover:border-amber-400/70',
    red:     'border-red-500/40    hover:border-red-400/70',
    violet:  'border-violet-500/40 hover:border-violet-400/70',
  }[st.color]

  const badgeBg = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    amber:   'bg-amber-500/10  text-amber-400  border-amber-500/30',
    red:     'bg-red-500/10    text-red-400    border-red-500/30',
    violet:  'bg-violet-500/10 text-violet-400 border-violet-500/30',
  }[st.color]

  const dotClass = {
    emerald: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]',
    amber:   'bg-amber-500  shadow-[0_0_8px_rgba(245,158,11,0.5)]',
    red:     'bg-red-500    shadow-[0_0_8px_rgba(239,68,68,0.5)]',
    violet:  'bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]',
  }[st.color]

  return (
    <div
      onClick={onClick}
      className={`bg-surface-container border ${borderClass} rounded-xl p-5 cursor-pointer transition-all duration-200 hover:bg-surface-container-high group`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-500/10 border border-sky-500/20 rounded-lg flex items-center justify-center group-hover:bg-sky-500/20 transition-all">
            <span className="material-symbols-outlined text-sky-400 text-[20px]">hub</span>
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface font-display tracking-tight">{cluster.clusterName}</p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">VIP: {cluster.vip ?? '—'}</p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 text-[10px] font-bold border rounded px-2 py-1 ${badgeBg}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          {st.label}
        </div>
      </div>

      {/* Primary node */}
      <div className="bg-slate-900/60 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-sky-400 text-[14px]">star</span>
        <div>
          <span className="text-[9px] text-slate-500 uppercase tracking-widest block">Primary</span>
          <span className="text-[11px] font-bold text-slate-200">{primary?.hostname ?? '—'}</span>
        </div>
        {primary && (
          <span className="ml-auto text-[9px] font-mono text-emerald-400">● RUNNING</span>
        )}
      </div>

      {/* Node list */}
      <div className="space-y-1.5">
        {cluster.nodes?.slice(0, 3).map(node => {
          const ri     = ROLE_ICON[node.role] ?? ROLE_ICON.STANDBY
          const isUp   = node.state === 'RUNNING'
          const cpu    = node.metrics?.cpuPercent
          return (
            <div key={node.nodeId} className="flex items-center gap-2 text-[11px]">
              <span className={`material-symbols-outlined text-[13px] ${ri.color}`}>{ri.icon}</span>
              <span className="text-slate-400 truncate flex-1">{node.hostname}</span>
              {cpu !== undefined && cpu !== null ? (
                <span className={`font-mono text-[10px] ${cpu > 80 ? 'text-red-400' : cpu > 60 ? 'text-amber-400' : 'text-slate-500'}`}>
                  {cpu.toFixed(0)}%
                </span>
              ) : null}
              <span className={`w-1.5 h-1.5 rounded-full ${isUp ? 'bg-emerald-500' : 'bg-slate-600'}`} />
            </div>
          )
        })}
        {(cluster.nodes?.length ?? 0) > 3 && (
          <p className="text-[10px] text-slate-600 pl-5">+{cluster.nodes.length - 3} 노드 더보기</p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
        <span className="text-[10px] text-slate-600 font-mono">{runCount}/{nodeCount} RUNNING</span>
        <span className="material-symbols-outlined text-slate-700 group-hover:text-sky-500 transition-colors text-[16px]">arrow_forward</span>
      </div>
    </div>
  )
}
