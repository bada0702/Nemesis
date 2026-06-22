import React, { useState } from 'react'
import { AlertTriangle, Info, AlertCircle, X } from 'lucide-react'

const LEVEL = {
  CRITICAL: { Icon: AlertCircle, cls: 'status-red',    label: '치명' },
  WARNING:  { Icon: AlertTriangle, cls: 'status-orange', label: '경고' },
  INFO:     { Icon: Info,         cls: 'status-blue',  label: '정보' },
}

const fmt = (when) => (when ? new Date(when).toLocaleString('ko-KR') : '—')

export default function AlarmPanel({ items = [], onClear, className = '' }) {
  const [selected, setSelected] = useState(null)

  return (
    <div className={`card-bg rounded-xl p-6 flex flex-col overflow-hidden ${className}`}>
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h3 className="text-base font-bold text-white">
          실시간 알람
          {items.length > 0 && <span className="ml-1.5 text-[10px] font-normal text-gray-500">({items.length})</span>}
        </h3>
        {items.length > 0 && onClear && (
          <button onClick={onClear}
            className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">지우기</button>
        )}
      </div>
      {/* flex-1 min-h-0 가 있어야 패널 높이 안에서 스크롤이 동작(없으면 패널이 늘어남) */}
      <div className="space-y-4 overflow-y-auto flex-1 min-h-0 max-h-[60vh] pr-1">
        {items.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-xs">알람 없음</div>
        ) : (
          items.map((item, i) => {
            const s = LEVEL[item.level] ?? LEVEL.INFO
            const Icon = s.Icon
            const when = item.ts ?? item.createdAt
            return (
              <button key={`${item.level}|${item.message}|${when ?? i}`}
                onClick={() => setSelected({ ...item, when })}
                className="w-full flex space-x-3 text-left rounded-lg px-1 py-1 -mx-1 hover:bg-white/5 transition-colors">
                <div className="mt-1 shrink-0">
                  <Icon className={`w-4 h-4 ${s.cls}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-bold ${s.cls} truncate`}>{item.message}</p>
                  <p className="text-[10px] text-gray-500 mt-1">{fmt(when)}</p>
                </div>
              </button>
            )
          })
        )}
      </div>

      {selected && <AlarmDetailModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function AlarmDetailModal({ item, onClose }) {
  const s = LEVEL[item.level] ?? LEVEL.INFO
  const Icon = s.Icon
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-[420px] max-w-[92vw]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${s.cls}`} />
            <span className={`text-sm font-bold ${s.cls}`}>{s.label} 알람</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">내용</div>
            <p className="text-sm text-slate-100 break-words">{item.message}</p>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">발생 시각</div>
            <p className="text-sm text-slate-300 font-mono">{fmt(item.when)}</p>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">심각도</div>
            <p className={`text-sm font-bold ${s.cls}`}>{item.level} ({s.label})</p>
          </div>
        </div>
        <div className="flex justify-end p-3 border-t border-slate-700">
          <button onClick={onClose} className="px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded">닫기</button>
        </div>
      </div>
    </div>
  )
}
