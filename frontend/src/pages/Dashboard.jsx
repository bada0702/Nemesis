import React, { useCallback, useEffect, useState } from 'react'
import {
  getClusters, getClusterStatus,
  getDashboardSummary, getDashboardSwStatus, getDashboardAlerts,
  getDashboardDocker,
} from '../api/client'
import { OverallStatusCard, CountCard } from '../components/dashboard/StatusCards'
import SyncStatusPanel       from '../components/dashboard/SyncStatusPanel'
import ServiceStatusPanel    from '../components/dashboard/ServiceStatusPanel'
import AlarmPanel            from '../components/dashboard/AlarmPanel'
import DbPanel               from '../components/dashboard/DbPanel'
import SwPanel               from '../components/dashboard/SwPanel'
import DockerPanel           from '../components/dashboard/DockerPanel'
import RunbookProgressPanel  from '../components/dashboard/RunbookProgressPanel'
import AiPanel               from '../components/dashboard/AiPanel'

const POLL_MS = 5000

export default function Dashboard() {
  const [agents,  setAgents]  = useState([])
  const [summary, setSummary] = useState(null)
  const [swItems, setSwItems] = useState([])
  const [alerts,  setAlerts]  = useState([])
  const [docker,  setDocker]  = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [listRes, sumRes, swRes, alRes, dkRes] = await Promise.allSettled([
        getClusters(),
        getDashboardSummary(),
        getDashboardSwStatus(),
        getDashboardAlerts(),
        getDashboardDocker(),
      ])

      if (listRes.status === 'fulfilled') {
        const statusData = await Promise.all(
          listRes.value.data.map(c =>
            getClusterStatus(c.id).then(r => ({
              clusterId:   r.data.clusterId,
              clusterName: r.data.clusterName,
              vip:         r.data.vip,
              nodes:       r.data.nodes ?? [],
              failoverEvent: null,
            })).catch(() => ({
              clusterId: c.id, clusterName: c.name, vip: c.vip,
              nodes: [], failoverEvent: null,
            }))
          )
        )
        setAgents(statusData)
      }
      if (sumRes.status === 'fulfilled') setSummary(sumRes.value.data)
      if (swRes.status  === 'fulfilled') setSwItems(swRes.value.data.items ?? [])
      if (alRes.status  === 'fulfilled') setAlerts(alRes.value.data.items ?? [])
      if (dkRes.status  === 'fulfilled') setDocker(dkRes.value.data.nodes ?? [])
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
  const allNodes   = agents.flatMap(a => a.nodes ?? [])
  const faultNodes = allNodes.filter(n => n.role === 'fault' || n.role === 'FAULT')
  const isHealthy  = faultNodes.length === 0 && !agents.some(a => a.failoverEvent)

  const swTotal   = swItems.length
  const swOk      = swItems.filter(s => s.state === 'running').length
  const swWarn    = swTotal - swOk

  const haTotal   = summary?.clusterCount ?? 0
  const haOk      = agents.filter(a => !a.failoverEvent && !a.nodes?.some(n=>n.role==='fault')).length
  const haWarn    = haTotal - haOk

  const srvTotal  = allNodes.length
  const srvOk     = allNodes.filter(n => n.role === 'active').length
  const srvWarn   = faultNodes.length

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

      {/* ── 메인 그리드 (8 + 4) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* 좌측 8/12 */}
        <div className="xl:col-span-8 flex flex-col gap-6">
          <SyncStatusPanel agents={agents} onRefresh={load} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <DbPanel />
            <SwPanel items={swItems} />
            <DockerPanel nodes={docker} />
          </div>
        </div>

        {/* 우측 4/12 */}
        <div className="xl:col-span-4 flex flex-col gap-6">
          <ServiceStatusPanel className="h-1/2" />
          <AlarmPanel items={alerts} className="flex-1" />
        </div>
      </div>

      {/* ── 하단 그리드 (8 + 4) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        <div className="xl:col-span-8">
          <RunbookProgressPanel />
        </div>
        <AiPanel className="xl:col-span-4" />
      </div>
    </div>
  )
}
