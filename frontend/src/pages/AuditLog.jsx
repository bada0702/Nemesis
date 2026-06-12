import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getClusterAgent } from '../api/client'

const LEVEL_STYLE = {
  CRITICAL: 'text-red-300 bg-red-500/10 border-red-500/30',
  ERROR: 'text-red-300 bg-red-500/10 border-red-500/30',
  WARN: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  INFO: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
}

export default function AuditLog() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await getClusterAgent(id)
        if (!cancelled) setAgent(res.data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  const logs = useMemo(() => {
    const rows = (agent?.nodes ?? []).flatMap(node =>
      (node.logs ?? []).map(log => ({
        ...log,
        node: node.hostname,
      }))
    )
    return rows.sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
  }, [agent])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <div className="w-5 h-5 border-2 border-t-sky-500 rounded-full animate-spin" />
          <span className="text-sm">감사 로그 로딩 중...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(`/cluster/${id}`)} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-xs font-bold">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          노드 상태
        </button>
        <span className="text-slate-700">/</span>
        <span className="text-xs text-slate-400">Audit Log</span>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-on-surface font-display tracking-tight italic uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-sky-400 text-[24px]">history</span>
            Audit Log
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono ml-9">
            {agent?.clusterName ?? '—'} · node events {logs.length}
          </p>
        </div>
        <button onClick={() => navigate(`/cluster/${id}/alerts`)} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg px-4 py-2 text-xs font-bold transition-all">
          <span className="material-symbols-outlined text-[16px]">notifications_active</span>
          Alerts
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="bg-surface-container border border-slate-700 rounded-xl p-6 flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-500 text-[24px]">notes</span>
          <div>
            <p className="text-sm font-bold text-slate-300">표시할 감사 로그가 없습니다.</p>
            <p className="text-[11px] text-slate-500 mt-0.5">노드 로그가 생성되면 여기에서 확인할 수 있습니다.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log, index) => (
            <div key={`${log.node}-${log.ts}-${index}`} className="bg-surface-container border border-surface-variant rounded-xl px-4 py-3">
              <div className="flex items-start gap-3">
                <span className={`text-[8px] font-black border rounded px-1.5 py-0.5 shrink-0 ${LEVEL_STYLE[log.level] ?? LEVEL_STYLE.INFO}`}>
                  {log.level}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-slate-500">{log.ts}</span>
                    <span className="text-[10px] text-slate-700">•</span>
                    <span className="text-[10px] font-bold text-slate-400">{log.node}</span>
                  </div>
                  <p className="text-sm text-slate-200 mt-1 break-words">{log.msg}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
