import React, { useEffect, useState } from 'react'
import { Database, RefreshCw, ScanSearch } from 'lucide-react'
import { getDb } from '../api/client'
import { statusBadge } from '../lib/utils'

const TYPE_COLOR = { Oracle: 'text-orange-400', PostgreSQL: 'text-blue-400', MariaDB: 'text-teal-400' }

export default function Db() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [scanMsg, setScanMsg] = useState('')

  async function load() {
    setLoading(true)
    try { const r = await getDb(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  async function autoScan() {
    setScanMsg('스캔 중...')
    try {
      const r = await getDb()
      const found = r.data.items ?? []
      setItems(found)
      setScanMsg(`${found.length}개 DB 인스턴스 발견 (${new Date().toLocaleTimeString('ko-KR')})`)
    } catch { setScanMsg('스캔 실패') }
  }

  useEffect(() => { load() }, [])

  const open = items.filter(d => d.state === 'OPEN' || d.state === 'RUNNING' || d.state === 'PRIMARY').length

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">DB 관리</h2>
          <p className="text-xs text-gray-500 mt-1">에이전트 메트릭 기반 DB 인스턴스 자동 탐지</p>
        </div>
        <div className="flex items-center gap-3">
          {scanMsg && <span className="text-xs text-blue-400">{scanMsg}</span>}
          <button onClick={autoScan} className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20">
            <ScanSearch className="w-3.5 h-3.5" /> 자동 스캔
          </button>
          <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 DB', value: items.length, color: 'text-white' },
          { label: '정상',    value: open,          color: 'text-green-400' },
          { label: '중지',    value: items.length - open, color: items.length - open > 0 ? 'text-red-400' : 'text-gray-500' },
          { label: 'DB 타입', value: [...new Set(items.map(i => i.type))].length, color: 'text-blue-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {items.map(db => {
          const ok = db.state === 'OPEN' || db.state === 'RUNNING' || db.state === 'PRIMARY'
          const pct = db.maxSessions ? Math.round((db.sessions / db.maxSessions) * 100) : 0
          return (
            <div key={db.id} className={`card-bg rounded-xl p-5 cursor-pointer transition-colors hover:border-gray-600 ${selected === db.id ? 'border-blue-500/50' : ''}`}
              onClick={() => setSelected(selected === db.id ? null : db.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Database className={`w-6 h-6 ${TYPE_COLOR[db.type] ?? 'text-gray-400'}`} />
                  <div>
                    <p className="text-sm font-bold text-white">{db.name}</p>
                    <p className="text-xs text-gray-500">{db.type} {db.version} · {db.node} · :{db.port}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${ok ? 'text-green-400' : 'text-red-400'}`}>● {db.state}</span>
                  <span className={statusBadge(ok ? 'running' : 'stopped')}>{ok ? '정상' : '중지'}</span>
                </div>
              </div>

              {selected === db.id && (
                <div className="mt-4 pt-4 border-t border-gray-800 space-y-4">
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div className="bg-gray-900/50 rounded-lg p-3">
                      <p className="text-gray-500 mb-1">세션 수</p>
                      <p className="text-white font-bold text-lg">{db.sessions ?? 0}</p>
                      <p className="text-gray-500">/ {db.maxSessions ?? 0} 최대</p>
                    </div>
                    <div className="bg-gray-900/50 rounded-lg p-3">
                      <p className="text-gray-500 mb-1">세션 사용률</p>
                      <p className={`font-bold text-lg ${pct > 80 ? 'text-red-400' : pct > 60 ? 'text-yellow-400' : 'text-green-400'}`}>{pct}%</p>
                      <div className="mt-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="bg-gray-900/50 rounded-lg p-3">
                      <p className="text-gray-500 mb-1">포트</p>
                      <p className="text-white font-bold text-lg">{db.port}</p>
                      <p className="text-gray-500">{db.node}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white">세션 보기</button>
                    <button className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white">슬로우 쿼리</button>
                    {!ok && <button className="text-xs px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20">기동</button>}
                    {ok  && <button className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20">중지</button>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
