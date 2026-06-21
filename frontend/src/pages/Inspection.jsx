import React, { useEffect, useState } from 'react'
import { ClipboardCheck, Plus, RefreshCw, Trash2, Edit2 } from 'lucide-react'
import { getInspections, createInspection, updateInspection, deleteInspection } from '../api/client'
import { statusBadge, fmt } from '../lib/utils'

const TYPE_LABELS = { REGULAR: '정기', EMERGENCY: '긴급', SPECIAL: '특별' }
const STATUS_OPTS = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED']

function Modal({ initial, onClose, onSaved }) {
  const editing = !!initial
  const [form, setForm] = useState(initial
    ? { ...initial, startTime: (initial.startTime || '').slice(0, 16), endTime: (initial.endTime || '').slice(0, 16) }
    : { title: '', target: 'prod-cluster-01', type: 'REGULAR', date: '', inspector: '', notes: '', status: 'SCHEDULED', startTime: '', endTime: '' })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) await updateInspection(initial.id, form)
      else         await createInspection(form)
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white">{editing ? '점검 수정' : '점검 등록'}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {[['점검 제목','title','text'],['대상','target','text'],['점검자','inspector','text'],['점검일','date','date']].map(([lbl, key, type]) => (
            <div key={key}>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">{lbl}</label>
              <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                type={type}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">유형</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">상태</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">시작 시간</label>
              <input type="datetime-local" value={form.startTime ?? ''}
                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">종료 시간</label>
              <input type="datetime-local" value={form.endTime ?? ''}
                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">비고</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white disabled:opacity-50">
              {saving ? '저장 중...' : editing ? '수정 저장' : '등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Inspection() {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]   = useState(null) // null | 'new' | item

  async function load() {
    setLoading(true)
    try { const r = await getInspections(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    if (!window.confirm('삭제하시겠습니까?')) return
    await deleteInspection(id)
    load()
  }

  return (
    <div className="p-8 pt-0 space-y-6">
      {modal && (
        <Modal initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">점검 관리</h2>
          <p className="text-xs text-gray-500 mt-1">시스템 점검 이력 및 일정 관리</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setModal('new')} className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="w-3.5 h-3.5" /> 점검 등록
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[['SCHEDULED','예약',,'text-yellow-400'],['IN_PROGRESS','진행 중',,'text-blue-400'],['COMPLETED','완료',,'text-green-400'],['전체','전체',,'text-white']].map(([s, lbl, , color]) => (
          <div key={s} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{lbl}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{s === '전체' ? items.length : items.filter(i => i.status === s).length}</p>
          </div>
        ))}
      </div>

      <div className="card-bg rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800">
            <tr className="text-gray-500 uppercase">
              {['제목','대상','유형','상태','진행률','점검일','점검자','비고',''].map(h => (
                <th key={h} className="text-left py-3 px-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0
              ? <tr><td colSpan="9" className="text-center py-12 text-gray-500">로딩 중...</td></tr>
              : !loading && items.length === 0
              ? <tr><td colSpan="9" className="py-16">
                  <div className="flex flex-col items-center gap-3 text-gray-500">
                    <ClipboardCheck className="w-10 h-10 opacity-30" />
                    <p className="text-sm font-medium">등록된 점검 일정이 없습니다.</p>
                    <button onClick={() => setModal('new')} className="mt-1 text-xs text-blue-400 hover:text-blue-300 underline">
                      첫 번째 점검을 등록해 보세요
                    </button>
                  </div>
                </td></tr>
              : items.map(item => (
                <tr key={item.id} className="border-b border-gray-800/40 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="w-4 h-4 text-blue-400" />
                      <span className="font-medium text-white">{item.title}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-400">{item.target}</td>
                  <td className="py-3 px-4">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${item.type === 'EMERGENCY' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {TYPE_LABELS[item.type] ?? item.type}
                    </span>
                  </td>
                  <td className="py-3 px-4"><span className={statusBadge(item.status)}>{item.status}</span></td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${item.progress ?? 0}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono">{item.progress ?? 0}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-400">{item.date}</td>
                  <td className="py-3 px-4 text-gray-400">{item.inspector}</td>
                  <td className="py-3 px-4 text-gray-500 max-w-[160px] truncate">{item.notes || '—'}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1">
                      <button onClick={() => setModal(item)} className="p-1 text-gray-500 hover:text-white"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(item.id)} className="p-1 text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
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
