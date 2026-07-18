import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Network, ArrowRightLeft, CheckCircle2, RefreshCw,
  AlertTriangle, Brain, Crown, X,
} from 'lucide-react'
import { getClusterStatus, triggerFailover, getAiAnalysis } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import MetricsChart from '../components/MetricsChart'
import NodeStatus from '../components/NodeStatus'

const MAX_HISTORY = 20
const POLL_MS     = 3000

// ── 수동 Failover 패널 ────────────────────────────────────────
function FailoverPanel({ nodes, clusterId, onClose, onDone }) {
  const [target, setTarget] = useState(null)
  const [step,   setStep]   = useState('select')  // select → confirm → running → done
  const [result, setResult] = useState(null)
  const primary  = nodes.find(n => n.role === 'PRIMARY')
  const standbys = nodes.filter(n => n.role === 'STANDBY' && n.state === 'RUNNING')

  async function execute() {
    if (!target) return
    setStep('running')
    try {
      await new Promise(r => setTimeout(r, 2000))
      const res = await triggerFailover(
        clusterId,
        { fromNodeId: primary?.nodeId, toNodeId: target.nodeId, toHostname: target.hostname }
      )
      setResult(res.data)
      setStep('done')
      setTimeout(onDone, 3000)
    } catch { setStep('select') }
  }

  return (
    <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-red-400" />
          <span className="text-sm font-bold text-red-300">수동 Failover</span>
          <span className="text-[9px] text-red-500 border border-red-500/30 rounded px-1.5 py-0.5 font-bold">DANGER</span>
        </div>
        {step !== 'running' && step !== 'done' && (
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {step === 'select' && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-900/60 rounded-lg p-3">
              <p className="text-[9px] text-gray-600 uppercase tracking-widest mb-1">현재 Primary</p>
              <div className="flex items-center gap-2">
                <Crown className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-sm font-bold text-blue-400">{primary?.hostname ?? '—'}</span>
              </div>
              <p className="text-[10px] font-mono text-gray-600 mt-1">{primary?.ipAddress}</p>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-3">
              <p className="text-[9px] text-gray-600 uppercase tracking-widest mb-2">승격할 Standby 선택</p>
              {standbys.length === 0 ? (
                <p className="text-[11px] text-gray-600">사용 가능한 Standby 없음</p>
              ) : (
                <div className="space-y-1.5">
                  {standbys.map(n => (
                    <button key={n.nodeId} onClick={() => setTarget(n)}
                      className={`w-full flex items-center gap-2 text-left rounded-lg px-2.5 py-1.5 text-[11px] border transition-all
                        ${target?.nodeId === n.nodeId
                          ? 'bg-green-500/15 border-green-500/40 text-green-300'
                          : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${target?.nodeId === n.nodeId ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <span className="font-bold">{n.hostname}</span>
                      <span className="font-mono text-gray-600 text-[10px] ml-auto">{n.ipAddress}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            <p className="text-[11px] text-yellow-300">
              Failover 실행 시 현재 Primary의 서비스가 중단되고 VIP가 선택된 노드로 이전됩니다.
            </p>
          </div>

          <button onClick={() => target && setStep('confirm')} disabled={!target}
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-all
              bg-red-600/20 hover:bg-red-600/35 border border-red-500/40 text-red-300
              disabled:opacity-30 disabled:cursor-not-allowed">
            Failover 실행 준비 →
          </button>
        </>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 mb-3 uppercase tracking-widest">최종 확인</p>
            <div className="flex items-center gap-3 text-sm justify-center">
              <div className="text-center">
                <p className="text-[9px] text-gray-600">FROM (현재 Primary)</p>
                <p className="font-bold text-gray-400">{primary?.hostname}</p>
              </div>
              <ArrowRightLeft className="w-4 h-4 text-red-400" />
              <div className="text-center">
                <p className="text-[9px] text-gray-600">TO (새 Primary)</p>
                <p className="font-bold text-green-400">{target?.hostname}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep('select')}
              className="flex-1 py-2 rounded-lg text-xs font-bold border border-gray-700 text-gray-400 hover:border-gray-600">
              취소
            </button>
            <button onClick={execute}
              className="flex-1 py-2 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-500 text-white">
              지금 Failover 실행
            </button>
          </div>
        </div>
      )}

      {step === 'running' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="w-10 h-10 border-2 border-t-red-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Failover 진행 중...</p>
          <p className="text-[11px] text-gray-600 font-mono">{primary?.hostname} → {target?.hostname}</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="flex items-center gap-3 py-4 bg-green-500/10 border border-green-500/20 rounded-xl px-5">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-sm font-bold text-green-400">Failover 완료</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{result.message}</p>
            <p className="text-[10px] text-gray-600 font-mono mt-1">{result.timestamp}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AI 진단 패널 ──────────────────────────────────────────────
function AiPanel({ clusterId }) {
  const [state, setState] = useState({ loading: false, content: null, severity: null, ts: null, error: null })

  async function run() {
    if (state.loading) return
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await getAiAnalysis(clusterId)
      const d   = res.data
      setState({ loading: false, content: d.analysis, severity: d.severity, ts: new Date().toLocaleTimeString('ko-KR'), error: null })
    } catch {
      setState(s => ({ ...s, loading: false, error: 'AI 분석 요청 실패' }))
    }
  }

  const SEV = {
    critical: { border: 'border-red-500/30',    text: 'text-red-400',    label: '🔴 CRITICAL' },
    warning:  { border: 'border-yellow-500/30', text: 'text-yellow-400', label: '⚠️ WARNING'  },
    ok:       { border: 'border-green-500/20',  text: 'text-green-400',  label: '🟢 NORMAL'   },
  }
  const sc = SEV[state.severity] ?? SEV.ok

  return (
    <div className={`card-bg rounded-xl p-5 border ${state.content ? sc.border : 'border-blue-500/20'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Brain className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold text-white">AI 장애 진단</span>
          {state.severity && (
            <span className={`text-[9px] font-bold border rounded px-1.5 py-0.5 ${sc.border} ${sc.text}`}>
              {sc.label}
            </span>
          )}
          {state.ts && <span className="text-[10px] text-gray-600 font-mono">{state.ts}</span>}
        </div>
        <div className="flex gap-2">
          {state.content && (
            <button onClick={run}
              className="flex items-center gap-1.5 text-[10px] font-bold border border-blue-500/30 text-blue-300 hover:bg-blue-500/10 rounded-lg px-3 py-1.5">
              <RefreshCw className="w-3 h-3" /> 재분석
            </button>
          )}
          {!state.content && !state.loading && (
            <button onClick={run}
              className="flex items-center gap-2 bg-blue-600/20 hover:bg-blue-600/35 border border-blue-500/40 text-blue-300 rounded-lg px-4 py-2 text-xs font-bold">
              <Brain className="w-3.5 h-3.5" /> AI 진단 실행
            </button>
          )}
        </div>
      </div>

      {state.loading && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="w-10 h-10 border-2 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">LLM이 클러스터 상태를 분석 중입니다...</p>
          <p className="text-[11px] text-gray-600 font-mono">장애 로그 · 메트릭 · 복제 상태 분석 중</p>
        </div>
      )}

      {state.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-xs text-red-400">
          {state.error}
        </div>
      )}

      {state.content && !state.loading && (
        <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
          {state.content}
        </div>
      )}

      {!state.content && !state.loading && !state.error && (
        <div className="flex items-center gap-3 py-6 text-gray-600">
          <Brain className="w-7 h-7" />
          <div>
            <p className="text-sm">AI 진단을 실행하면 현재 클러스터 상태를 분석합니다.</p>
            <p className="text-[11px] mt-1">장애 감지 · 근본 원인 추정 · 복구 절차 추천</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function ClusterDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const [status,       setStatus]       = useState(null)
  const [lastSync,     setLastSync]     = useState(null)
  const { isOperator } = useAuth()
  const [failoverOpen, setFailoverOpen] = useState(false)
  const histRef = useRef({})

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await getClusterStatus(id)
        const s   = res.data
        if (cancelled) return
        s.nodes.forEach(node => {
          if (!histRef.current[node.nodeId]) histRef.current[node.nodeId] = { cpu: [], mem: [], disk: [] }
          const h = histRef.current[node.nodeId]
          if (node.metrics) {
            h.cpu.push(node.metrics.cpuPercent)
            h.mem.push(node.metrics.memoryPercent)
            h.disk.push(node.metrics.diskPercent)
            if (h.cpu.length > MAX_HISTORY) { h.cpu.shift(); h.mem.shift(); h.disk.shift() }
          }
        })
        setStatus({ ...s })
        setLastSync(new Date().toLocaleTimeString('ko-KR'))
      } catch (e) { console.error(e) }
    }
    load()
    const iv = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [id])

  if (!status) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">클러스터 정보 로딩 중...</span>
        </div>
      </div>
    )
  }

  const primary    = status.nodes.find(n => n.role === 'PRIMARY')
  const runCount   = status.nodes.filter(n => n.state === 'RUNNING').length
  const faultCount = status.nodes.filter(n => n.role === 'FAULT').length
  const hasFault   = faultCount > 0

  return (
    <div className="p-8 pt-0 space-y-5">
      {/* 브레드크럼 */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 text-xs font-bold">
          <ArrowLeft className="w-3.5 h-3.5" /> 대시보드
        </button>
        <span className="text-gray-700">/</span>
        <span className="text-xs text-gray-400 font-mono">{status.clusterName}</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-3">
            <Network className="w-5 h-5 text-blue-400" />
            {status.clusterName}
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5 font-mono ml-8">
            VIP: {status.vip ?? '—'} — Last sync: {lastSync ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="card-bg rounded-lg px-4 py-2 text-center">
            <p className="text-[9px] text-gray-500 uppercase tracking-widest">Primary</p>
            <p className="text-sm font-bold text-blue-400">{primary?.hostname ?? '—'}</p>
          </div>
          <button onClick={() => setFailoverOpen(v => !v)}
            disabled={!isOperator}
            title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed
              ${failoverOpen
                ? 'bg-red-600/20 border-red-500/50 text-red-300'
                : 'bg-red-600/10 hover:bg-red-600/20 border-red-500/30 text-red-400'}`}>
            <ArrowRightLeft className="w-3.5 h-3.5" />
            수동 Failover
            {hasFault && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          </button>
        </div>
      </div>

      {/* Failover 패널 */}
      {failoverOpen && (
        <FailoverPanel nodes={status.nodes} clusterId={id} onClose={() => setFailoverOpen(false)} onDone={() => setFailoverOpen(false)} />
      )}

      {/* 요약 스탯 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-bg rounded-xl p-4">
          <p className="text-[9px] text-gray-500 uppercase tracking-widest">Total Nodes</p>
          <p className="text-2xl font-bold text-white mt-1">{status.nodes.length}</p>
        </div>
        <div className="card-bg rounded-xl p-4 border border-green-500/20">
          <p className="text-[9px] text-gray-500 uppercase tracking-widest">Running</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{runCount}</p>
        </div>
        <div className={`card-bg rounded-xl p-4 border ${hasFault ? 'border-red-500/30' : 'border-gray-700'}`}>
          <p className="text-[9px] text-gray-500 uppercase tracking-widest">Fault</p>
          <p className={`text-2xl font-bold mt-1 ${hasFault ? 'text-red-400' : 'text-gray-600'}`}>{faultCount}</p>
        </div>
      </div>

      {/* AI 진단 */}
      <AiPanel clusterId={id} />

      {/* 노드 상태 */}
      <div>
        <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> Node Status
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* PRIMARY를 항상 좌측에 고정 (백엔드가 반환하는 노드 순서는 role과 무관) */}
          {[...status.nodes].sort((a, b) => (a.role === 'PRIMARY' ? -1 : b.role === 'PRIMARY' ? 1 : 0))
            .map(node => <NodeStatus key={node.nodeId} node={node} clusterId={id} />)}
        </div>
      </div>
    </div>
  )
}
