import React, { useEffect, useState } from 'react'
import { Monitor, Plus, X, RefreshCw, Trash2 } from 'lucide-react'
import { getServices, createService, deleteService, getClusters } from '../api/client'
import ComingSoon from '../components/ComingSoon'

function AddServiceModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', cluster: '', swList: '' })
  const [clusters, setClusters] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getClusters().then(r => setClusters(r.data)).catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!form.cluster) return
    setSaving(true)
    try {
      await createService({
        name: form.name.trim(),
        cluster: form.cluster,
        swList: form.swList.split(',').map(s => s.trim()).filter(Boolean),
      })
      onCreated()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white">서비스 추가</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">서비스명</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="예: 민원시스템" required
              className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">대상 클러스터</label>
            <select value={form.cluster} onChange={e => setForm(f => ({ ...f, cluster: e.target.value }))} required
              className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500">
              <option value="">클러스터 선택</option>
              {clusters.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">SW 컴포넌트 (쉼표 구분)</label>
            <input value={form.swList} onChange={e => setForm(f => ({ ...f, swList: e.target.value }))}
              placeholder="Oracle, WebLogic, Nginx"
              className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? '추가 중...' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Services() {
  const [services, setServices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [addOpen,  setAddOpen]  = useState(false)
  const [selected, setSelected] = useState(null)

  async function load() {
    setLoading(true)
    try { const r = await getServices(); setServices(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id) {
    if (!window.confirm('서비스를 삭제하시겠습니까?')) return
    try { await deleteService(id); load() } catch { /* ignore */ }
  }

  const normalCount = services.filter(s => s.status === 'NORMAL').length

  return (
    <div className="p-8 pt-0 space-y-6">
      <ComingSoon feature="서비스 카탈로그" />
      {addOpen && (
        <AddServiceModal onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load() }} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">서비스 현황</h2>
          <p className="text-xs text-gray-500 mt-1">업무 시스템별 운영 상태</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="w-3.5 h-3.5" /> 서비스 추가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체 서비스', value: services.length,               color: 'text-white'       },
          { label: '정상',        value: normalCount,                    color: 'text-green-400'   },
          { label: '이상',        value: services.length - normalCount,  color: 'text-orange-400'  },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {loading && services.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">로딩 중...</div>
      ) : services.length === 0 ? (
        <div className="card-bg rounded-xl py-16 flex flex-col items-center gap-3 text-gray-500">
          <Monitor className="w-10 h-10 opacity-20" />
          <p className="text-sm">등록된 서비스가 없습니다.</p>
          <button onClick={() => setAddOpen(true)} className="text-xs text-blue-400 hover:text-blue-300 underline">
            서비스를 추가해 보세요
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map(svc => {
            const ok = svc.status === 'NORMAL'
            return (
              <div key={svc.id} className="card-bg rounded-xl p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 cursor-pointer flex-1"
                    onClick={() => setSelected(selected === svc.id ? null : svc.id)}>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${ok ? 'bg-green-500/10' : 'bg-orange-500/10'}`}>
                      <Monitor className={`w-5 h-5 ${ok ? 'text-green-400' : 'text-orange-400'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{svc.name}</p>
                      <p className="text-xs text-gray-500">{svc.cluster} · {(svc.swList ?? []).join(' / ')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium ${ok ? 'text-green-400' : 'text-orange-400'}`}>
                      ● {ok ? '정상' : '이상'}
                    </span>
                    <button onClick={() => handleDelete(svc.id)}
                      className="text-gray-600 hover:text-red-400 p-1.5 rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {selected === svc.id && (svc.swList ?? []).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-800 flex flex-wrap gap-2">
                    {(svc.swList ?? []).map((sw, i) => (
                      <span key={i}
                        className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {sw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
