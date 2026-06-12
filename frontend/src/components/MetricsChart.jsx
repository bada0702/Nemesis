import React from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

export default function MetricsChart({ title, dataPoints, color = '#38bdf8', maxY = 100 }) {
  const len    = dataPoints.length
  const labels = dataPoints.map((_, i) => `${len - i}s`)
  const latest = dataPoints[dataPoints.length - 1]

  const data = {
    labels,
    datasets: [{
      label: title,
      data: dataPoints,
      borderColor: color,
      backgroundColor: color + '18',
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      borderWidth: 1.5,
    }],
  }

  const options = {
    responsive: true,
    animation: false,
    scales: {
      y: {
        min: 0, max: maxY,
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: { color: '#6b7280', font: { size: 10 }, maxTicksLimit: 4 },
      },
      x: {
        grid: { display: false },
        ticks: { color: '#6b7280', maxRotation: 0, autoSkip: true, maxTicksLimit: 5, font: { size: 9 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15,20,24,0.92)',
        borderColor: color,
        borderWidth: 1,
        titleColor: '#9ca3af',
        bodyColor: '#e5e7eb',
      },
    },
  }

  const latestPct   = latest !== undefined ? latest.toFixed(1) : '—'
  const latestColor = latest > 85 ? 'text-red-400' : latest > 70 ? 'text-yellow-400' : 'text-gray-300'

  return (
    <div className="card-bg rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{title}</span>
        </div>
        <span className={`text-lg font-bold ${latestColor}`}>{latestPct}%</span>
      </div>
      <div className="h-[100px]">
        <Line data={data} options={options} />
      </div>
    </div>
  )
}
