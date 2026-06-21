import React, { useCallback, useEffect, useState } from 'react'
import {
  getClusters, getClusterStatus, getClusterVipStatus,
  getDashboardSummary, getDashboardSwStatus, getDashboardAlerts,
  getDashboardDocker, getRunbook,
} from '../api/client'
import { OverallStatusCard, CountCard } from '../components/dashboard/StatusCards'
import SyncStatusPanel       from '../components/dashboard/SyncStatusPanel'
import AlarmPanel            from '../components/dashboard/AlarmPanel'
import DbPanel               from '../components/dashboard/DbPanel'
import SwPanel               from '../components/dashboard/SwPanel'
import DockerPanel           from '../components/dashboard/DockerPanel'
import RunbookProgressPanel  from '../components/dashboard/RunbookProgressPanel'
import AiPanel               from '../components/dashboard/AiPanel'

const POLL_MS = 5000

// 실시간 알람 누적 로그: 폴링마다 덮어쓰지 않고 새 알람만 추가해 쌓는다.
// (level|message)로 중복 제거, 최신 우선, 최대 200건, localStorage로 새로고침에도 보존.
const ALARM_KEY = 'nemesis_alarm_log'
const ALARM_MAX = 200
const alarmKey = a => `${a.level}|${a.message}`

function loadAlarmLog() {
  try { return JSON.parse(localStorage.getItem(ALARM_KEY) || '[]') } catch { return [] }
}

function mergeAlarms(prev, incoming) {
  const seen = new Set(prev.map(alarmKey))
  const now = new Date().toISOString()
  const additions = (incoming || [])
    .filter(a => a && a.message && !seen.has(alarmKey(a)))
    .map(a => ({ ...a, ts: a.createdAt || now }))
  if (additions.length === 0) return prev
  const merged = [...additions, ...prev].slice(0, ALARM_MAX)
  try { localStorage.setItem(ALARM_KEY, JSON.stringify(merged)) } catch { /* ignore quota */ }
  return merged
}

export default function Dashboard() {
  const [agents,  setAgents]  = useState([])
  const [summary, setSummary] = useState(null)
  const [swItems, setSwItems] = useState([])
  const [alerts,  setAlerts]  = useState(loadAlarmLog)
  const [docker,  setDocker]  = useState([])
  const [runbook, setRunbook] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [listRes, sumRes, swRes, alRes, dkRes, rbRes] = await Promise.allSettled([
        getClusters(),
        getDashboardSummary(),
        getDashboardSwStatus(),
        getDashboardAlerts(),
        getDashboardDocker(),
        getRunbook(),
      ])

      if (listRes.status === 'fulfilled') {
        const statusData = await Promise.all(
          listRes.value.data.map(async c => {
            try {
              const [statusRes, vipRes] = await Promise.allSettled([
                getClusterStatus(c.id),
                getClusterVipStatus(c.id),
              ])
              const s = statusRes.status === 'fulfilled' ? statusRes.value.data : null
              const v = vipRes.status   === 'fulfilled' ? vipRes.value.data   : null
              const vipActiveNodeId = v?.nodes?.find(n => n.vipPresent === true)?.nodeId ?? null
              return {
                clusterId:      s?.clusterId   ?? c.id,
                clusterName:    s?.clusterName ?? c.name,
                vip:            s?.vip         ?? c.vip,
                vipActive:      vipActiveNodeId !== null,
                vipActiveNodeId,
                nodes:          s?.nodes       ?? [],
                failoverEvent:  null,
              }
            } catch {
              return { clusterId: c.id, clusterName: c.name, vip: c.vip, vipActive: false, nodes: [], failoverEvent: null }
            }
          })
        )
        setAgents(statusData)
      }
      if (sumRes.status === 'fulfilled') setSummary(sumRes.value.data)
      if (swRes.status  === 'fulfilled') setSwItems(swRes.value.data.items ?? [])
      if (alRes.status  === 'fulfilled') setAlerts(prev => mergeAlarms(prev, alRes.value.data.items ?? []))
      if (dkRes.status  === 'fulfilled') setDocker(dkRes.value.data.nodes ?? [])
      if (rbRes.status  === 'fulfilled') {
        const list = rbRes.value.data.items ?? []
        // 진행 중 Runbook 우선, 없으면 가장 최근 항목
        setRunbook(list.find(r => r.status === 'IN_PROGRESS') ?? list[0] ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
  }, [load])

  /* ── Derived values for summary cards ── */
  // API는 노드 role을 UI 토큰(PRIMARY/STANDBY/FAULT/RECOVERING)으로 직렬화한다(Node.uiToken).
  // 도메인 소문자('active'/'fault')로 비교하면 절대 매칭되지 않으므로 UI 토큰으로 비교한다.
  const allNodes   = agents.flatMap(a => a.nodes ?? [])
  const faultNodes = allNodes.filter(n => n.role === 'FAULT')
  const isHealthy  = faultNodes.length === 0 && !agents.some(a => a.failoverEvent)

  const swTotal   = swItems.length
  const swOk      = swItems.filter(s => s.state === 'running').length
  const swWarn    = swTotal - swOk

  function clearAlarms() {
    try { localStorage.removeItem(ALARM_KEY) } catch { /* ignore */ }
    setAlerts([])
  }

  // 진행 중 작업 패널: Runbook을 {name, status, progress}로 변환
  const runbookItem = runbook
    ? { name: runbook.title, status: runbook.status, progress: runbook.progress ?? 0 }
    : null

  const haTotal   = summary?.clusterCount ?? 0
  const haOk      = agents.filter(a => !a.failoverEvent && !a.nodes?.some(n=>n.role==='FAULT')).length
  const haWarn    = haTotal - haOk

  const srvTotal  = allNodes.length
  const srvWarn   = faultNodes.length
  const srvOk     = srvTotal - srvWarn  // 장애(FAULT) 외 노드는 모두 정상으로 집계 (정상 + 경고 = 노드수)

  const alTotal   = alerts.length
  const alCrit    = alerts.filter(a => a.level === 'CRITICAL').length
  const alWarn    = alerts.filter(a => a.level === 'WARNING').length
  const alInfo    = alerts.filter(a => a.level === 'INFO').length

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          시스템 상태 로딩 중...
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 pt-0 space-y-6">
      {/* ── 상단 5개 상태 카드 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 items-stretch">
        <OverallStatusCard isHealthy={isHealthy} />

        <CountCard
          label="서비스"
          total={swTotal}
          subs={[
            { label: '정상', value: swOk,   color: 'status-green'  },
            { label: '경고', value: swWarn, color: 'status-orange' },
          ]}
          gaugeColor={swWarn > 0 ? '#fbbf24' : '#4ade80'}
          gaugePct={swTotal ? swOk / swTotal : 0}
        />

        <CountCard
          label="이중화(HA) 쌍"
          total={haTotal}
          subs={[
            { label: '정상', value: haOk,  color: 'status-green'  },
            { label: '경고', value: haWarn, color: 'status-orange' },
          ]}
          gaugeColor={haWarn > 0 ? '#fbbf24' : '#4ade80'}
          gaugePct={haTotal ? haOk / haTotal : 0}
        />

        <CountCard
          label="서버"
          total={srvTotal}
          subs={[
            { label: '정상', value: srvOk,  color: 'status-green'  },
            { label: '경고', value: srvWarn, color: 'status-orange' },
          ]}
          gaugeColor={srvWarn > 0 ? '#fbbf24' : '#4ade80'}
          gaugePct={srvTotal ? srvOk / srvTotal : 0}
        />

        <CountCard
          label="알람"
          total={alTotal}
          subs={[
            { label: '치명', value: alCrit, color: 'status-red'    },
            { label: '경고', value: alWarn, color: 'status-orange' },
            { label: '정보', value: alInfo, color: 'status-blue'   },
          ]}
          gaugeColor={alCrit > 0 ? '#f87171' : alWarn > 0 ? '#fbbf24' : '#60a5fa'}
          gaugePct={alTotal ? Math.max(0.1, 1 - (alCrit + alWarn) / alTotal) : 0}
        />
      </div>

      {/* ── 2분할 행: 이중화 동기화 상태(8/12) · 실시간 알람(4/12) ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
        <div className="md:col-span-12 xl:col-span-8">
          <SyncStatusPanel agents={agents} onRefresh={load} />
        </div>
        <div className="md:col-span-12 xl:col-span-4">
          <AlarmPanel items={alerts} onClear={clearAlarms} className="h-full" />
        </div>
      </div>

      {/* ── 하단: 좌 8/12(DB·SW·Docker + 진행중인 작업) · 우 4/12(NEMESIS AI 전체 높이) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        <div className="xl:col-span-8 flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <DbPanel items={swItems.filter(i => i.type === 'DB')} />
            <SwPanel items={swItems.filter(i => i.type !== 'DB')} />
            <DockerPanel nodes={docker} />
          </div>
          <RunbookProgressPanel item={runbookItem} />
        </div>
        <AiPanel className="xl:col-span-4 h-full" />
      </div>
    </div>
  )
}
