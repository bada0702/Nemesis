import React, { useEffect, useState, useCallback } from 'react'
import { Bot, RefreshCw, AlertTriangle, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react'
import { getAiFindings, getAiProposals, approveAiProposal, rejectAiProposal } from '../api/client'

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

function FindingCard({ f, predictive }) {
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
      {f.diagnosis && <p className="text-[11px] text-gray-400 mb-1">{f.diagnosis}</p>}
      <p className="text-[10px] text-gray-500">최근: {fmt(f.lastSeenAt)}</p>
    </div>
  )
}

function ProposalCard({ p, onDecide, busy }) {
  let actions = []
  try { actions = typeof p.proposedActions === 'string' ? JSON.parse(p.proposedActions) : (p.proposedActions || []) }
  catch { actions = [] }
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-white">{p.triggerType || '제안'}</span>
        <span className="text-[10px] text-gray-400">신뢰도 {Math.round((p.confidence || 0) * 100)}%</span>
      </div>
      {p.diagnosis && <p className="text-xs text-gray-300 mb-1">{p.diagnosis}</p>}
      {p.rootCause && <p className="text-[11px] text-gray-400 mb-2">근본원인: {p.rootCause}</p>}
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
        <button disabled={busy} onClick={() => onDecide(p.id, true)}
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

export default function AiOpsCenter() {
  const [tab, setTab] = useState('reactive')
  const [reactive, setReactive] = useState([])
  const [predictive, setPredictive] = useState([])
  const [proposals, setProposals] = useState([])
  const [busy, setBusy] = useState(false)

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
    try { await (approve ? approveAiProposal(id) : rejectAiProposal(id)); load() }
    finally { setBusy(false) }
  }

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
            : reactive.map(f => <FindingCard key={f.id} f={f} />)}
        </div>
      )}
      {tab === 'predictive' && (
        <div className="grid gap-3 md:grid-cols-2">
          {predictive.length === 0
            ? <p className="text-sm text-gray-500">예측된 장애 위험이 없습니다.</p>
            : predictive.map(f => <FindingCard key={f.id} f={f} predictive />)}
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
