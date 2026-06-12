import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cpu, Bot, Send, User } from 'lucide-react'
import { aiChat } from '../../api/client'

export default function AiPanel({ messages, className = '' }) {
  const [input,    setInput]    = useState('')
  const [history,  setHistory]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const bottomRef  = useRef(null)
  const navigate   = useNavigate()
  const list       = messages ?? []

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

      <div className="flex-1 bg-black/20 rounded-lg p-4 mb-4 text-xs overflow-y-auto max-h-64 space-y-3">
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
