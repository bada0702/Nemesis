import React, { useEffect, useState, useCallback } from 'react'
import { Bot, RefreshCw, AlertTriangle, TrendingUp, CheckCircle, XCircle, Clock, ShieldAlert, Ban, RotateCw, EyeOff, Trash2 } from 'lucide-react'
import { getAiFindings, getAiProposals, approveAiProposal, rejectAiProposal,
  reanalyzeAiFinding, ignoreAiFinding, deleteAiFinding } from '../api/client'

const SEV_CLS = {
  CRITICAL: 'border-red-600/50 bg-red-500/10 text-red-300',
  HIGH:     'border-red-500/40 bg-red-500/5 text-red-300',
  WARN:     'border-amber-500/40 bg-amber-500/5 text-amber-300',
  INFO:     'border-sky-500/40 bg-sky-500/5 text-sky-300',
}
const RISK_CLS = {
  HIGH:   'text-red-400 bg-red-500/10 border-red-500/20',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  LOW:    'text-green-400 bg-green-500/10 border-green-500/20',
}
const fmt = (w) => (w ? new Date(w).toLocaleString('ko-KR') : '—')

function etaText(detail) {
  try {
    const d = typeof detail === 'string' ? JSON.parse(detail) : (detail || {})
    if (d.etaMinutes == null) return ''
    const m = Number(d.etaMinutes)
    const when = m < 60 ? `약 ${m}분 내` : `약 ${Math.round(m / 60)}시간 내`
    const cur = d.current != null ? `현재 ${Number(d.current).toFixed(1)}% → ` : ''
    const tgt = d.target != null ? `${d.target}% 도달` : '임계 도달'
    return `${cur}${when} ${tgt}`
  } catch { return '' }
}

function SevBadge({ sev }) {
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${SEV_CLS[sev] || SEV_CLS.INFO}`}>{sev}</span>
}

function FindingCard({ f, predictive, onReanalyze, onIgnore, onDelete, busy }) {
  const failed = typeof f.diagnosis === 'string' && f.diagnosis.startsWith('AI 분석 실패')
  return (
    <div className={`rounded-xl border p-4 ${SEV_CLS[f.severity] || SEV_CLS.INFO}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-white">{f.signalType}</span>
        <SevBadge sev={f.severity} />
      </div>
      {predictive && etaText(f.detail) && (
        <p className="text-xs text-amber-200 mb-1">⏳ {etaText(f.detail)}</p>
      )}
      {f.summary && <p className="text-xs text-gray-300 mb-1">{f.summary}</p>}
      {f.diagnosis && (
        <p className={`text-[11px] mb-1 ${failed ? 'text-red-300' : 'text-gray-400'}`}>
          {failed ? '⚠ ' : ''}{f.diagnosis}
        </p>
      )}
      <p className="text-[10px] text-gray-500 mb-2">최근: {fmt(f.lastSeenAt)}</p>
      <div className="flex gap-1.5">
        <button disabled={busy} onClick={() => onReanalyze(f.id)}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-sky-600/70 hover:bg-sky-600 text-white text-[11px] font-bold disabled:opacity-50">
          <RotateCw size={12} /> 재분석
        </button>
        <button disabled={busy} onClick={() => onIgnore(f.id)}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-gray-200 text-[11px] font-bold disabled:opacity-50">
          <EyeOff size={12} /> 무시
        </button>
        <button disabled={busy} onClick={() => { if (window.confirm('이 항목을 삭제할까요?')) onDelete(f.id) }}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-600/20 hover:bg-red-600/40 text-red-300 text-[11px] font-bold disabled:opacity-50">
          <Trash2 size={12} /> 삭제
        </button>
      </div>
    </div>
  )
}

function ProposalCard({ p, onDecide, busy }) {
  let actions = []
  try { actions = typeof p.proposedActions === 'string' ? JSON.parse(p.proposedActions) : (p.proposedActions || []) }
  catch { actions = [] }
  const conf = Math.round((p.confidence || 0) * 100)
  return (
    <div className={`rounded-xl border p-4 ${p.blocked ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/5'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white">{p.triggerType || '제안'}</span>
          {p.maxRiskLevel === 'HIGH' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border border-red-500/30 bg-red-500/10 text-red-300">
              <ShieldAlert size={10} /> 최고위험
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400">신뢰도 {conf}%</span>
      </div>
      {p.blocked && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
          <Ban size={14} className="text-amber-300 mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-bold text-amber-200">조사 차단 — 자동 조치 권장 안 함</p>
            <p className="text-[10px] text-amber-200/80">{p.blockedReason || '근본 원인을 특정하지 못했습니다. 운영자 직접 확인이 필요합니다.'}</p>
          </div>
        </div>
      )}
      {p.diagnosis && <p className="text-xs text-gray-300 mb-1">{p.diagnosis}</p>}
      {p.rootCause && <p className="text-[11px] text-gray-400 mb-2">근본원인: {p.rootCause}</p>}
      {p.requiresManual && (
        <p className="mb-2 text-[10px] text-red-300/90">⚠ 변경 위험 등급(Change Control) 조치 포함 — 승인 전 명령을 직접 검토하세요.</p>
      )}
      {actions.length > 0 && (
        <div className="space-y-1 mb-3">
          {actions.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[9px] border ${RISK_CLS[a.riskLevel] || RISK_CLS.LOW}`}>{a.riskLevel || 'LOW'}</span>
              <code className="text-[11px] text-green-400 font-mono break-all">{a.command}</code>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => {
            if ((p.requiresManual || p.blocked) &&
                !window.confirm('최고위험 또는 조사차단 제안입니다. 명령을 직접 확인했으며 실행을 승인합니까?')) return
            onDecide(p.id, true)
          }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600/80 hover:bg-green-600 text-white text-xs font-bold disabled:opacity-50">
          <CheckCircle size={14} /> 승인·실행
        </button>
        <button disabled={busy} onClick={() => onDecide(p.id, false)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-200 text-xs font-bold disabled:opacity-50">
          <XCircle size={14} /> 거부
        </button>
      </div>
    </div>
  )
}

const TABS = [
  { key: 'reactive',   label: '현황·에러',  Icon: AlertTriangle },
  { key: 'predictive', label: '장애 예측',  Icon: TrendingUp },
  { key: 'approval',   label: '검토 승인',  Icon: CheckCircle },
]

// 승인·실행 결과를 사람이 읽을 수 있는 한 줄로 정리한다.
function execResultText(p) {
  const status = p?.status
  let log = p?.executionLog
  try { log = typeof log === 'string' ? JSON.parse(log) : log } catch { /* 평문 메시지 그대로 */ }
  if (status === 'SUCCEEDED') {
    const v = (log && typeof log === 'object') ? (log.verification || '') : ''
    return { ok: true, text: '조치가 정상 실행되었습니다.' + (v ? ` (${v})` : '') }
  }
  if (status === 'FAILED') {
    const msg = (log && typeof log === 'object') ? (log.verification || log.status || '실행 실패') : (log || '실행 실패')
    return { ok: false, text: '조치 실행에 실패했습니다 — ' + msg }
  }
  return { ok: status !== 'REJECTED', text: `상태: ${status}` }
}

export default function AiOpsCenter() {
  const [tab, setTab] = useState('reactive')
  const [reactive, setReactive] = useState([])
  const [predictive, setPredictive] = useState([])
  const [proposals, setProposals] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // 승인·실행 결과 배너

  const load = useCallback(() => {
    getAiFindings('OPEN', 'REACTIVE').then(r => setReactive(r.data || [])).catch(() => {})
    getAiFindings('OPEN', 'PREDICTIVE').then(r => setPredictive(r.data || [])).catch(() => {})
    getAiProposals('PENDING').then(r => setProposals(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  async function decide(id, approve) {
    setBusy(true)
    try {
      const res = await (approve ? approveAiProposal(id) : rejectAiProposal(id))
      // 승인 시 백엔드가 실행까지 마친 최종 제안(status/executionLog)을 돌려준다 → 결과를 화면에 표시.
      if (approve) {
        const r = execResultText(res.data)
        setResult(r)
      } else {
        setResult({ ok: true, text: '제안을 거부했습니다.' })
      }
      load()
    } catch (e) {
      setResult({ ok: false, text: '처리 실패: ' + (e.response?.data?.error ?? e.message) })
    } finally { setBusy(false) }
  }

  async function onReanalyze(id) {
    setBusy(true)
    try { await reanalyzeAiFinding(id) } catch (e) { /* 실패 사유는 diagnosis로 반영됨 */ }
    finally { load(); setBusy(false) }
  }
  async function onIgnore(id) {
    setBusy(true)
    try { await ignoreAiFinding(id) } finally { load(); setBusy(false) }
  }
  async function onDelete(id) {
    setBusy(true)
    try { await deleteAiFinding(id) } finally { load(); setBusy(false) }
  }
  const findingHandlers = { onReanalyze, onIgnore, onDelete, busy }

  const count = { reactive: reactive.length, predictive: predictive.length, approval: proposals.length }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="text-sky-400" size={22} />
        <h1 className="text-lg font-bold text-white">AI 운영</h1>
        <button onClick={load} className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {result && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm
          ${result.ok ? 'border-green-500/30 bg-green-500/10 text-green-200'
                      : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
          {result.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{result.text}</span>
          <button onClick={() => setResult(null)} className="text-gray-400 hover:text-white shrink-0">
            <XCircle size={14} />
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition
              ${tab === key ? 'bg-sky-600/80 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
            <Icon size={15} /> {label}
            {count[key] > 0 && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-black/30">{count[key]}</span>}
          </button>
        ))}
      </div>

      {tab === 'reactive' && (
        <div className="grid gap-3 md:grid-cols-2">
          {reactive.length === 0
            ? <p className="text-sm text-gray-500">열린 에러/이상 징후가 없습니다.</p>
            : reactive.map(f => <FindingCard key={f.id} f={f} {...findingHandlers} />)}
        </div>
      )}
      {tab === 'predictive' && (
        <div className="grid gap-3 md:grid-cols-2">
          {predictive.length === 0
            ? <p className="text-sm text-gray-500">예측된 장애 위험이 없습니다.</p>
            : predictive.map(f => <FindingCard key={f.id} f={f} predictive {...findingHandlers} />)}
        </div>
      )}
      {tab === 'approval' && (
        <div className="grid gap-3 md:grid-cols-2">
          {proposals.length === 0
            ? <p className="text-sm text-gray-500 flex items-center gap-1"><Clock size={14} /> 검토 대기 중인 제안이 없습니다.</p>
            : proposals.map(p => <ProposalCard key={p.id} p={p} onDecide={decide} busy={busy} />)}
        </div>
      )}
    </div>
  )
}
