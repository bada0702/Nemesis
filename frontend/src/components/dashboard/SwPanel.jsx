import React from 'react'
import { Server, Globe, Box, Layers } from 'lucide-react'

const RUNNING_STATES = new Set(['running', 'active', 'ok', 'RUNNING', 'ACTIVE'])

// 서비스 종류별 아이콘(맨 앞 빈 사각형 대신 의미 있는 아이콘 표시).
function TypeIcon({ type }) {
  const t = (type || '').toUpperCase()
  if (t === 'WAS') return <Server className="w-4 h-4 text-blue-400" />
  if (t === 'WEB') return <Globe className="w-4 h-4 text-yellow-400" />
  return <Box className="w-4 h-4 text-gray-400" />
}

// 노드(hostname)별로 서비스를 묶는다. node 미상은 '미지정'으로 모은다.
function groupByNode(rows) {
  const map = new Map()
  rows.forEach(r => {
    const key = r.node || '미지정'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  })
  return [...map.entries()]
}

export default function SwPanel({ items }) {
  const rows = (items ?? []).map(i => ({
    name: i.name, status: i.state, ok: RUNNING_STATES.has(i.state), type: i.type, node: i.node,
  }))
  const groups = groupByNode(rows)

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
          {groups.map(([node, list]) => (
            <div key={node}>
              <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                <Layers className="w-3 h-3" /> {node}
              </div>
              <div className="space-y-2 pl-1">
                {list.slice(0, 8).map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center space-x-2 min-w-0">
                      <TypeIcon type={row.type} />
                      <span className="text-gray-300 truncate">{row.name}</span>
                    </div>
                    <span className="text-white shrink-0 ml-2">{row.status}</span>
                    <span className={`shrink-0 ml-2 ${row.ok ? 'status-green' : 'status-red'}`}>
                      ● {row.ok ? '정상' : '중단'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
