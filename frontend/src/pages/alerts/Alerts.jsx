import React, { useEffect, useState, useCallback } from 'react'
import { AlertCircle, AlertTriangle, Info, RefreshCw, Bell, Bot, Trash2, X } from 'lucide-react'
import { getDashboardAlerts, getAiNotifications, deleteAiFinding, rejectAiProposal } from '../../api/client'
import { fmt } from '../../lib/utils'

const LEVEL_CFG = {
  CRITICAL: { Icon: AlertCircle,   cls: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
  WARNING:  { Icon: AlertTriangle, cls: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  INFO:     { Icon: Info,          cls: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
}

export default function Alerts() {
  const [items, setItems]       = useState([])
  const [levelFilter, setLevelFilter] = useState('all')
  const [loading, setLoading]   = useState(true)
  const [ai, setAi]             = useState({ recentFindings: [], recent: [], openFindings: 0, pending: 0 })
  const [busy, setBusy]         = useState(null)

  const loadAi = useCallback(() => getAiNotifications()
    .then(r => setAi(r.data)).catch(() => {}), [])

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await getDashboardAlerts(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
    loadAi()
  }, [loadAi])

  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv) }, [load])

  // 알림 현황에서 직접 로그 삭제: finding 삭제, proposal(제안 대기) 반려.
  async function removeFinding(id) {
    setBusy(id)
    try { await deleteAiFinding(id) } catch { /* 무시 */ }
    finally { await loadAi(); setBusy(null) }
  }
  async function dismissProposal(id) {
    setBusy(id)
    try { await rejectAiProposal(id) } catch { /* 무시 */ }
    finally { await loadAi(); setBusy(null) }
  }

  const filtered = levelFilter === 'all' ? items : items.filter(i => i.level === levelFilter)
  // 카운트 카드는 페이지에 표시되는 전체 알람 = 시스템 알람(level) + AI 열린 이슈(severity 매핑).
  // AiFinding severity: CRITICAL→치명, HIGH/WARN→경고, INFO→정보.
  const findingLevel = (sev) => sev === 'CRITICAL' ? 'CRITICAL' : (sev === 'HIGH' || sev === 'WARN') ? 'WARNING' : 'INFO'
  const aiFindings = ai.recentFindings ?? []
  const counts = {
    CRITICAL: items.filter(i => i.level === 'CRITICAL').length + aiFindings.filter(f => findingLevel(f.severity) === 'CRITICAL').length,
    WARNING:  items.filter(i => i.level === 'WARNING').length  + aiFindings.filter(f => findingLevel(f.severity) === 'WARNING').length,
    INFO:     items.filter(i => i.level === 'INFO').length     + aiFindings.filter(f => findingLevel(f.severity) === 'INFO').length,
  }

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">알람 현황</h2>
          <p className="text-xs text-gray-500 mt-1">실시간 시스템 알람 · 10초 갱신</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 갱신
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[['CRITICAL','치명','text-red-400','border-red-500/30'],['WARNING','경고','text-yellow-400','border-yellow-500/30'],['INFO','정보','text-blue-400','border-blue-500/30']].map(([level, lbl, color, border]) => (
          <div key={level} className={`card-bg rounded-xl p-4 border cursor-pointer transition-all ${levelFilter === level ? border : ''}`}
            onClick={() => setLevelFilter(levelFilter === level ? 'all' : level)}>
            <p className="text-xs text-gray-500">{lbl}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{counts[level]}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Bell className="w-4 h-4 text-gray-500" />
        <span className="text-xs text-gray-500">전체 {items.length}건</span>
        {levelFilter !== 'all' && (
          <button onClick={() => setLevelFilter('all')} className="text-xs text-blue-400 hover:text-blue-300">전체 보기</button>
        )}
      </div>

      <div className="space-y-3">
        {loading && filtered.length === 0
          ? <div className="text-center py-16 text-gray-500">로딩 중...</div>
          : filtered.length === 0
          ? (
            <div className="card-bg rounded-xl p-8 text-center">
              <p className="text-green-400 font-bold">✓ 알람 없음</p>
              <p className="text-xs text-gray-500 mt-1">모든 시스템이 정상 운영 중입니다.</p>
            </div>
          )
          : filtered.map((item, i) => {
            const cfg = LEVEL_CFG[item.level] ?? LEVEL_CFG.INFO
            const Icon = cfg.Icon
            return (
              <div key={i} className={`rounded-xl p-4 border flex items-start gap-3 ${cfg.bg}`}>
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.cls}`} />
                <div className="flex-1">
                  <p className={`text-sm font-bold ${cfg.cls}`}>{item.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{fmt(item.createdAt)}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cfg.cls} ${cfg.bg}`}>{item.level}</span>
              </div>
            )
          })
        }
      </div>

      {/* AI 알림 — 헤더 벨과 동일한 finding/proposal 을 여기서도 확인·삭제 */}
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-bold text-white">AI 알림</h3>
          <span className="text-xs text-gray-500">제안 대기 {ai.pending ?? 0} · 열린 이슈 {ai.openFindings ?? 0}</span>
        </div>
        <div className="space-y-2">
          {(ai.recentFindings ?? []).length === 0 && (ai.recent ?? []).length === 0 && (
            <div className="card-bg rounded-xl p-6 text-center text-xs text-gray-500">AI 알림 없음</div>
          )}
          {(ai.recentFindings ?? []).map(f => (
            <div key={f.id} className="rounded-xl p-3 border border-red-500/20 bg-red-500/5 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">
                  <span className="text-red-400 font-bold">[{f.severity}]</span> {f.signalType} — {f.summary}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{fmt(f.lastSeenAt)}</p>
              </div>
              <button onClick={() => removeFinding(f.id)} disabled={busy === f.id}
                title="이 이슈 삭제"
                className="shrink-0 p-1 text-gray-500 hover:text-red-400 disabled:opacity-40">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {(ai.recent ?? []).map(n => (
            <div key={n.id} className="rounded-xl p-3 border border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">
                  <span className="text-amber-400 font-bold">[{n.status}]</span> {n.triggerReason}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{fmt(n.createdAt)}</p>
              </div>
              {n.status === 'PENDING' && (
                <button onClick={() => dismissProposal(n.id)} disabled={busy === n.id}
                  title="제안 반려(dismiss)"
                  className="shrink-0 p-1 text-gray-500 hover:text-amber-400 disabled:opacity-40">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
