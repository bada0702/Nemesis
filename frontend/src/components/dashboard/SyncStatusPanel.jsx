import React, { useState } from 'react'
import { Server, CheckCircle2, Zap } from 'lucide-react'
import { triggerFailover } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'

function MetricRow({ label, value }) {
  return (
    <div className="flex justify-between border-b border-gray-800 pb-1">
      <span className="text-gray-500 uppercase">{label}</span>
      <span className="text-white font-medium">{value}</span>
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

  async function handleFailover() {
    if (!window.confirm(`${agent.clusterName} 수동 Failover를 실행하시겠습니까?`)) return
    setDoing(true)
    try {
      await triggerFailover(agent.clusterId, {
        fromNodeId: primary?.nodeId,
        toNodeId: standby?.nodeId,
        toHostname: standby?.hostname,
      })
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
        {/* Primary */}
        <div className="text-center w-1/3">
          <span className="text-[10px] status-green font-bold">PRIMARY</span>
          <p className="text-lg font-bold text-white">{primary?.hostname ?? '—'}</p>
          <p className="text-xs text-gray-500 mb-4">{primary?.serviceIp ?? primary?.heartbeatIp ?? ''}</p>
          <div className="flex justify-center">
            <div className="w-24 h-16 bg-blue-900/30 rounded border border-blue-500/50 flex items-center justify-center">
              <Server className="w-10 h-10 text-blue-400" />
            </div>
          </div>
        </div>

        {/* Sync indicator */}
        <div className="flex-1 flex flex-col items-center px-4">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-sm font-bold text-white">실시간 동기화</span>
            <CheckCircle2 className={`w-4 h-4 ${syncOk ? 'status-green' : 'status-red'}`} />
          </div>
          <div className="w-full h-2 bg-gray-800 rounded-full flex overflow-hidden">
            <div className={`h-full rounded-full ${syncOk ? 'bg-green-500/80 animate-pulse' : 'bg-red-500/80'}`}
              style={{ width: syncOk ? '100%' : '30%' }} />
          </div>
          {syncOk && (
            <div className="flex justify-center mt-2 space-x-1">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="w-1 h-1 bg-green-500 rounded-full" />
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
        <div className="space-y-2 text-xs">
          <MetricRow label="CPU"  value={`${pm.cpuPercent?.toFixed(0) ?? 0}%`} />
          <MetricRow label="MEM"  value={`${pm.memoryPercent?.toFixed(0) ?? 0}%`} />
          <MetricRow label="DISK" value={`${pm.diskPercent?.toFixed(0) ?? 0}%`} />
        </div>
        <div className="space-y-2 text-xs px-4">
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-500">동기화 상태</span>
            <span className={`font-medium ${syncOk ? 'status-green' : 'status-red'}`}>
              {syncOk ? 'SYNC OK' : 'DEGRADED'}
            </span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-500">지연 시간 (Lag)</span>
            <span className="text-white font-medium">0ms</span>
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
        <div className="space-y-2 text-xs">
          <MetricRow label="CPU"  value={`${sm.cpuPercent?.toFixed(0) ?? 0}%`} />
          <MetricRow label="MEM"  value={`${sm.memoryPercent?.toFixed(0) ?? 0}%`} />
          <MetricRow label="DISK" value={`${sm.diskPercent?.toFixed(0) ?? 0}%`} />
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
                <span className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded font-bold">ACTIVE</span>
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
          disabled={doing || !isOperator}
          title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center"
        >
          <Zap className="w-4 h-4 mr-2" />
          {doing ? '실행 중...' : '수동 전환(Failover)'}
        </button>
      </div>
    </div>
  )
}
