import React from 'react'

const TYPE_COLOR_CLASS = { WAS: 'bg-blue-600', WEB: 'bg-yellow-600', DB: 'bg-green-600' }

const RUNNING_STATES = new Set(['running', 'active', 'ok', 'RUNNING', 'ACTIVE'])

export default function SwPanel({ items }) {
  const rows = (items ?? []).slice(0, 8).map(i => ({
    name: i.name, status: i.state, ok: RUNNING_STATES.has(i.state), type: i.type,
  }))

  return (
    <div className="card-bg rounded-xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-sm font-bold text-white">Application</h4>
        <button className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">더보기 →</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-600 py-2">수집된 SW 데이터 없음</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center space-x-2">
                <div className={`w-4 h-4 rounded-sm ${TYPE_COLOR_CLASS[row.type] ?? 'bg-gray-600'}`} />
                <span className="text-gray-300">{row.name}</span>
              </div>
              <span className="text-white">{row.status}</span>
              <span className={row.ok ? 'status-green' : 'status-red'}>
                ● {row.ok ? '정상' : '중단'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
