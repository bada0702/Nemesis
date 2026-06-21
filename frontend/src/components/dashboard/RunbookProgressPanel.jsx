import React from 'react'
import { ClipboardList } from 'lucide-react'

const KIND_CLS = {
  Runbook: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  '점검':  'bg-purple-500/15 text-purple-300 border-purple-500/30',
}

export default function RunbookProgressPanel({ items = [] }) {
  return (
    <div className="card-bg rounded-xl p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-base font-bold text-white">진행 중인 작업 (Runbook / 점검)</h3>
        <button className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">더보기 →</button>
      </div>
      {items.length > 0 ? (
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={i} className="flex items-center space-x-4">
              <ClipboardList className="w-5 h-5 text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold border rounded px-1.5 py-0.5 ${KIND_CLS[item.kind] ?? KIND_CLS.Runbook}`}>
                    {item.kind}
                  </span>
                  <p className="text-sm font-bold text-white truncate">{item.name}</p>
                </div>
                <div className="flex justify-between items-center mt-1 mb-1">
                  <span className="text-[10px] text-gray-400">{item.status}</span>
                  <span className="text-xs font-bold text-blue-400">{item.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${item.progress}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-gray-600 py-2">진행 중인 작업 없음</p>
      )}
    </div>
  )
}
