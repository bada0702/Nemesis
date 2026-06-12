import React, { useEffect, useState } from 'react'
import { Settings, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'
import { getAlertConfigs, updateAlertConfig } from '../../api/client'
import ComingSoon from '../../components/ComingSoon'

const METRIC_LABELS = { cpu: 'CPU 사용률', memory: '메모리 사용률', disk: '디스크 사용률', node_state: '노드 상태', failover: 'Failover', packet_loss: '패킷 손실률' }
const LEVEL_CLS     = { CRITICAL: 'bg-red-500/20 text-red-400', WARNING: 'bg-yellow-500/20 text-yellow-400' }

export default function AlertConfig() {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  async function load() {
    setLoading(true)
    try { const r = await getAlertConfigs(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function toggle(item) {
    const updated = { ...item, enabled: !item.enabled }
    setItems(prev => prev.map(i => i.id === item.id ? updated : i))
    await updateAlertConfig(item.id, updated)
  }

  async function saveEdit() {
    if (!editing) return
    await updateAlertConfig(editing.id, editing)
    setEditing(null)
    load()
  }

  return (
    <div className="p-8 pt-0 space-y-6">
      <ComingSoon feature="알림 채널 설정" />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">알람 설정</h2>
          <p className="text-xs text-gray-500 mt-1">임계치 규칙 관리</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={e => e.target === e.currentTarget && setEditing(null)}>
          <div className="card-bg w-full max-w-md rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm font-bold text-white">알람 규칙 수정</span>
              <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">규칙 이름</label>
                <input value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase mb-1">임계값</label>
                  <input type="number" value={editing.threshold}
                    onChange={e => setEditing(p => ({ ...p, threshold: +e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase mb-1">쿨다운(분)</label>
                  <input type="number" value={editing.cooldownMin}
                    onChange={e => setEditing(p => ({ ...p, cooldownMin: +e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">레벨</label>
                <select value={editing.level} onChange={e => setEditing(p => ({ ...p, level: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
                  <option value="WARNING">WARNING</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
              <button onClick={saveEdit} className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white">저장</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체 규칙', value: items.length, color: 'text-white' },
          { label: '활성',      value: items.filter(i => i.enabled).length, color: 'text-green-400' },
          { label: '비활성',    value: items.filter(i => !i.enabled).length, color: 'text-gray-500' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card-bg rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800">
            <tr className="text-gray-500 uppercase">
              {['활성','규칙 이름','지표','임계값','레벨','쿨다운',''].map(h => (
                <th key={h} className="text-left py-3 px-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0
              ? <tr><td colSpan="7" className="text-center py-12 text-gray-500">로딩 중...</td></tr>
              : items.map(item => (
                <tr key={item.id} className={`border-b border-gray-800/40 hover:bg-white/5 ${!item.enabled ? 'opacity-50' : ''}`}>
                  <td className="py-3 px-4">
                    <button onClick={() => toggle(item)} className="text-gray-400 hover:text-white">
                      {item.enabled
                        ? <ToggleRight className="w-5 h-5 text-green-400" />
                        : <ToggleLeft  className="w-5 h-5 text-gray-600" />}
                    </button>
                  </td>
                  <td className="py-3 px-4 font-medium text-white">{item.name}</td>
                  <td className="py-3 px-4 text-gray-400">{METRIC_LABELS[item.metric] ?? item.metric}</td>
                  <td className="py-3 px-4 font-bold text-white">{item.threshold}{item.metric !== 'node_state' && item.metric !== 'failover' ? '%' : ''}</td>
                  <td className="py-3 px-4">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${LEVEL_CLS[item.level] ?? ''}`}>{item.level}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-400">{item.cooldownMin}분</td>
                  <td className="py-3 px-4">
                    <button onClick={() => setEditing({ ...item })} className="text-gray-500 hover:text-white p-1">
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
