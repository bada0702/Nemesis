import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getClusterAgent, getClusterStatus } from '../api/client'

const LEVEL_STYLE = {
  critical: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
    text: 'text-red-300',
    icon: 'error',
    label: 'CRITICAL',
  },
  warning: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    icon: 'warning',
    label: 'WARNING',
  },
  info: {
    border: 'border-sky-500/30',
    bg: 'bg-sky-500/10',
    text: 'text-sky-300',
    icon: 'info',
    label: 'INFO',
  },
}

function buildAlerts(status, agent) {
  const alerts = []

  if (agent?.failoverEvent) {
    alerts.push({
      level: 'warning',
      title: '자동 Failover 감지',
      message: agent.failoverEvent.triggerMsg,
      source: `${agent.failoverEvent.fromNode} → ${agent.failoverEvent.toNode}`,
      ts: agent.failoverEvent.time,
    })
  }

  status?.nodes?.forEach(node => {
    if (node.state !== 'RUNNING') {
      alerts.push({
        level: 'critical',
        title: `${node.hostname} 노드 장애`,
        message: '노드 상태가 RUNNING이 아니어서 서비스 이중화가 필요합니다.',
        source: node.ipAddress ?? node.nodeId,
        ts: status.timestamp,
      })
    }

    const downApps = (node.apps ?? []).filter(app => app.state !== 'running')
    downApps.forEach(app => {
      alerts.push({
        level: app.failoverTrigger ? 'critical' : 'warning',
        title: `${node.hostname} / ${app.name} 서비스 이상`,
        message: `${app.name} 서비스가 ${app.state} 상태입니다. ${app.failoverTrigger ? 'Failover 대상입니다.' : '조치가 필요합니다.'}`,
        source: `${app.type?.toUpperCase() ?? 'SW'} · ${node.hostname}`,
        ts: status.timestamp,
      })
    })

    (node.network ?? []).filter(n => n.state !== 'up').forEach(n => {
      alerts.push({
        level: 'warning',
        title: `${node.hostname} ${n.name} 네트워크 다운`,
        message: '네트워크 인터페이스가 비정상입니다.',
        source: `${n.speed ?? 'NET'} · ${n.name}`,
        ts: status.timestamp,
      })
    })

    (node.fc ?? []).filter(fc => fc.state !== 'online').forEach(fc => {
      alerts.push({
        level: 'warning',
        title: `${node.hostname} ${fc.name} FC 링크 이상`,
        message: 'FC HBA 링크 상태를 확인하세요.',
        source: `${fc.speed ?? 'FC'} · ${fc.name}`,
        ts: status.timestamp,
      })
    })
  })

  return alerts
}

export default function AlertCenter() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [statusRes, agentRes] = await Promise.all([getClusterStatus(id), getClusterAgent(id)])
        if (cancelled) return
        setStatus(statusRes.data)
        setAgent(agentRes.data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  const alerts = useMemo(() => buildAlerts(status, agent), [status, agent])
  const counts = useMemo(() => ({
    critical: alerts.filter(a => a.level === 'critical').length,
    warning: alerts.filter(a => a.level === 'warning').length,
    info: alerts.filter(a => a.level === 'info').length,
  }), [alerts])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <div className="w-5 h-5 border-2 border-t-sky-500 rounded-full animate-spin" />
          <span className="text-sm">알림 센터 로딩 중...</span>
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
        <span className="text-xs text-slate-400">Alerts</span>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-on-surface font-display tracking-tight italic uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-red-400 text-[24px]">notifications_active</span>
            Alert Center
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono ml-9">
            {status?.clusterName ?? '—'} · active alerts {alerts.length}
          </p>
        </div>
        <button onClick={() => navigate(`/cluster/${id}/audit`)} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg px-4 py-2 text-xs font-bold transition-all">
          <span className="material-symbols-outlined text-[16px]">history</span>
          Audit Log
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container border border-red-500/20 rounded-xl p-4">
          <p className="text-[9px] text-slate-500 uppercase tracking-widest font-display">Critical</p>
          <p className="text-2xl font-black text-red-400 font-display">{counts.critical}</p>
        </div>
        <div className="bg-surface-container border border-amber-500/20 rounded-xl p-4">
          <p className="text-[9px] text-slate-500 uppercase tracking-widest font-display">Warning</p>
          <p className="text-2xl font-black text-amber-400 font-display">{counts.warning}</p>
        </div>
        <div className="bg-surface-container border border-sky-500/20 rounded-xl p-4">
          <p className="text-[9px] text-slate-500 uppercase tracking-widest font-display">Info</p>
          <p className="text-2xl font-black text-sky-400 font-display">{counts.info}</p>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-surface-container border border-emerald-500/20 rounded-xl p-6 flex items-center gap-3">
          <span className="material-symbols-outlined text-emerald-400 text-[24px]">check_circle</span>
          <div>
            <p className="text-sm font-bold text-emerald-300">현재 활성 알림이 없습니다.</p>
            <p className="text-[11px] text-slate-500 mt-0.5">노드/서비스/네트워크 상태가 모두 정상입니다.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert, index) => {
            const style = LEVEL_STYLE[alert.level] ?? LEVEL_STYLE.info
            return (
              <div key={`${alert.title}-${index}`} className={`bg-surface-container border ${style.border} rounded-xl p-4 ${style.bg}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className={`material-symbols-outlined text-[20px] ${style.text}`}>{style.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-black text-on-surface">{alert.title}</h3>
                        <span className={`text-[8px] font-bold border rounded px-1.5 py-0.5 ${style.border} ${style.text}`}>{style.label}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{alert.message}</p>
                      <p className="text-[10px] text-slate-600 font-mono mt-2">{alert.source}</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-600 font-mono shrink-0">{alert.ts ?? '—'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
