import React from 'react'
import { Container } from 'lucide-react'

export default function DockerPanel({ nodes }) {
  const rows = nodes ?? []

  return (
    <div className="card-bg rounded-xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-sm font-bold text-white">Docker 상태</h4>
        <button className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">더보기 →</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-600 py-2">Docker 데이터 없음</p>
      ) : (
        <div className="space-y-4">
          {rows.map((node, i) => (
            <div key={i}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-gray-400 flex items-center">
                  <Container className="w-3 h-3 mr-1" />
                  {node.hostname}{node.ip ? ` (${node.ip})` : ''}
                </span>
                <span className={node.runningContainers > 0 ? 'status-green' : 'text-gray-500'}>
                  ● {node.runningContainers > 0 ? '정상' : 'N/A'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500 bg-black/10 p-2 rounded">
                <div>컨테이너 <span className="text-white">{node.runningContainers ?? 0} / {node.totalContainers ?? 0}</span></div>
                <div>이미지 <span className="text-white">{node.totalContainers ?? 0}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
