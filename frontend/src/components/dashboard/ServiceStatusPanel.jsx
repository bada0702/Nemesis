import React from 'react'
import { Monitor } from 'lucide-react'

export default function ServiceStatusPanel({ items = [], className = '' }) {
  return (
    <div className={`card-bg rounded-xl p-6 ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-base font-bold text-white">주요 서비스 상태</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-600 py-2">등록된 서비스 없음</p>
      ) : (
        <div className="space-y-4">
          {items.map(svc => (
            <div key={svc.name}
              className="flex items-center justify-between p-3 bg-gray-800/40 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded flex items-center justify-center
                  ${svc.ok ? 'bg-green-500/20' : 'bg-orange-500/20'}`}>
                  <Monitor className={`w-4 h-4 ${svc.ok ? 'text-green-500' : 'text-orange-500'}`} />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">{svc.name}</p>
                  {svc.sub && <p className="text-[10px] text-gray-500">{svc.sub}</p>}
                </div>
              </div>
              <span className={`text-[10px] flex items-center ${svc.ok ? 'status-green' : 'status-orange'}`}>
                ● {svc.ok ? '정상' : '경고'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
