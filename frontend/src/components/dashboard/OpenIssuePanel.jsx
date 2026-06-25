import React, { useState, useEffect, useCallback } from 'react'
import { Trash2, Wrench } from 'lucide-react'
import { getAiFindings, getAiProposals, deleteAiFinding } from '../../api/client'

const SEV_CLS = {
  CRITICAL: 'border-red-600/50 bg-red-500/10 text-red-300',
  HIGH:     'border-red-500/40 bg-red-500/5 text-red-300',
  WARN:     'border-amber-500/40 bg-amber-500/5 text-amber-300',
  INFO:     'border-sky-500/40 bg-sky-500/5 text-sky-300',
}

/** 대시보드: 실시간 알람 오른쪽에 표시되는 "실시간 로그 분석" 패널.
 *  Nemesis AI가 연 이슈(finding)와, 이슈에 연결된 AI 조치 제안 내용을 함께 보여준다. */
export default function OpenIssuePanel({ className = '' }) {
  const [findings, setFindings] = useState([])
  const [proposals, setProposals] = useState({})   // proposalId -> proposal
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => {
    getAiFindings('OPEN').then(r => setFindings(r.data || [])).catch(() => {})
    // 이슈에 연결된 조치 제안 내용을 함께 표기하기 위해 제안 목록을 id로 매핑한다.
    getAiProposals().then(r => {
      const map = {}
      ;(r.data || []).forEach(p => { map[p.id] = p })
      setProposals(map)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    const tick = () => { if (alive) load() }
    tick()
    const id = setInterval(tick, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [load])

  async function onDelete(id) {
    if (!window.confirm('이 로그 분석 항목을 삭제할까요?')) return
    setBusy(id)
    try { await deleteAiFinding(id) } finally { setBusy(null); load() }
  }

  return (
    <div className={`card-bg rounded-xl p-6 flex flex-col overflow-hidden ${className}`}>
      <div className="flex justify-between items-center mb-3 shrink-0">
        <h3 className="text-sm font-bold text-white whitespace-nowrap truncate">
          실시간 로그 분석
          {findings.length > 0 && <span className="ml-1 text-[10px] font-normal text-gray-500">({findings.length})</span>}
        </h3>
      </div>
      <div className="space-y-1.5 overflow-y-auto flex-1 min-h-0 pr-1">
        {findings.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-xs">분석된 로그 없음</div>
        ) : (
          findings.map(f => {
            const p = f.proposalId ? proposals[f.proposalId] : null
            const actions = p?.proposedActions ?? []
            return (
              <div key={f.id} className={`rounded-lg border px-3 py-2 text-xs ${SEV_CLS[f.severity] ?? 'border-gray-700 bg-gray-800/40 text-gray-300'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{f.signalType}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] opacity-80">{f.severity}</span>
                    <button onClick={() => onDelete(f.id)} disabled={busy === f.id}
                      title="삭제"
                      className="text-gray-500 hover:text-red-400 disabled:opacity-40">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-gray-300 mt-0.5 truncate" title={f.summary}>{f.summary}</p>
                {f.diagnosis && (
                  <p className="text-gray-400 mt-1 text-[11px] leading-snug" title={f.diagnosis}>
                    <span className="text-blue-300">AI</span> {f.diagnosis}
                  </p>
                )}
                {/* AI 조치 제안 내용(조치 방법은 한국어 설명) */}
                {actions.length > 0 && (
                  <div className="mt-1.5 border-t border-white/10 pt-1.5 space-y-1">
                    <p className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                      <Wrench className="w-3 h-3" /> AI 조치 제안
                    </p>
                    {actions.map((a, i) => (
                      <div key={i} className="text-[11px] text-gray-300 leading-snug">
                        <span className="text-amber-200">{i + 1}. {a.description}</span>
                        {a.command && <code className="ml-1 text-[10px] text-blue-300 break-all">{a.command}</code>}
                      </div>
                    ))}
                  </div>
                )}
                {f.proposalId && actions.length === 0 && (
                  <span className="text-[10px] text-amber-300">조치 제안 연결됨 (검토 승인 탭에서 확인)</span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
