import React from 'react'
import { ClipboardList } from 'lucide-react'

export default function RunbookProgressPanel({ item }) {
  return (
    <div className="card-bg rounded-xl p-6">
      <div className="flex justify-between items-center mb-8">
        <h3 className="text-base font-bold text-white">진행 중인 작업 (Runbook / 점검)</h3>
        <button className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">더보기 →</button>
      </div>
      {item ? (
        <div className="flex items-center space-x-4">
          <ClipboardList className="w-5 h-5 text-blue-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-white">{item.name}</p>
            <div className="flex justify-between items-center mt-1 mb-1">
              <span className="text-[10px] text-gray-400">{item.status}</span>
              <span className="text-xs font-bold text-blue-400">{item.progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${item.progress}%` }} />
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-600 py-2">진행 중인 작업 없음</p>
      )}
    </div>
  )
}
