import React, { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, CheckCircle, XCircle, ShieldAlert } from 'lucide-react'
import { getAiProposals, approveAiProposal, rejectAiProposal } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

const RISK_CLS = {
  HIGH:   'text-red-400 bg-red-500/10 border-red-500/20',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  LOW:    'text-green-400 bg-green-500/10 border-green-500/20',
}

// 승인·실행 결과를 사람이 읽을 수 있는 한 줄로 정리(승인 후 결과가 안 보이던 문제 보완).
function execResultText(p) {
  const status = p?.status
  let log = p?.executionLog
  try { log = typeof log === 'string' ? JSON.parse(log) : log } catch { /* 평문 메시지 */ }
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

/** 대시보드: AI 조치 제안 패널. 좌측 컬럼(넓은 폭)에서 "진행중인 작업" 위에 표시한다.
 *  (과거에는 NEMESIS AI 채팅 패널 안에 끼어 있어 채팅창이 좁아졌음) */
export default function AiProposalPanel({ className = '' }) {
  const { isOperator } = useAuth()
  const [proposals, setProposals] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(() => {
    getAiProposals('PENDING').then(r => setProposals(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    const tick = () => { if (alive) load() }
    tick()
    const id = setInterval(tick, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [load])

  async function decide(p, approve) {
    if ((p.requiresManual || p.blocked) && approve &&
        !window.confirm('최고위험 또는 조사차단 제안입니다. 명령을 직접 확인했으며 실행을 승인합니까?')) return
    setBusy(true)
    try {
      const res = await (approve ? approveAiProposal(p.id) : rejectAiProposal(p.id))
      setResult(approve ? execResultText(res.data) : { ok: true, text: '제안을 거부했습니다.' })
      load()
    } catch (e) {
      setResult({ ok: false, text: '처리 실패: ' + (e.response?.data?.error ?? e.message) })
    } finally { setBusy(false) }
  }

  // 대기 중 제안도, 표시할 결과도 없으면 공간을 차지하지 않는다.
  if (proposals.length === 0 && !result) return null

  return (
    <div className={`card-bg rounded-xl p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> AI 조치 제안
          {proposals.length > 0 && <span className="text-[10px] font-normal text-gray-500">({proposals.length})</span>}
        </h3>
      </div>

      {result && (
        <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs
          ${result.ok ? 'border-green-500/30 bg-green-500/10 text-green-200'
                      : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
          {result.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{result.text}</span>
          <button onClick={() => setResult(null)} className="text-gray-400 hover:text-white shrink-0">
            <XCircle size={13} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {proposals.map(p => {
          const actions = p.proposedActions ?? []
          const conf = Math.round((p.confidence ?? 0) * 100)
          return (
            <div key={p.id} className={`rounded-lg border p-3 text-xs ${p.blocked ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{p.triggerType || '제안'}</span>
                  {p.maxRiskLevel === 'HIGH' && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border border-red-500/30 bg-red-500/10 text-red-300">
                      <ShieldAlert size={10} /> 최고위험
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-gray-400">신뢰도 {conf}%</span>
              </div>
              {p.diagnosis && <p className="text-gray-300 mb-1 leading-snug">{p.diagnosis}</p>}
              {p.rootCause && <p className="text-[11px] text-gray-400 mb-2">근본원인: {p.rootCause}</p>}
              {actions.length > 0 && (
                <div className="space-y-1 mb-2">
                  {actions.map((a, i) => (
                    <div key={i} className="leading-snug">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] border ${RISK_CLS[a.riskLevel] || RISK_CLS.LOW}`}>{a.riskLevel || 'LOW'}</span>
                        <span className="text-gray-300">{a.description}</span>
                      </div>
                      {a.command && <code className="block mt-0.5 text-[10px] text-green-400 font-mono break-all">{a.command}</code>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <button disabled={!isOperator || busy} onClick={() => decide(p, true)}
                  title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
                  className="flex items-center gap-1 px-3 py-1 rounded bg-green-600/80 hover:bg-green-600 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                  <CheckCircle size={13} /> 승인·실행
                </button>
                <button disabled={!isOperator || busy} onClick={() => decide(p, false)}
                  title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
                  className="flex items-center gap-1 px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-gray-200 font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                  <XCircle size={13} /> 거부
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
