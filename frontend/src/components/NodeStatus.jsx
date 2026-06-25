import React, { useState } from 'react'
import {
  Crown, Shield, AlertCircle, RefreshCw, BookOpen, ArrowRightLeft,
  Zap, Activity, Terminal, Wrench, LogIn, Play, ChevronDown,
  AlertTriangle, WifiOff, X, Loader2,
} from 'lucide-react'
import { executeAgentCommand, triggerFailover } from '../api/client'

// ── 상수 ──────────────────────────────────────────────────────
const ROLE_CFG = {
  PRIMARY:    { label: 'PRIMARY',  Icon: Crown,       color: 'blue'   },
  STANDBY:    { label: 'STANDBY',  Icon: Shield,      color: 'gray'   },
  FAULT:      { label: 'FAULT',    Icon: AlertCircle, color: 'red'    },
  RECOVERING: { label: 'RECOVERY', Icon: RefreshCw,   color: 'yellow' },
}

const COLOR = {
  blue:   { badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',      border: 'border-blue-500/30'    },
  gray:   { badge: 'bg-gray-500/15 text-gray-400 border-gray-600',          border: 'border-gray-700'       },
  red:    { badge: 'bg-red-500/15 text-red-400 border-red-500/30',          border: 'border-red-500/30'     },
  yellow: { badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', border: 'border-yellow-500/30'  },
}

const RUNBOOK = [
  {
    group: '진단',
    actions: [
      { id: 'health',      Icon: Activity,       label: 'Health Check',         desc: '노드 전체 상태 점검 실행',        risk: 'safe'    },
      { id: 'logs',        Icon: Terminal,       label: 'View Recent Logs',     desc: '최근 100줄 시스템 로그 조회',     risk: 'safe'    },
      { id: 'replication', Icon: RefreshCw,      label: 'Check Replication',    desc: '복제 상태 및 지연(lag) 확인',     risk: 'safe'    },
    ],
  },
  {
    group: '운영',
    actions: [
      { id: 'restart',     Icon: RefreshCw,      label: 'Restart Service',      desc: '노드 서비스 재시작 (10~30초)',     risk: 'warning' },
      { id: 'maintenance', Icon: Wrench,         label: 'Maintenance Mode',     desc: '유지보수 모드 전환 (트래픽 차단)', risk: 'warning' },
      { id: 'join',        Icon: LogIn,          label: 'Join Cluster',         desc: '정지된 노드를 클러스터에 재참여',  risk: 'warning' },
    ],
  },
  {
    group: '긴급',
    actions: [
      { id: 'failover',    Icon: ArrowRightLeft, label: 'Manual Failover',      desc: '현재 노드 강제 Failover 실행',    risk: 'danger'  },
      { id: 'fence',       Icon: Zap,            label: 'Force Fence (STONITH)', desc: '노드 강제 격리 (STONITH) 실행',  risk: 'danger'  },
    ],
  },
]

const RISK_STYLE = {
  safe:    { badge: 'bg-green-500/10 text-green-400 border-green-500/30',    btn: 'bg-green-600/20 hover:bg-green-600/35 text-green-300 border-green-500/40'   },
  warning: { badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30', btn: 'bg-yellow-600/20 hover:bg-yellow-600/35 text-yellow-300 border-yellow-500/40' },
  danger:  { badge: 'bg-red-500/10 text-red-400 border-red-500/30',          btn: 'bg-red-600/20 hover:bg-red-600/35 text-red-300 border-red-500/40'           },
}
const RISK_LABEL = { safe: 'SAFE', warning: 'CAUTION', danger: 'DANGER' }

// ── 메트릭 바 ─────────────────────────────────────────────────
function MetricBar({ label, value }) {
  const pct   = Math.min(value ?? 0, 100)
  const color = pct > 85 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-gray-500 uppercase tracking-widest">{label}</span>
        <span className={`font-mono font-bold ${pct > 85 ? 'text-red-400' : pct > 70 ? 'text-yellow-400' : 'text-gray-300'}`}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// 액션별 에이전트 명령.
// 에이전트는 화이트리스트 스크립트(control.sh)로 시작하는 명령만 허용한다.
// raw 셸 명령(uptime/free/tail/mmgetstate 등)은 "허용되지 않은 명령"으로 403 거부되므로,
// 모든 작업을 control.sh 서브커맨드로 라우팅한다.
const ACTION_CMD = {
  health:      () => 'control.sh health',
  logs:        () => 'control.sh logs',
  replication: () => 'control.sh replication',
  restart:     (svc) => `control.sh svc-restart ${svc}`,   // 단일 명령(과거 && 복합명령은 shell 미사용 실행이라 깨졌음)
  join:        () => 'control.sh cluster-join',
  maintenance: () => 'control.sh maintenance',
}

// ── 런북 패널 ─────────────────────────────────────────────────
function RunbookPanel({ node, clusterId, onClose }) {
  const [pending,    setPending]    = useState(null)
  const [running,    setRunning]    = useState(null)
  const [results,    setResults]    = useState({})
  const [svcInput,   setSvcInput]   = useState('')
  const [svcPrompt,  setSvcPrompt]  = useState(false)

  async function execute(action) {
    // 위험 작업: 첫 클릭 = 확인 대기
    if (action.risk === 'danger' && pending !== action.id) {
      setPending(action.id)
      return
    }
    setPending(null)

    // 서비스 재시작: 서비스명 입력 필요
    if (action.id === 'restart') {
      if (!svcPrompt) { setSvcPrompt(true); return }
      if (!svcInput.trim()) return
      setSvcPrompt(false)
    }

    // 수동 Failover: 기존 triggerFailover API 사용
    if (action.id === 'failover') {
      if (!clusterId) { setResults(p => ({ ...p, failover: { ok: false, output: 'clusterId 없음' } })); return }
      setRunning('failover')
      try {
        await triggerFailover(clusterId, { fromNodeId: node.nodeId })
        setResults(p => ({ ...p, failover: { ok: true, output: 'Failover 트리거 완료' } }))
      } catch (e) {
        setResults(p => ({ ...p, failover: { ok: false, output: e?.response?.data?.message ?? e.message } }))
      } finally { setRunning(null) }
      return
    }

    // STONITH
    if (action.id === 'fence') {
      setResults(p => ({ ...p, fence: { ok: false, output: 'STONITH 미구현 — 하드웨어 IPMI/iDRAC 연동 필요' } }))
      return
    }

    // 에이전트 명령 실행
    const cmdFn = ACTION_CMD[action.id]
    if (!cmdFn) return
    const cmd = action.id === 'restart' ? cmdFn(svcInput) : cmdFn()

    setRunning(action.id)
    try {
      const res = await executeAgentCommand(node.nodeId, { command: cmd })
      const out = res.data?.stdout || res.data?.stderr || '(출력 없음)'
      const ok  = (res.data?.exitCode ?? 0) === 0
      setResults(p => ({ ...p, [action.id]: { ok, output: out } }))
    } catch (e) {
      setResults(p => ({ ...p, [action.id]: { ok: false, output: e?.response?.data?.error ?? e.message } }))
    } finally {
      setRunning(null)
      setSvcInput('')
    }
  }

  return (
    <div className="mt-3 border-t border-gray-800 pt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Runbook</span>
          <span className="text-[9px] text-gray-600 font-mono border border-gray-800 rounded px-1.5">{node.hostname}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-4">
        {RUNBOOK.map(({ group, actions }) => (
          <div key={group}>
            <p className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.15em] mb-2">{group}</p>
            <div className="space-y-1.5">
              {actions.map(action => {
                const rs     = RISK_STYLE[action.risk]
                const isRun  = running === action.id
                const result = results[action.id]
                const isPend = pending === action.id
                const AIcon  = action.Icon

                return (
                  <div key={action.id} className="bg-gray-900/60 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <AIcon className={`w-3.5 h-3.5 shrink-0 ${
                        action.risk === 'safe' ? 'text-green-500' :
                        action.risk === 'warning' ? 'text-yellow-500' : 'text-red-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-gray-300">{action.label}</span>
                          <span className={`text-[8px] font-bold border rounded px-1 ${rs.badge}`}>
                            {RISK_LABEL[action.risk]}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-600 mt-0.5">{action.desc}</p>
                      </div>

                      {!result && (
                        <button onClick={() => execute(action)} disabled={isRun}
                          className={`shrink-0 flex items-center gap-1 text-[10px] font-bold border rounded px-2.5 py-1 transition-all ${rs.btn} disabled:opacity-40`}>
                          {isRun
                            ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> 실행 중</>
                            : isPend
                              ? <span className="text-red-300">확인 →</span>
                              : <><Play className="w-2.5 h-2.5" /> 실행</>}
                        </button>
                      )}
                    </div>

                    {/* 서비스 재시작: 서비스명 입력 */}
                    {action.id === 'restart' && svcPrompt && !result && (
                      <div className="mt-2 flex gap-2">
                        <input value={svcInput} onChange={e => setSvcInput(e.target.value)}
                          placeholder="서비스명 (예: nginx, oracle)"
                          className="flex-1 px-2 py-1 text-[10px] bg-gray-800 border border-gray-700 rounded text-white outline-none" />
                        <button onClick={() => execute(action)} disabled={!svcInput.trim()}
                          className="px-2 py-1 text-[10px] bg-yellow-600/30 border border-yellow-500/30 text-yellow-300 rounded hover:bg-yellow-600/50 disabled:opacity-40">
                          실행
                        </button>
                        <button onClick={() => { setSvcPrompt(false); setSvcInput('') }}
                          className="px-2 py-1 text-[9px] text-gray-600 hover:text-gray-400">취소</button>
                      </div>
                    )}

                    {isPend && (
                      <div className="mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded px-2.5 py-1.5">
                        <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                        <span className="text-[10px] text-red-300 flex-1">위험 작업입니다. 다시 한 번 '실행'을 누르면 즉시 실행됩니다.</span>
                        <button onClick={() => setPending(null)} className="text-[9px] text-gray-600 hover:text-gray-400">취소</button>
                      </div>
                    )}

                    {result && (
                      <div className={`mt-2 rounded px-2.5 py-2 ${result.ok ? 'bg-emerald-500/5 border border-emerald-500/15' : 'bg-red-500/5 border border-red-500/15'}`}>
                        <pre className="text-[9px] font-mono text-gray-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{result.output}</pre>
                        <button onClick={() => setResults(p => { const n = { ...p }; delete n[action.id]; return n })}
                          className="mt-1 text-[9px] text-gray-600 hover:text-gray-400">닫기</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function NodeStatus({ node, clusterId }) {
  const rc   = ROLE_CFG[node.role] ?? ROLE_CFG.STANDBY
  const col  = COLOR[rc.color]
  const isUp = node.state === 'RUNNING'
  const RoleIcon = rc.Icon

  return (
    <div className={`card-bg rounded-xl p-5 border ${col.border} transition-all`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${col.border} bg-gray-900/50`}>
            <RoleIcon className={`w-4 h-4 ${col.badge.split(' ')[1]}`} />
          </div>
          <div>
            <p className="text-sm font-bold text-white">{node.hostname}</p>
            <p className="text-[10px] font-mono text-gray-500">{node.ipAddress ?? node.nodeId}</p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 text-[10px] font-bold border rounded px-2 py-1 ${col.badge}`}>
          <RoleIcon className="w-3 h-3" />
          {rc.label}
        </div>
      </div>

      {/* 상태 바 */}
      <div className="flex items-center gap-2 mb-4 bg-gray-900/40 rounded-lg px-3 py-2">
        <span className={`w-2 h-2 rounded-full ${isUp ? 'bg-green-400' : 'bg-gray-600'}`} />
        <span className={`text-[10px] font-bold ${isUp ? 'text-green-400' : 'text-gray-600'}`}>
          {node.state ?? (isUp ? 'RUNNING' : 'STOPPED')}
        </span>
        {node.osType && <span className="ml-auto text-[10px] text-gray-600 font-mono">{node.osType}</span>}
      </div>

      {/* 런북 (항상 펼침) */}
      <RunbookPanel node={node} clusterId={clusterId} />
    </div>
  )
}
