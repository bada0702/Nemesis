import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Zap, RefreshCw, Bot, WifiOff, Activity, Heart, Database, Network, Save, RotateCcw, Trash2, X } from 'lucide-react'
import {
  getClusters, getClusterStatus, getClusterNodes, triggerFailover,
  backupClusterConfig, getConfigSnapshots, restoreConfigSnapshot, deleteConfigSnapshot, syncClusterConfig,
} from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { statusBadge, dot } from '../../lib/utils'
import { ReplicationTab, HeartbeatTab, MetadataSyncTab, AgentStatusTab } from '../monitoring/ClusterStatus'

const STATUS_TABS = [
  { key: 'overview',    label: '개요',            icon: Network  },
  { key: 'replication', label: '복제 현황',        icon: Activity },
  { key: 'heartbeat',   label: '하트비트 현황',    icon: Heart    },
  { key: 'metadata',    label: '메타데이터 동기화', icon: Database },
  { key: 'agents',      label: '에이전트',          icon: Server   },
]

const ROLE_BADGE = {
  PRIMARY:    'text-sky-400 border-sky-500/30 bg-sky-500/10',
  STANDBY:    'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  FAULT:      'text-red-400 border-red-500/30 bg-red-500/10',
  RECOVERING: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
}

const agentUp = n => n?.lastSeenAt != null && (Date.now() - new Date(n.lastSeenAt).getTime()) < 30_000

// PRIMARY를 항상 앞(왼쪽)에, 그 다음 STANDBY, 마지막 FAULT 순으로 정렬.
const roleRank = r => r === 'PRIMARY' ? 0 : r === 'STANDBY' ? 1 : r === 'RECOVERING' ? 2 : 3
const orderNodes = nodes => [...(nodes ?? [])].sort((x, y) => roleRank(x.role) - roleRank(y.role))

// 서비스별 사용량 미니 바
function UsageMini({ label, pct }) {
  const p = Math.max(0, Math.min(100, pct))
  const col = p >= 90 ? 'bg-red-500' : p >= 75 ? 'bg-amber-500' : 'bg-sky-500'
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <span className="text-[8px] text-gray-600 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${col}`} style={{ width: `${p}%` }} />
      </div>
      <span className="text-[8px] text-gray-500 font-mono shrink-0 w-7 text-right">{p.toFixed(0)}%</span>
    </div>
  )
}

// 노드 컬럼 카드: 노드 정보(역할·자원) + 그 노드의 서비스 목록 + 에이전트 상태.
// 이중화 비교를 위해 좌우로 나란히 배치한다.
function NodeCard({ node }) {
  const procs   = node.metrics?.processes ?? []
  const running = procs.filter(p => p.status === 'running').length
  const agentUp = node.lastSeenAt != null && (Date.now() - new Date(node.lastSeenAt).getTime()) < 30_000
  const down    = node.state === 'STOPPED' || node.role === 'FAULT'
  const toneIcon = down ? 'text-red-400'
    : node.role === 'PRIMARY' ? 'text-sky-400'
    : node.role === 'RECOVERING' ? 'text-amber-400' : 'text-emerald-400'
  const cardCls = node.role === 'PRIMARY' ? 'bg-sky-900/15 border-sky-500/30'
    : down ? 'bg-red-900/10 border-red-500/30' : 'bg-gray-800/40 border-gray-700'

  return (
    <div className={`rounded-xl p-4 border ${cardCls}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${ROLE_BADGE[node.role] ?? 'text-gray-400 border-gray-700'}`}>
          {node.role ?? '-'}
        </span>
        <span className="text-[10px] text-gray-500 font-mono">서비스 {running}/{procs.length}</span>
      </div>

      <div className="flex items-center gap-2.5">
        <Server className={`w-8 h-8 ${toneIcon}`} />
        <div>
          <p className="text-sm font-bold text-white">{node.hostname ?? '—'}</p>
          <p className="text-[11px] text-gray-500 font-mono">{node.serviceIp ?? node.ipAddress ?? ''}</p>
        </div>
      </div>

      {node.metrics && (
        <div className="mt-3 space-y-1.5">
          {[['CPU', node.metrics.cpuPercent], ['MEM', node.metrics.memoryPercent], ['DISK', node.metrics.diskPercent]].map(([k, v]) => {
            const pct = Math.max(0, Math.min(100, Math.round(v ?? 0)))
            const col = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
            return (
              <div key={k}>
                <div className="flex justify-between text-[9px] mb-0.5">
                  <span className="text-gray-500 font-bold">{k}</span>
                  <span className="text-gray-300 font-mono">{pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${col} transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 border-t border-gray-700/40 pt-2">
        <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1.5">보호 대상 서비스</p>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {procs.length === 0 ? (
            <p className="text-[11px] text-gray-600 py-1">서비스 없음</p>
          ) : procs.map((p, i) => {
            const cpu = parseFloat(p.cpuPercent ?? 0) || 0
            const mem = parseFloat(p.memPercent ?? 0) || 0
            const showUsage = p.cpuPercent != null && p.status === 'running'
            return (
              <div key={`${p.name}-${i}`} className="py-0.5">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'running' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-[12px] text-gray-300 truncate">{p.name}</span>
                  <span className={`ml-auto text-[10px] font-mono font-bold ${p.status === 'running' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {p.status ?? '—'}
                  </span>
                </div>
                {showUsage && (
                  <div className="flex items-center gap-3 mt-0.5 pl-3.5">
                    <UsageMini label="CPU" pct={cpu} />
                    <UsageMini label="MEM" pct={mem} />
                  </div>
                )}
              </div>
            )
          })}
          <div className="flex items-center gap-2 border-t border-gray-800/50 pt-1.5 mt-1">
            <Bot className="w-3.5 h-3.5 text-indigo-400/70 shrink-0" />
            <span className="text-[12px] text-gray-400">Nemesis Agent</span>
            <span className={`ml-auto text-[10px] font-mono font-bold ${agentUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {agentUp ? 'connected' : 'offline'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// 설정 스냅샷(백업 목록) 모달 — 복구/삭제
function SnapshotModal({ cluster, isOperator, onClose, onAfter }) {
  const [snaps, setSnaps] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = () => getConfigSnapshots(cluster.clusterId)
    .then(r => setSnaps(r.data)).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  async function restore(s) {
    if (!window.confirm(`'${s.name}' 스냅샷으로 ${cluster.clusterName} 설정을 복구하시겠습니까?\n현재 클러스터/노드 설정이 덮어쓰여집니다.`)) return
    setBusy(true)
    try {
      const r = await restoreConfigSnapshot(cluster.clusterId, s.id)
      alert(`복구 완료: ${r.data.cluster} (노드 ${r.data.nodesRestored}개)`) ; onAfter?.()
    } catch (e) { alert('복구 실패: ' + (e?.response?.data?.message ?? e.message)) }
    finally { setBusy(false) }
  }
  async function remove(s) {
    if (!window.confirm(`'${s.name}' 스냅샷을 삭제하시겠습니까?`)) return
    try { await deleteConfigSnapshot(cluster.clusterId, s.id); load() }
    catch (e) { alert('삭제 실패: ' + (e?.response?.data?.message ?? e.message)) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <span className="text-sm font-bold text-white">{cluster.clusterName} 설정 스냅샷</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
          {loading ? <p className="text-xs text-gray-500 text-center py-6">로딩 중...</p>
            : snaps.length === 0 ? <p className="text-xs text-gray-600 text-center py-6">저장된 스냅샷이 없습니다.</p>
            : snaps.map(s => (
              <div key={s.id} className="flex items-center gap-3 bg-gray-900/40 rounded-lg px-4 py-2.5">
                <Database className="w-4 h-4 text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 truncate">{s.name}</p>
                  <p className="text-[10px] text-gray-600">{s.createdAt}</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button disabled={!isOperator || busy} onClick={() => restore(s)}
                    title={isOperator ? '복구' : 'operator 이상 권한 필요'}
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-sky-600/15 border border-sky-500/30 text-sky-300 hover:bg-sky-600/25 disabled:opacity-40 disabled:cursor-not-allowed">
                    <RotateCcw className="w-3 h-3" /> 복구
                  </button>
                  <button onClick={() => remove(s)} title="삭제"
                    className="p-1.5 rounded text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

export default function HaGroups() {
  const [clusters, setClusters]     = useState([])   // statuses (nodes 포함)
  const [rawClusters, setRawClusters] = useState([]) // getClusters 원본(에이전트 탭용)
  const [nodeMap, setNodeMap]       = useState({})   // clusterId → nodes(에이전트 탭용)
  const [loading, setLoading]       = useState(true)
  const [failing, setFailing]       = useState(null) // 진행 중인 clusterId
  const [tab, setTab]               = useState('overview')
  const [snapCluster, setSnapCluster] = useState(null)   // 스냅샷 모달 대상
  const navigate = useNavigate()
  const { isOperator } = useAuth()

  async function doBackup(c) {
    const name = window.prompt('스냅샷 이름(비우면 자동):', `${c.clusterName} ${new Date().toLocaleString('ko-KR')}`)
    if (name === null) return
    try { await backupClusterConfig(c.clusterId, name); alert('설정 저장 완료') }
    catch (e) { alert('설정 저장 실패: ' + (e?.response?.data?.message ?? e.message)) }
  }
  async function doSync(c) {
    if (!window.confirm(`${c.clusterName} 설정을 노드에 동기화하시겠습니까?`)) return
    try { const r = await syncClusterConfig(c.clusterId); alert(r.data.message ?? '동기화 요청됨') }
    catch (e) { alert('동기화 실패: ' + (e?.response?.data?.message ?? e.message)) }
  }

  // 실제 수동 Failover 실행(상세 페이지 이동이 아님). 승격 가능한 standby 필요.
  async function doFailover(c) {
    const primary = c.nodes?.find(n => n.role === 'PRIMARY')
    const standby = c.nodes?.find(n => n.role === 'STANDBY')
    if (!standby) { alert('승격 가능한 standby 노드가 없어 Failover를 실행할 수 없습니다.'); return }
    if (!window.confirm(`${c.clusterName} 수동 Failover를 실행하시겠습니까?\n${primary?.hostname ?? '?'} → ${standby.hostname}`)) return
    setFailing(c.clusterId)
    try {
      const res = await triggerFailover(c.clusterId, {
        fromNodeId: primary?.nodeId, toNodeId: standby.nodeId, toHostname: standby.hostname,
      })
      const d = res?.data ?? {}
      if (d.success === false) alert(`Failover 불가 (${d.status ?? 'SKIPPED'}): ${d.message ?? '알 수 없는 이유'}`)
      else alert(`Failover 완료: 새 Primary = ${d.newPrimary ?? standby.hostname}`)
      await load()
    } catch (e) {
      alert('Failover 실행 실패: ' + (e?.response?.data?.message ?? e.message))
    } finally { setFailing(null) }
  }

  async function load() {
    setLoading(true)
    try {
      const listRes = await getClusters()
      setRawClusters(listRes.data)
      const statuses = await Promise.all(
        listRes.data.map(c => getClusterStatus(c.id).then(r => r.data).catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] })))
      )
      setClusters(statuses)
      // 에이전트 탭용 nodeMap
      const m = {}
      await Promise.all(listRes.data.map(async c => {
        try { const r = await getClusterNodes(c.id); m[c.id] = r.data } catch { m[c.id] = [] }
      }))
      setNodeMap(m)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv) }, [])

  const healthy = clusters.filter(c => !c.nodes?.some(n => n.role === 'FAULT' || n.state === 'STOPPED')).length

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">이중화(HA) 그룹 목록</h2>
          <p className="text-xs text-gray-500 mt-1">Active/Standby 클러스터 쌍 현황</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>

      {/* 탭: 개요 + 클러스터 상태(복제/하트비트/메타데이터/에이전트) */}
      <div className="flex gap-2 border-b border-gray-800 overflow-x-auto">
        {STATUS_TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-all ${
                tab === t.key ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300 hover:border-gray-600'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (<>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체 클러스터', value: clusters.length,    color: 'text-white' },
          { label: '정상',          value: healthy,             color: 'text-green-400' },
          { label: '이상',          value: clusters.length - healthy, color: 'text-red-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {loading && clusters.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">로딩 중...</div>
      ) : (
        <div className="space-y-4">
          {clusters.map(c => {
            const primary = c.nodes?.find(n => n.role === 'PRIMARY') ?? null
            const standby = c.nodes?.find(n => n.role === 'STANDBY') ?? null
            const hasFault = c.nodes?.some(n => n.role === 'FAULT' || n.state === 'STOPPED')
            return (
              <div key={c.clusterId} className="card-bg rounded-xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${hasFault ? 'bg-red-400' : 'bg-green-400'}`} />
                    <span className="font-bold text-white">{c.clusterName}</span>
                    <span className="text-xs text-gray-500">VIP: {c.vip || '—'}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => navigate(`/cluster/${c.clusterId}`)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600">
                      상세 보기
                    </button>
                    <button onClick={() => doBackup(c)} title="현재 설정 저장"
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600">
                      <Save className="w-3 h-3" /> 설정 저장
                    </button>
                    <button onClick={() => setSnapCluster(c)} title="저장된 설정으로 복구"
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600">
                      <RotateCcw className="w-3 h-3" /> 복구
                    </button>
                    <button onClick={() => doSync(c)} disabled={!isOperator}
                      title={isOperator ? '노드에 설정 동기화' : 'operator 이상 권한이 필요합니다'}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed">
                      <RefreshCw className="w-3 h-3" /> 노드 동기화
                    </button>
                    {(() => {
                      const standby = c.nodes?.find(n => n.role === 'STANDBY')
                      const disabled = !isOperator || !standby || failing === c.clusterId
                      return (
                        <button onClick={() => doFailover(c)} disabled={disabled}
                          title={!isOperator ? 'operator 이상 권한이 필요합니다' : !standby ? '승격 가능한 standby 노드가 없습니다' : ''}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed">
                          <Zap className="w-3 h-3" /> {failing === c.clusterId ? '실행 중...' : 'Failover'}
                        </button>
                      )
                    })()}
                  </div>
                </div>

                {/* 이중화 모습: 노드를 좌우로 나란히, 각 노드 카드 안에 서비스 목록 */}
                {(c.nodes?.length ?? 0) === 0 ? (
                  <p className="text-xs text-gray-600 py-2">등록된 노드가 없습니다.</p>
                ) : (c.nodes?.length ?? 0) === 2 ? (
                  // 2노드 이중화 — PRIMARY 좌측 고정, 가운데에 실시간 동기화 표시
                  (() => {
                    const [a, b] = orderNodes(c.nodes)   // PRIMARY가 항상 왼쪽
                    const synced = agentUp(a) && agentUp(b) && !hasFault
                    return (
                      <div className="flex items-stretch gap-2">
                        <div className="flex-1"><NodeCard node={a} /></div>
                        <div className="relative flex items-center justify-center w-28 shrink-0">
                          {/* 연결 트랙: 동기화면 그라데이션, 끊기면 빨강 점선 */}
                          <div className={`absolute left-0 right-0 h-0.5 ${synced ? 'bg-gradient-to-r from-sky-500/50 via-emerald-400/70 to-emerald-500/50' : 'border-t-2 border-dashed border-red-500/40 h-0'}`} />
                          {/* 중앙 동기화 배지 */}
                          <div className={`relative z-10 flex flex-col items-center gap-1 rounded-xl border px-3 py-2 backdrop-blur-sm ${synced ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
                            {synced
                              ? <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" style={{ animationDuration: '3s' }} />
                              : <WifiOff className="w-4 h-4 text-red-400" />}
                            <span className={`text-[9px] font-bold whitespace-nowrap ${synced ? 'text-emerald-400' : 'text-red-400'}`}>
                              {synced ? '실시간 동기화' : '동기화 끊김'}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1"><NodeCard node={b} /></div>
                      </div>
                    )
                  })()
                ) : (
                  // 1개 또는 3개+ 노드 — PRIMARY 우선 정렬, 좌우 그리드로 나란히
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {orderNodes(c.nodes).map(n => <NodeCard key={n.nodeId} node={n} />)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>)}

      {tab === 'replication' && <ReplicationTab clusters={clusters} loading={loading} />}
      {tab === 'heartbeat'   && <HeartbeatTab   clusters={clusters} />}
      {tab === 'metadata'    && <MetadataSyncTab clusters={clusters} />}
      {tab === 'agents'      && <AgentStatusTab  clusters={rawClusters} nodeMap={nodeMap} loading={loading} />}

      {snapCluster && (
        <SnapshotModal cluster={snapCluster} isOperator={isOperator}
          onClose={() => setSnapCluster(null)} onAfter={() => { setSnapCluster(null); load() }} />
      )}
    </div>
  )
}
