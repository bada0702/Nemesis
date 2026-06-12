import React from 'react'
import { AlertTriangle, Info, AlertCircle } from 'lucide-react'

const LEVEL = {
  CRITICAL: { Icon: AlertCircle, cls: 'status-red',    label: '치명' },
  WARNING:  { Icon: AlertTriangle, cls: 'status-orange', label: '경고' },
  INFO:     { Icon: Info,         cls: 'status-blue',  label: '정보' },
}

export default function AlarmPanel({ items = [], className = '' }) {
  return (
    <div className={`card-bg rounded-xl p-6 flex flex-col overflow-hidden ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-base font-bold text-white">실시간 알람</h3>
        <button className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">더보기 →</button>
      </div>
      <div className="space-y-4 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-xs">알람 없음</div>
        ) : (
          items.map((item, i) => {
            const s = LEVEL[item.level] ?? LEVEL.INFO
            const Icon = s.Icon
            return (
              <div key={i} className="flex space-x-3">
                <div className="mt-1">
                  <Icon className={`w-4 h-4 ${s.cls}`} />
                </div>
                <div>
                  <p className={`text-xs font-bold ${s.cls}`}>{item.message}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {item.createdAt
                      ? new Date(item.createdAt).toLocaleString('ko-KR')
                      : '—'}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
