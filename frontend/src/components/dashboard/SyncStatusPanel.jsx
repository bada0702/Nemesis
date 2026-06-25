import React, { useState } from 'react'
import { Server, CheckCircle2, Zap, Network } from 'lucide-react'
import { triggerFailover } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

// 서버 자원 사용량을 프로그래스 바로 표시(실시간). 70%/90% 임계로 색상 변경.
function MetricBar({ label, pct }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))
  const bar = v >= 90 ? 'bg-red-500' : v >= 70 ? 'bg-amber-400' : 'bg-green-500'
  const txt = v >= 90 ? 'status-red' : v >= 70 ? 'status-orange' : 'text-gray-200'
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-gray-500 uppercase">{label}</span>
        <span className={`font-medium ${txt}`}>{v}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${bar} transition-all duration-500`}
          style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}

export default function SyncStatusPanel({ agents = [], onRefresh }) {
  const { isOperator } = useAuth()
  const [selected, setSelected] = useState(0)
  const [doing, setDoing] = useState(false)

  const agent = agents[selected]
  if (!agent) {
    return (
      <div className="card-bg rounded-xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">이중화 동기화 상태 (실시간)</h3>
        <div className="text-center py-12 text-gray-500 text-sm">
          등록된 클러스터가 없습니다. 먼저 클러스터를 추가하세요.
        </div>
      </div>
    )
  }

  const primary = agent.nodes?.find(n => n.role === 'PRIMARY') ?? null
  const standby = agent.nodes?.find(n => n.role === 'STANDBY') ?? null
  const pm = primary?.metrics ?? {}
  const sm = standby?.metrics ?? {}
  const syncOk = !agent.failoverEvent && primary && standby

  // 동기화 지연(Lag): primary/standby의 마지막 heartbeat 보고 시각 차이로 산출한다.
  // (이전에는 0ms 고정값이었음 — 실제 두 노드의 heartbeat 시각 격차를 표시)
  const lag = (() => {
    const pt = primary?.lastSeenAt ? new Date(primary.lastSeenAt).getTime() : null
    const st = standby?.lastSeenAt ? new Date(standby.lastSeenAt).getTime() : null
    if (pt == null || st == null) return null
    return Math.abs(pt - st)
  })()
  const lagText = lag == null ? '—' : (lag < 1000 ? `${lag}ms` : `${(lag / 1000).toFixed(1)}s`)

  async function handleFailover() {
    if (!standby) { alert('승격 가능한 standby 노드가 없어 수동 전환을 할 수 없습니다.'); return }
    if (!window.confirm(`${agent.clusterName} 수동 Failover를 실행하시겠습니까?\n${primary?.hostname ?? '?'} → ${standby?.hostname}`)) return
    setDoing(true)
    try {
      const res = await triggerFailover(agent.clusterId, {
        fromNodeId: primary?.nodeId,
        toNodeId: standby?.nodeId,
        toHostname: standby?.hostname,
      })
      // 백엔드는 실패/보류도 HTTP 200 + {success:false, status, message}로 응답한다.
      // 응답 본문을 확인해 결과를 알려준다(조용한 무반응 방지).
      const d = res?.data ?? {}
      if (d.success === false) {
        alert(`Failover 불가 (${d.status ?? 'SKIPPED'}): ${d.message ?? '알 수 없는 이유'}`)
      } else {
        alert(`Failover 완료: 새 Primary = ${d.newPrimary ?? standby?.hostname}`)
      }
      onRefresh?.()
    } catch (e) {
      alert('Failover 실행 실패: ' + (e?.response?.data?.message ?? e.message))
    } finally {
      setDoing(false)
    }
  }

  return (
    <div className="card-bg rounded-xl p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-bold text-white">이중화 동기화 상태 (실시간)</h3>
          {agents.length <= 1 && agent && (
            <p className="text-xs text-gray-500 mt-0.5">{agent.clusterName}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {agents.length > 1 && (
            <select
              value={selected}
              onChange={e => setSelected(+e.target.value)}
              className="text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded px-2 py-1 outline-none"
            >
              {agents.map((a, i) => (
                <option key={a.clusterId} value={i}>{a.clusterName}</option>
              ))}
            </select>
          )}
          <a className="text-xs text-gray-500 hover:text-white cursor-pointer">더보기 &gt;</a>
        </div>
      </div>

      {/* Primary / Sync / Standby */}
      <div className="flex justify-between items-center mb-8 relative">
        {/* Primary (VIP 보유 노드) */}
        <div className="text-center w-1/3">
          <span className="text-[10px] status-green font-bold">PRIMARY</span>
          <p className="text-lg font-bold text-white">{primary?.hostname ?? '—'}</p>
          <p className="text-xs text-gray-500 mb-4">{primary?.serviceIp ?? primary?.heartbeatIp ?? ''}</p>
          <div className="flex justify-center">
            <div className="relative w-24 h-16 bg-blue-900/30 rounded border border-blue-500/50 flex items-center justify-center">
              <Server className="w-10 h-10 text-blue-400" />
              {agent.vip && primary && (
                <span
                  title={`VIP ${agent.vip} 적용됨`}
                  className="absolute -top-2 -right-2 flex items-center gap-0.5 bg-emerald-500/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">
                  <Network className="w-3 h-3" /> VIP
                </span>
              )}
            </div>
          </div>
          {agent.vip && primary && (
            <p className="mt-1 text-[10px] text-emerald-400 font-mono">{agent.vip}</p>
          )}
        </div>

        {/* Sync indicator */}
        <div className="flex-1 flex flex-col items-center px-4">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-sm font-bold text-white">실시간 동기화</span>
            <CheckCircle2 className={`w-4 h-4 ${syncOk ? 'status-green' : 'status-red'}`} />
          </div>
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden relative">
            {syncOk ? (
              <>
                {/* 연결 유지 표시용 옅은 베이스 + 흐르는 로딩 세그먼트 */}
                <div className="absolute inset-0 bg-green-500/15 rounded-full" />
                <div className="sync-bar-fill" />
              </>
            ) : (
              <div className="h-full rounded-full bg-red-500/80" style={{ width: '30%' }} />
            )}
          </div>
          {syncOk && (
            <div className="flex justify-center mt-2 space-x-1">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="w-1 h-1 bg-green-500 rounded-full animate-pulse"
                  style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          )}
        </div>

        {/* Standby */}
        <div className="text-center w-1/3">
          <span className="text-[10px] text-blue-400 font-bold">STANDBY</span>
          <p className="text-lg font-bold text-white">{standby?.hostname ?? '—'}</p>
          <p className="text-xs text-gray-500 mb-4">{standby?.serviceIp ?? standby?.heartbeatIp ?? ''}</p>
          <div className="flex justify-center">
            <div className="w-24 h-16 bg-gray-800 rounded border border-gray-700 flex items-center justify-center">
              <Server className="w-10 h-10 text-gray-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Metrics table */}
      <div className="grid grid-cols-3 gap-8">
        <div className="space-y-3 text-xs">
          <MetricBar label="CPU"  pct={pm.cpuPercent} />
          <MetricBar label="MEM"  pct={pm.memoryPercent} />
          <MetricBar label="DISK" pct={pm.diskPercent} />
        </div>
        <div className="space-y-2 text-xs px-4">
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-500">동기화 상태</span>
            <span className={`font-medium ${syncOk ? 'status-green' : 'status-red'}`}>
              {syncOk ? 'SYNC OK' : 'DEGRADED'}
            </span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1"
            title="Primary·Standby의 마지막 heartbeat 보고 시각 차이">
            <span className="text-gray-500">지연 시간 (Lag)</span>
            <span className="text-white font-medium">{lagText}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-500">마지막 동기화</span>
            <span className="text-white font-medium">
              {primary?.lastSeenAt
                ? new Date(primary.lastSeenAt).toLocaleTimeString('ko-KR')
                : '—'}
            </span>
          </div>
        </div>
        <div className="space-y-3 text-xs">
          <MetricBar label="CPU"  pct={sm.cpuPercent} />
          <MetricBar label="MEM"  pct={sm.memoryPercent} />
          <MetricBar label="DISK" pct={sm.diskPercent} />
        </div>
      </div>

      {/* VIP & Failover */}
      <div className="mt-8 flex items-center justify-between bg-black/20 p-4 rounded-lg">
        <div className="flex space-x-12">
          <div>
            <p className="text-[10px] text-gray-500 uppercase mb-1">가상 IP (VIP)</p>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-white">{agent.vip || '—'}</span>
              {agent.vip && (
                agent.vipActive
                  ? <span className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded font-bold">ACTIVE</span>
                  : <span className="bg-gray-700/60 text-gray-500 text-[10px] px-1.5 py-0.5 rounded font-bold">INACTIVE</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase mb-1">클러스터 모드</p>
            <p className="text-sm font-bold text-white">Active / Standby</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase mb-1">클러스터명</p>
            <p className="text-sm font-bold text-white">{agent.clusterName}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase mb-1">마지막 상태 변경</p>
            <p className="text-sm font-bold text-white">
              {agent.failoverEvent?.occurredAt
                ? new Date(agent.failoverEvent.occurredAt).toLocaleString('ko-KR')
                : '변경 없음'}
            </p>
          </div>
        </div>
        <button
          onClick={handleFailover}
          disabled={doing || !isOperator || !standby}
          title={!isOperator ? 'operator 이상 권한이 필요합니다'
            : !standby ? '승격 가능한 standby 노드가 없습니다' : ''}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center"
        >
          <Zap className="w-4 h-4 mr-2" />
          {doing ? '실행 중...' : '수동 전환(Failover)'}
        </button>
      </div>
    </div>
  )
}
