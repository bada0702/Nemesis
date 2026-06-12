import React, { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, RefreshCw, Bell } from 'lucide-react'
import { getDashboardAlerts } from '../../api/client'
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

  async function load() {
    setLoading(true)
    try { const r = await getDashboardAlerts(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv) }, [])

  const filtered = levelFilter === 'all' ? items : items.filter(i => i.level === levelFilter)
  const counts   = { CRITICAL: items.filter(i => i.level === 'CRITICAL').length, WARNING: items.filter(i => i.level === 'WARNING').length, INFO: items.filter(i => i.level === 'INFO').length }

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
    </div>
  )
}
