import React, { useEffect, useState } from 'react'
import { ClipboardList, Play, Check, Settings, RefreshCw, Plus, ChevronRight, Trash2 } from 'lucide-react'
import { getRunbook, createRunbook, updateRunbookStep, deleteRunbook } from '../api/client'
import { statusBadge, fmt } from '../lib/utils'

const TYPE_LABELS  = { MAINTENANCE: '정기점검', BACKUP: 'DB백업', FAILOVER: 'Failover', PATCH: '패치', OTHER: '기타' }
const STATUS_COLORS = { COMPLETED: 'text-green-400', IN_PROGRESS: 'text-blue-400', SCHEDULED: 'text-yellow-400' }

function StepList({ steps = [], currentStep, onStepClick, disabled }) {
  return (
    <div className="flex items-center gap-1 mt-4 overflow-x-auto pb-2">
      {steps.map((s, i) => {
        const isDone   = s.done
        const isActive = s.active
        const canClick = !disabled && i <= currentStep + 1

        return (
          <React.Fragment key={i}>
            <div className="flex flex-col items-center min-w-[64px]">
              <button
                onClick={() => canClick && onStepClick(i)}
                title={canClick ? `${s.label} 시점으로 이동` : ''}
                className={`w-7 h-7 rounded-full flex items-center justify-center mb-1 transition-all
                  ${isDone   ? 'bg-green-500 hover:bg-green-400'          : ''}
                  ${isActive ? 'bg-blue-600 animate-pulse hover:bg-blue-500' : ''}
                  ${!isDone && !isActive ? 'bg-gray-700 hover:bg-gray-600' : ''}
                  ${canClick ? 'cursor-pointer ring-2 ring-transparent hover:ring-white/20' : 'cursor-default'}
                `}
              >
                {isDone    && <Check    className="w-3.5 h-3.5 text-white" />}
                {isActive  && <Settings className="w-3.5 h-3.5 text-white" />}
                {!isDone && !isActive && <Play className="w-3 h-3 text-gray-500 ml-0.5" />}
              </button>
              <p className={`text-[9px] text-center leading-tight ${!isDone && !isActive ? 'text-gray-500' : 'text-white'}`}>
                {s.label}
              </p>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 flex-1 min-w-[12px] -mt-5 transition-colors ${isDone ? 'bg-green-500' : 'bg-gray-700'}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function AddModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', type: 'MAINTENANCE', target: 'prod-cluster-01' })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try { await createRunbook(form); onCreated() }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white">Runbook 생성</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {[['작업 제목','title','text','예: 3월 정기점검'],['대상 클러스터','target','text','prod-cluster-01']].map(([lbl, key, type, ph]) => (
            <div key={key}>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">{lbl}</label>
              <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                type={type} placeholder={ph}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
          ))}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">작업 유형</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white disabled:opacity-50">
              {saving ? '생성 중...' : '생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ item, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  async function confirm() {
    setDeleting(true)
    try { await deleteRunbook(item.id); onDeleted() }
    catch { setDeleting(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-sm rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Runbook 삭제</p>
            <p className="text-xs text-gray-500 mt-0.5">이 작업은 되돌릴 수 없습니다.</p>
          </div>
        </div>
        <div className="bg-gray-900/60 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 font-medium">{item.title}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">{item.target} · {TYPE_LABELS[item.type] ?? item.type}</p>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white">취소</button>
          <button onClick={confirm} disabled={deleting}
            className="flex-1 py-2.5 rounded-lg text-xs bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 flex items-center justify-center gap-1.5">
            {deleting ? <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-3 h-3" />}
            {deleting ? '삭제 중...' : '삭제 확인'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Runbook() {
  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [addOpen,    setAddOpen]    = useState(false)
  const [expanded,   setExpanded]   = useState({})
  const [stepping,   setStepping]   = useState({})
  const [deleteTarget, setDeleteTarget] = useState(null)

  async function load() {
    setLoading(true)
    try { const r = await getRunbook(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleStepClick(itemId, stepIndex) {
    if (stepping[itemId]) return
    setStepping(s => ({ ...s, [itemId]: true }))
    try {
      await updateRunbookStep(itemId, stepIndex)
      await load()
    } finally {
      setStepping(s => ({ ...s, [itemId]: false }))
    }
  }

  async function handleNextStep(item) {
    const cs = item.currentStep ?? item.steps?.findIndex(s => s.active) ?? -1
    const nextStep = cs + 1
    if (nextStep >= (item.steps?.length ?? 0)) return
    await handleStepClick(item.id, nextStep)
  }

  async function handleStart(item) {
    await handleStepClick(item.id, 0)
  }

  return (
    <div className="p-8 pt-0 space-y-6">
      {addOpen && <AddModal onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load() }} />}
      {deleteTarget && (
        <DeleteConfirmModal
          item={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); load() }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Runbook</h2>
          <p className="text-xs text-gray-500 mt-1">정기점검 · 배치작업 · Failover 훈련</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Plus className="w-3.5 h-3.5" /> 새 Runbook
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[['IN_PROGRESS', '진행 중'], ['SCHEDULED', '예약됨'], ['COMPLETED', '완료']].map(([s, lbl]) => (
          <div key={s} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{lbl}</p>
            <p className={`text-2xl font-bold mt-1 ${STATUS_COLORS[s]}`}>{items.filter(i => i.status === s).length}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {loading && items.length === 0
          ? <div className="text-center py-16 text-gray-500">로딩 중...</div>
          : items.length === 0
          ? <div className="card-bg rounded-xl py-16 flex flex-col items-center gap-3 text-gray-500">
              <ClipboardList className="w-10 h-10 opacity-20" />
              <p className="text-sm">등록된 Runbook이 없습니다.</p>
              <button onClick={() => setAddOpen(true)} className="text-xs text-blue-400 hover:text-blue-300 underline">
                첫 번째 Runbook을 만들어 보세요
              </button>
            </div>
          : items.map(item => {
            const steps    = item.steps ?? []
            const cs       = item.currentStep ?? steps.findIndex(s => s.active)
            const isLast   = cs >= steps.length - 1
            const isDone   = item.status === 'COMPLETED'
            const isStepping = !!stepping[item.id]

            return (
              <div key={item.id} className="card-bg rounded-xl overflow-hidden">
                <div className="p-5 cursor-pointer hover:bg-white/5"
                  onClick={() => setExpanded(e => ({ ...e, [item.id]: !e[item.id] }))}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ClipboardList className={`w-5 h-5 ${STATUS_COLORS[item.status] ?? 'text-gray-400'}`} />
                      <div>
                        <p className="text-sm font-bold text-white">{item.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {item.target} · {TYPE_LABELS[item.type] ?? item.type} · {item.createdBy}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {item.status === 'IN_PROGRESS' && (
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                          </div>
                          <span className="text-xs text-blue-400">{item.progress}%</span>
                        </div>
                      )}
                      {isDone && <span className="text-xs text-green-400 font-medium">완료</span>}
                      <span className={statusBadge(item.status)}>{item.status}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteTarget(item) }}
                        className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="삭제">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {expanded[item.id] && (
                    <StepList
                      steps={steps}
                      currentStep={cs}
                      disabled={isDone || isStepping}
                      onStepClick={i => handleStepClick(item.id, i)}
                    />
                  )}
                </div>

                {expanded[item.id] && (
                  <div className="border-t border-gray-800 px-5 py-3 bg-gray-900/30 flex items-center justify-between">
                    <div className="text-xs text-gray-500">
                      {item.startedAt  && `시작: ${fmt(item.startedAt)}`}
                      {!item.startedAt && item.scheduledAt && `예약: ${fmt(item.scheduledAt)}`}
                      {item.completedAt && `  완료: ${fmt(item.completedAt)}`}
                    </div>
                    <div className="flex gap-2">
                      {item.status === 'SCHEDULED' && (
                        <button
                          onClick={() => handleStart(item)}
                          disabled={isStepping}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                          {isStepping
                            ? <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                            : <Play className="w-3 h-3" />}
                          실행 시작
                        </button>
                      )}
                      {item.status === 'IN_PROGRESS' && !isLast && (
                        <button
                          onClick={() => handleNextStep(item)}
                          disabled={isStepping}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-blue-600/20 border border-blue-600/30 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50">
                          {isStepping
                            ? <div className="w-3 h-3 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                            : <ChevronRight className="w-3 h-3" />}
                          다음 단계
                        </button>
                      )}
                      {item.status === 'IN_PROGRESS' && isLast && (
                        <button
                          onClick={() => handleStepClick(item.id, steps.length - 1)}
                          disabled={isStepping}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-green-600/20 border border-green-600/30 text-green-400 hover:bg-green-600/30 disabled:opacity-50">
                          {isStepping
                            ? <div className="w-3 h-3 border border-green-400/40 border-t-green-400 rounded-full animate-spin" />
                            : <Check className="w-3 h-3" />}
                          작업 완료
                        </button>
                      )}
                      <button className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-white">로그 보기</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        }
      </div>
    </div>
  )
}
