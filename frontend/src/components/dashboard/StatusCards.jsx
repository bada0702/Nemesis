import React from 'react'
import { ShieldCheck } from 'lucide-react'

function CircleGauge({ pct = 1, color = '#4ade80' }) {
  const r  = 32
  const c  = Math.PI * 2 * r   // ≈ 201
  const offset = c * (1 - Math.min(Math.max(pct, 0), 1))
  return (
    <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r={r} fill="transparent" stroke="#1f2937" strokeWidth="8" />
      <circle cx="40" cy="40" r={r} fill="transparent"
        stroke={color} strokeWidth="8"
        strokeDasharray={c} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  )
}

export function OverallStatusCard({ isHealthy = true }) {
  return (
    <div className="card-bg rounded-xl p-5 flex flex-col items-center justify-center text-center h-full">
      <p className="text-gray-400 text-sm mb-4 self-start">전체 상태</p>
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="mb-2">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center
            ${isHealthy ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
            <ShieldCheck className={`w-10 h-10 ${isHealthy ? 'text-green-500' : 'text-red-500'}`} />
          </div>
        </div>
        <h3 className={`text-2xl font-bold ${isHealthy ? 'status-green' : 'status-red'}`}>
          {isHealthy ? '정상' : '장애'}
        </h3>
        <p className="text-[11px] text-gray-500 mt-2">
          {isHealthy ? '시스템이 안정적으로 운영 중입니다.' : '장애 발생 — 즉시 확인이 필요합니다.'}
        </p>
      </div>
    </div>
  )
}

export function CountCard({ label, total, subs, gaugeColor = '#4ade80', gaugePct = 1 }) {
  return (
    <div className="card-bg rounded-xl p-5 flex justify-between items-center h-full">
      <div className="flex flex-col justify-center h-full">
        <p className="text-gray-400 text-sm mb-2">{label}</p>
        <p className="text-4xl font-bold text-white">{total}</p>
        <div className="flex space-x-4 mt-2 text-xs">
          {subs.map(s => (
            <div key={s.label}>
              <p className="text-gray-500">{s.label}</p>
              <p className={`font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0">
        <CircleGauge pct={gaugePct} color={gaugeColor} />
      </div>
    </div>
  )
}
