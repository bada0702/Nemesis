import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cpu, Bot, Send, User } from 'lucide-react'
import { aiChat, getAiProposals, approveAiProposal, rejectAiProposal, getAiFindings } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

const SEV_CLS = {
  CRITICAL: 'border-red-600/50 bg-red-500/10 text-red-300',
  HIGH:     'border-red-500/40 bg-red-500/5 text-red-300',
  WARN:     'border-amber-500/40 bg-amber-500/5 text-amber-300',
  INFO:     'border-sky-500/40 bg-sky-500/5 text-sky-300',
}

export default function AiPanel({ messages, className = '' }) {
  const [input,    setInput]    = useState('')
  const [history,  setHistory]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const bottomRef  = useRef(null)
  const navigate   = useNavigate()
  const list       = messages ?? []
  const { isOperator } = useAuth()
  const [proposals, setProposals] = useState([])
  const [findings,  setFindings]  = useState([])

  useEffect(() => {
    let alive = true
    const load = () => {
      getAiProposals('PENDING').then(r => { if (alive) setProposals(r.data) }).catch(() => {})
      getAiFindings('OPEN').then(r => { if (alive) setFindings(r.data) }).catch(() => {})
    }
    load()
    const id = setInterval(load, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  async function decide(id, approve) {
    try {
      await (approve ? approveAiProposal(id) : rejectAiProposal(id))
      setHistory(h => [...h, { role: 'ai', text: `제안 ${approve ? '승인' : '거부'} 처리됨 (${id.slice(0,8)})` }])
    } catch (e) {
      setHistory(h => [...h, { role: 'ai', text: '처리 실패: ' + (e.response?.data?.error ?? e.message) }])
    } finally {
      getAiProposals('PENDING').then(r => setProposals(r.data)).catch(() => {})
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, loading])

  async function send() {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    setHistory(h => [...h, { role: 'user', text: msg }])
    setLoading(true)
    try {
      const res = await aiChat(msg)
      setHistory(h => [...h, { role: 'ai', text: res.data.reply }])
    } catch (e) {
      setHistory(h => [...h, { role: 'ai', text: 'AI 응답 실패: ' + (e.response?.data?.error ?? e.message) }])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className={`card-bg rounded-xl p-6 flex flex-col ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold text-blue-400 flex items-center">
          <Cpu className="w-4 h-4 mr-2" />
          NEMESIS AI
        </h3>
        <button onClick={() => navigate('/ai-analysis')} className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">더보기 →</button>
      </div>

      <div className="flex-1 min-h-0 bg-black/20 rounded-lg p-4 mb-4 text-xs overflow-y-auto space-y-3">
        {history.length === 0 && (
          <div className="flex items-start space-x-3">
            <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <p className="text-gray-200">
              {list.length > 0 ? '현재 시스템 분석 결과입니다.' : '안녕하세요! 인프라 관련 질문을 입력하세요.'}
            </p>
          </div>
        )}
        {list.length > 0 && history.length === 0 && (
          <ul className="space-y-3 pl-9 list-disc text-gray-400">
            {list.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
        )}
        {history.map((m, i) => (
          <div key={i} className={`flex items-start space-x-3 ${m.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-gray-600' : 'bg-blue-500'}`}>
              {m.role === 'user' ? <User className="w-3 h-3 text-white" /> : <Bot className="w-4 h-4 text-white" />}
            </div>
            <p className={`text-xs leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-gray-300 text-right' : 'text-gray-200'}`}>
              {m.text}
            </p>
          </div>
        ))}
        {loading && (
          <div className="flex items-start space-x-3">
            <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="flex space-x-1 pt-1">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {findings.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-gray-500">열린 이슈 {findings.length}</p>
          {findings.map(f => (
            <div key={f.id} className={`rounded-lg border px-3 py-2 text-xs ${SEV_CLS[f.severity] ?? 'border-gray-700 bg-gray-800/40 text-gray-300'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{f.signalType}</span>
                <span className="text-[10px] opacity-80">{f.severity}</span>
              </div>
              <p className="text-gray-300 mt-0.5 truncate" title={f.summary}>{f.summary}</p>
              {f.diagnosis && (
                <p className="text-gray-400 mt-1 text-[11px] leading-snug" title={f.diagnosis}>
                  <span className="text-blue-300">AI</span> {f.diagnosis}
                </p>
              )}
              {f.proposalId && (
                <span className="text-[10px] text-amber-300">조치 제안 연결됨 ↓</span>
              )}
            </div>
          ))}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="mb-3 space-y-2">
          {proposals.map(p => (
            <div key={p.id} className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-amber-400">⚠️ AI 조치 제안</span>
                <span className="text-gray-500">신뢰도 {Math.round((p.confidence ?? 0) * 100)}%</span>
              </div>
              <p className="text-gray-300 mb-1">{p.diagnosis}</p>
              {(p.proposedActions ?? []).map((a, i) => (
                <div key={i} className="text-gray-400">
                  • {a.description} <code className="text-blue-300">{a.command}</code>
                  <span className="ml-1 text-[10px] text-amber-300">[{a.riskLevel}]</span>
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <button disabled={!isOperator} onClick={() => decide(p.id, true)}
                  title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
                  className="px-3 py-1 rounded bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed">승인</button>
                <button disabled={!isOperator} onClick={() => decide(p.id, false)}
                  title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
                  className="px-3 py-1 rounded bg-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed">거부</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="AI에게 질문하기... (Enter로 전송)"
          disabled={loading}
          className="w-full bg-gray-800 rounded-lg text-xs py-3 pl-4 pr-10 text-gray-300 outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-400 p-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
