import React, { useEffect, useState, useCallback } from 'react'
import {
  GitBranch, ChevronUp, ChevronDown, Plus, Trash2, Edit2,
  RefreshCw, Save, Zap, Power, PowerOff, ArrowRightLeft, Clock, ClipboardList, Check, Play, SkipForward,
} from 'lucide-react'
import { getClusters, getHaSequences, updateHaSequences, getRunbook, createRunbook, updateRunbookStep } from '../../api/client'
import { fmt } from '../../lib/utils'
import ComingSoon from '../../components/ComingSoon'

// ── 상수 ──────────────────────────────────────────────────────
const TABS = [
  { key: 'STARTUP',  label: '기동 절차',     icon: Power,         color: 'text-green-400'  },
  { key: 'SHUTDOWN', label: '중지 절차',     icon: PowerOff,      color: 'text-red-400'    },
  { key: 'FAILOVER', label: 'Failover 절차', icon: ArrowRightLeft, color: 'text-purple-400' },
  { key: 'RUNBOOK',  label: '운영 Runbook',  icon: ClipboardList, color: 'text-orange-400' },
]

const ACTION_META = {
  START:        { label: 'START',    bg: 'bg-green-500/20 text-green-400 border-green-500/30' },
  STOP:         { label: 'STOP',     bg: 'bg-red-500/20 text-red-400 border-red-500/30'       },
  VIP_TRANSFER: { label: 'VIP 전환', bg: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  WAIT:         { label: 'WAIT',     bg: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  CHECK:        { label: 'CHECK',    bg: 'bg-blue-500/20 text-blue-400 border-blue-500/30'    },
}

const SERVICE_TYPES = ['WEB', 'WAS', 'DB', 'SYS', 'VIP', 'ETC']
const NODE_ROLES    = ['PRIMARY', 'STANDBY', 'ALL']
const ACTIONS       = ['START', 'STOP', 'VIP_TRANSFER', 'WAIT', 'CHECK']

const EMPTY_FORM = { action: 'START', serviceType: 'WEB', serviceName: '', nodeRole: 'PRIMARY', waitAfterSec: 5, description: '' }

// ── 단계 추가/수정 모달 ──────────────────────────────────────
function StepModal({ initial, onClose, onSave }) {
  const editing = !!initial
  const [form, setForm] = useState(initial ? { ...initial } : { ...EMPTY_FORM })

  const sel = 'w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500'
  const inp = 'w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500'

  function isVip() { return form.action === 'VIP_TRANSFER' }

  function handleActionChange(action) {
    setForm(f => ({
      ...f, action,
      serviceType: action === 'VIP_TRANSFER' ? 'VIP' : (f.serviceType === 'VIP' ? 'WEB' : f.serviceType),
      serviceName: action === 'VIP_TRANSFER' ? 'VIP 전환' : (f.serviceName === 'VIP 전환' ? '' : f.serviceName),
      nodeRole:    action === 'VIP_TRANSFER' ? null : (f.nodeRole ?? 'PRIMARY'),
    }))
  }

  function submit(e) {
    e.preventDefault()
    if (!isVip() && !form.serviceName.trim()) return
    onSave({ ...form, serviceName: form.serviceName || 'VIP 전환' })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-lg rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white">{editing ? '단계 수정' : '단계 추가'}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* 동작 */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1.5">동작</label>
            <div className="flex gap-2 flex-wrap">
              {ACTIONS.map(a => (
                <button key={a} type="button"
                  onClick={() => handleActionChange(a)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    form.action === a
                      ? ACTION_META[a].bg + ' border-current'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
                  }`}>
                  {ACTION_META[a].label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 서비스 유형 */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1.5">서비스 유형</label>
              <select value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value }))}
                disabled={isVip()} className={sel + (isVip() ? ' opacity-50 cursor-not-allowed' : '')}>
                {SERVICE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            {/* 노드 역할 */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1.5">노드 역할</label>
              <select value={form.nodeRole ?? ''} onChange={e => setForm(f => ({ ...f, nodeRole: e.target.value || null }))}
                disabled={isVip()} className={sel + (isVip() ? ' opacity-50 cursor-not-allowed' : '')}>
                <option value="">— (해당 없음)</option>
                {NODE_ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {/* 서비스명 */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1.5">서비스명 {!isVip() && <span className="text-red-400">*</span>}</label>
            <input value={form.serviceName} onChange={e => setForm(f => ({ ...f, serviceName: e.target.value }))}
              disabled={isVip()} placeholder={isVip() ? 'VIP 전환' : '예: Oracle, WebLogic, Nginx'}
              className={inp + (isVip() ? ' opacity-50 cursor-not-allowed' : '')} />
          </div>

          {/* 대기 시간 + 설명 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1.5">완료 후 대기(초)</label>
              <input type="number" min={0} max={600} value={form.waitAfterSec}
                onChange={e => setForm(f => ({ ...f, waitAfterSec: +e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1.5">비고</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="선택 입력" className={inp} />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white">취소</button>
            <button type="submit"
              className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white font-bold hover:bg-blue-700">
              {editing ? '수정 저장' : '단계 추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── 단계 행 ────────────────────────────────────────────────────
function StepRow({ step, idx, total, isFirst, isLast, onMove, onEdit, onRemove }) {
  const meta = ACTION_META[step.action] ?? ACTION_META.START
  const isVip = step.action === 'VIP_TRANSFER'

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all
      ${isVip
        ? 'bg-purple-500/5 border-purple-500/30'
        : 'bg-gray-900/40 border-gray-800 hover:border-gray-700'}`}>

      {/* 순서 번호 */}
      <div className="flex flex-col gap-0.5">
        <button onClick={() => onMove(idx, -1)} disabled={idx === 0}
          className="p-0.5 text-gray-600 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onMove(idx, 1)} disabled={idx === total - 1}
          className="p-0.5 text-gray-600 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="w-6 text-center text-xs font-bold text-gray-500">{idx + 1}</div>

      {/* 동작 배지 */}
      <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${meta.bg} min-w-[52px] text-center`}>
        {meta.label}
      </span>

      {/* 서비스 유형 */}
      {!isVip && (
        <span className="text-[10px] px-2 py-1 rounded-md bg-gray-800 text-gray-400 border border-gray-700 min-w-[38px] text-center">
          {step.serviceType}
        </span>
      )}

      {/* 서비스명 */}
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${isVip ? 'text-purple-300' : 'text-white'}`}>
          {step.serviceName}
        </span>
        {step.description && (
          <span className="text-[10px] text-gray-500 ml-2 truncate">{step.description}</span>
        )}
      </div>

      {/* 노드 역할 */}
      {!isVip && step.nodeRole && (
        <span className={`text-[10px] px-2 py-1 rounded-md border min-w-[62px] text-center
          ${step.nodeRole === 'PRIMARY'
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
            : step.nodeRole === 'STANDBY'
              ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
              : 'bg-gray-700 text-gray-400 border-gray-600'}`}>
          {step.nodeRole}
        </span>
      )}

      {/* 대기 시간 */}
      <div className="flex items-center gap-1 text-gray-500 text-xs min-w-[56px] justify-end">
        <Clock className="w-3 h-3" />
        <span>{step.waitAfterSec}s</span>
      </div>

      {/* 액션 */}
      {!isVip ? (
        <div className="flex gap-1 ml-1">
          <button onClick={() => onEdit(idx)} className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/5">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onRemove(idx)} className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg hover:bg-red-500/5">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex gap-1 ml-1">
          <button onClick={() => onEdit(idx)} className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/5">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── 탭: 운영 Runbook ──────────────────────────────────────────
const TYPE_LABELS   = { MAINTENANCE: '정기점검', BACKUP: 'DB백업', FAILOVER: 'Failover', PATCH: '패치', OTHER: '기타' }
const STATUS_COLORS = { COMPLETED: 'text-green-400', IN_PROGRESS: 'text-blue-400', SCHEDULED: 'text-yellow-400' }

function RunbookTab() {
  const [list,     setList]     = useState([])
  const [active,   setActive]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [adding,   setAdding]   = useState(false)
  const [form,     setForm]     = useState({ title: '', type: 'MAINTENANCE', target: '' })
  const [saving,   setSaving]   = useState(false)
  const [stepping, setStepping] = useState({})

  async function load() {
    setLoading(true)
    try { const r = await getRunbook(); setList(r.data ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function createNew(e) {
    e.preventDefault()
    setSaving(true)
    try { await createRunbook(form); await load(); setAdding(false) }
    finally { setSaving(false) }
  }

  async function advanceStep(runbookId, stepIndex) {
    if (stepping[runbookId]) return
    setStepping(s => ({ ...s, [runbookId]: true }))
    try { await updateRunbookStep(runbookId, stepIndex); await load() }
    catch { /* ignore */ }
    finally { setStepping(s => ({ ...s, [runbookId]: false })) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">운영 절차 실행 이력 및 단계별 진행 관리</p>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-600/10 border border-blue-600/20 text-blue-400 hover:bg-blue-600/20">
          <Plus className="w-3.5 h-3.5" /> 신규 작성
        </button>
      </div>

      {adding && (
        <div className="card-bg rounded-xl p-5">
          <p className="text-sm font-bold text-white mb-4">새 Runbook</p>
          <form onSubmit={createNew} className="space-y-3">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="제목 (예: 정기 점검 2026-06-12)"
              className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                placeholder="대상 클러스터"
                className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(false)}
                className="flex-1 py-2 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
              <button type="submit" disabled={saving}
                className="flex-1 py-2 rounded-lg text-xs bg-blue-600 text-white disabled:opacity-50">
                {saving ? '생성 중...' : '생성'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : list.length === 0 ? (
        <div className="text-center py-16 text-gray-500">Runbook이 없습니다</div>
      ) : (
        <div className="space-y-3">
          {list.map(rb => (
            <div key={rb.id} className="card-bg rounded-xl overflow-hidden">
              <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 text-left"
                onClick={() => setActive(active === rb.id ? null : rb.id)}>
                <div className="flex items-center gap-3">
                  <ClipboardList className="w-4 h-4 text-orange-400" />
                  <div>
                    <p className="text-sm font-bold text-white">{rb.title}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {TYPE_LABELS[rb.type] ?? rb.type} · {rb.target} · {fmt(rb.createdAt)}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-bold ${STATUS_COLORS[rb.status] ?? 'text-gray-400'}`}>
                  {rb.status}
                </span>
              </button>

              {active === rb.id && rb.steps && (
                <div className="border-t border-gray-800 px-5 py-4 space-y-2">
                  {rb.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <button onClick={() => advanceStep(rb.id, i)} disabled={step.done || !!stepping[rb.id]}
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all
                          ${step.done   ? 'bg-green-500' : step.active ? 'bg-blue-600 animate-pulse' : 'bg-gray-700 hover:bg-gray-600'}`}>
                        {step.done   && <Check    className="w-3 h-3 text-white" />}
                        {step.active && <Play     className="w-3 h-3 text-white" />}
                        {!step.done && !step.active && <SkipForward className="w-3 h-3 text-gray-500" />}
                      </button>
                      <span className={`text-xs ${step.done ? 'text-gray-500 line-through' : step.active ? 'text-white' : 'text-gray-400'}`}>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ─────────────────────────────────────────────
export default function HaSequence() {
  const [clusters,    setClusters]    = useState([])
  const [clusterId,   setClusterId]   = useState(null)
  const [activeTab,   setActiveTab]   = useState('FAILOVER')
  const [sequences,   setSequences]   = useState({ STARTUP: [], SHUTDOWN: [], FAILOVER: [] })
  const [loading,     setLoading]     = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [modal,       setModal]       = useState(null)  // null | { idx } | 'new'

  const steps = sequences[activeTab] ?? []

  // 클러스터 목록 로드
  async function loadClusters() {
    try {
      const r = await getClusters()
      setClusters(r.data)
      if (r.data.length > 0 && !clusterId) setClusterId(r.data[0].id)
    } catch { /* ignore */ }
  }

  // 시퀀스 로드
  const loadSequences = useCallback(async () => {
    if (!clusterId) return
    setLoading(true)
    try {
      const r = await getHaSequences(clusterId)
      setSequences(r.data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [clusterId])

  useEffect(() => { loadClusters() }, [])
  useEffect(() => { loadSequences() }, [loadSequences])

  // 단계 이동
  function moveStep(idx, dir) {
    const arr = [...steps]
    const swap = idx + dir
    if (swap < 0 || swap >= arr.length) return
    ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
    setSequences(s => ({ ...s, [activeTab]: arr.map((x, i) => ({ ...x, order: i + 1 })) }))
  }

  // 단계 삭제
  function removeStep(idx) {
    if (!window.confirm('이 단계를 삭제하시겠습니까?')) return
    const arr = steps.filter((_, i) => i !== idx).map((x, i) => ({ ...x, order: i + 1 }))
    setSequences(s => ({ ...s, [activeTab]: arr }))
  }

  // 단계 추가/수정 저장
  function saveStep(stepData) {
    if (modal === 'new') {
      const newStep = { ...stepData, id: `seq${Date.now()}`, order: steps.length + 1 }
      setSequences(s => ({ ...s, [activeTab]: [...steps, newStep] }))
    } else if (modal?.idx !== undefined) {
      const arr = steps.map((x, i) => i === modal.idx ? { ...x, ...stepData } : x)
      setSequences(s => ({ ...s, [activeTab]: arr }))
    }
    setModal(null)
  }

  // 저장 (서버)
  async function save() {
    if (!clusterId) return
    setSaving(true)
    try {
      await updateHaSequences(clusterId, { type: activeTab, steps })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  // VIP_TRANSFER 인덱스 찾기 (Failover 절차 시각화용)
  const vipIdx = activeTab === 'FAILOVER' ? steps.findIndex(s => s.action === 'VIP_TRANSFER') : -1

  // 현재 클러스터 이름
  const currentCluster = clusters.find(c => c.id === clusterId)

  return (
    <div className="p-8 pt-0 space-y-5">
      <ComingSoon feature="HA 페일오버 시퀀스" />
      {/* 모달 */}
      {modal && (
        <StepModal
          initial={modal === 'new' ? null : steps[modal.idx]}
          onClose={() => setModal(null)}
          onSave={saveStep}
        />
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">HA 운영 절차</h2>
          <p className="text-xs text-gray-500 mt-1">
            기동 / 중지 / Failover 시 서비스 처리 순서 정의
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 클러스터 선택 */}
          <select
            value={clusterId ?? ''}
            onChange={e => setClusterId(+e.target.value)}
            className="px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500">
            {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={loadSequences}
            className="p-2 text-gray-400 hover:text-white border border-gray-700 rounded-lg hover:border-gray-500">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-2">
        {TABS.map(tab => {
          const Icon = tab.icon
          const count = (sequences[tab.key] ?? []).length
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                activeTab === tab.key
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-transparent border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
              }`}>
              <Icon className={`w-4 h-4 ${activeTab === tab.key ? tab.color : ''}`} />
              {tab.label}
              {tab.key !== 'RUNBOOK' && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold
                  ${activeTab === tab.key ? 'bg-white/15 text-white' : 'bg-gray-800 text-gray-600'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Failover 절차 3-phase 안내 */}
      {activeTab === 'FAILOVER' && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Phase 1: 서비스 중지', color: 'border-red-500/30 bg-red-500/5', count: vipIdx > 0 ? vipIdx : steps.filter(s => s.action === 'STOP').length },
            { label: 'Phase 2: VIP 전환',    color: 'border-purple-500/30 bg-purple-500/5', count: vipIdx >= 0 ? 1 : 0 },
            { label: 'Phase 3: 서비스 기동', color: 'border-green-500/30 bg-green-500/5',  count: vipIdx >= 0 ? steps.length - vipIdx - 1 : steps.filter(s => s.action === 'START').length },
          ].map(p => (
            <div key={p.label} className={`rounded-xl border px-4 py-3 ${p.color}`}>
              <p className="text-xs text-gray-400 font-medium">{p.label}</p>
              <p className="text-lg font-bold text-white mt-0.5">{p.count}단계</p>
            </div>
          ))}
        </div>
      )}

      {/* 단계 목록 */}
      {activeTab !== 'RUNBOOK' && (
        <div className="card-bg rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
            <span className="text-sm font-bold text-white">
              {TABS.find(t => t.key === activeTab)?.label}
              {currentCluster && <span className="text-gray-500 font-normal ml-2">· {currentCluster.name}</span>}
            </span>
            <button onClick={() => setModal('new')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-600/30 text-blue-400 hover:bg-blue-600/25">
              <Plus className="w-3.5 h-3.5" /> 단계 추가
            </button>
          </div>

          {loading ? (
            <div className="py-16 text-center text-gray-500 text-sm">로딩 중...</div>
          ) : steps.length === 0 ? (
            <div className="py-16 text-center">
              <Zap className="w-8 h-8 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">정의된 절차가 없습니다.</p>
              <button onClick={() => setModal('new')}
                className="mt-4 text-xs text-blue-400 hover:underline">+ 첫 번째 단계 추가</button>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {/* Failover: VIP_TRANSFER 위치에 phase 구분선 삽입 */}
              {activeTab === 'FAILOVER' && vipIdx >= 0 ? (
                <>
                  {/* Phase 1: 중지 */}
                  {vipIdx > 0 && (
                    <>
                      <div className="px-1 py-1">
                        <span className="text-[10px] font-bold uppercase text-red-400 tracking-widest">Phase 1 · 서비스 중지</span>
                      </div>
                      {steps.slice(0, vipIdx).map((s, i) => (
                        <StepRow key={s.id} step={s} idx={i} total={steps.length}
                          onMove={moveStep} onEdit={idx => setModal({ idx })} onRemove={removeStep} />
                      ))}
                    </>
                  )}
                  {/* Phase 2: VIP */}
                  <div className="px-1 py-2">
                    <span className="text-[10px] font-bold uppercase text-purple-400 tracking-widest">Phase 2 · VIP 전환</span>
                  </div>
                  <StepRow key={steps[vipIdx].id} step={steps[vipIdx]} idx={vipIdx} total={steps.length}
                    onMove={moveStep} onEdit={idx => setModal({ idx })} onRemove={removeStep} />
                  {/* Phase 3: 기동 */}
                  {vipIdx < steps.length - 1 && (
                    <>
                      <div className="px-1 py-2">
                        <span className="text-[10px] font-bold uppercase text-green-400 tracking-widest">Phase 3 · 서비스 기동</span>
                      </div>
                      {steps.slice(vipIdx + 1).map((s, i) => (
                        <StepRow key={s.id} step={s} idx={vipIdx + 1 + i} total={steps.length}
                          onMove={moveStep} onEdit={idx => setModal({ idx })} onRemove={removeStep} />
                      ))}
                    </>
                  )}
                </>
              ) : (
                steps.map((s, i) => (
                  <StepRow key={s.id} step={s} idx={i} total={steps.length}
                    onMove={moveStep} onEdit={idx => setModal({ idx })} onRemove={removeStep} />
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* 저장 버튼 (Runbook 탭 제외) */}
      {activeTab !== 'RUNBOOK' && (
        <div className="flex justify-between items-center">
          <p className="text-xs text-gray-600">
            변경사항은 저장 버튼을 눌러야 반영됩니다.
          </p>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-all">
            <Save className="w-4 h-4" />
            {saving ? '저장 중...' : saved ? '✓ 저장됨' : '절차 저장'}
          </button>
        </div>
      )}

      {/* 탭 렌더링 */}
      {activeTab === 'RUNBOOK' && <RunbookTab />}
    </div>
  )
}
