import React from 'react'
import { Database } from 'lucide-react'

export default function DbPanel({ items }) {
  const rows = items ?? []

  return (
    <div className="card-bg rounded-xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-sm font-bold text-white">DB 상태</h4>
        <button className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">더보기 →</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-600 py-2">수집된 DB 데이터 없음</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-blue-400" />
                <span className="text-gray-300">{row.name}</span>
              </div>
              <span className="text-white">{row.status}</span>
              <span className={row.ok !== false ? 'status-green' : 'status-red'}>
                ● {row.ok !== false ? '정상' : '오류'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
