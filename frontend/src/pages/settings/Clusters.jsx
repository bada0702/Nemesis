import React, { useEffect, useState } from 'react'
import { GitBranch, Plus, Trash2, Edit2, RefreshCw } from 'lucide-react'
import { getClusters, createCluster, updateCluster, deleteCluster } from '../../api/client'

function Modal({ initial, onClose, onSaved }) {
  const editing = !!initial
  const [form, setForm] = useState(initial ?? { name: '', vip: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!form.name || !form.vip) { setError('이름과 VIP는 필수입니다.'); return }
    setSaving(true); setError(null)
    try {
      if (editing) await updateCluster(initial.id, form)
      else         await createCluster(form)
      onSaved()
    } catch { setError('저장 중 오류가 발생했습니다.') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white">{editing ? '클러스터 수정' : '클러스터 추가'}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {[['클러스터 이름','name','예: prod-cluster-01'],['VIP 주소','vip','예: 192.168.1.100'],['설명','description','선택 입력']].map(([lbl, key, ph]) => (
            <div key={key}>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">{lbl}{key !== 'description' && <span className="text-red-400"> *</span>}</label>
              <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={ph}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
          ))}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white disabled:opacity-50">
              {saving ? '저장 중...' : editing ? '수정 저장' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ClustersSettings() {
  const [clusters, setClusters] = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)

  async function load() {
    setLoading(true)
    try { const r = await getClusters(); setClusters(r.data) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function remove(id, name) {
    if (!window.confirm(`"${name}" 클러스터를 삭제하시겠습니까?`)) return
    await deleteCluster(id)
    load()
  }

  return (
    <div className="p-8 pt-0 space-y-6">
      {modal && <Modal initial={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">클러스터 설정</h2>
          <p className="text-xs text-gray-500 mt-1">HA 클러스터 등록 및 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setModal('new')} className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="w-3.5 h-3.5" /> 클러스터 추가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading && clusters.length === 0
          ? <div className="text-center py-16 text-gray-500">로딩 중...</div>
          : clusters.map(c => (
            <div key={c.id} className="card-bg rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                    <GitBranch className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{c.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">VIP: {c.vip || '—'}{c.description && ` · ${c.description}`}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setModal(c)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600">
                    <Edit2 className="w-3.5 h-3.5" /> 수정
                  </button>
                  <button onClick={() => remove(c.id, c.name)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" /> 삭제
                  </button>
                </div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}
