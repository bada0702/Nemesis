import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Zap, RefreshCw, Bot, WifiOff, Heart, Database, Network, Save, RotateCcw, Trash2, X } from 'lucide-react'
import {
  getClusters, getClusterStatus, triggerFailover,
  backupClusterConfig, getConfigSnapshots, restoreConfigSnapshot, deleteConfigSnapshot, syncClusterConfig,
} from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { HeartbeatTab, MetadataSyncTab } from '../monitoring/ClusterStatus'

const STATUS_TABS = [
  { key: 'overview',    label: '개요',            icon: Network  },
  { key: 'heartbeat',   label: '하트비트 현황',    icon: Heart    },
  { key: 'metadata',    label: '메타데이터 동기화', icon: Database },
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
function NodeCard({ node, listStale }) {
  const procs   = node.metrics?.processes ?? []
  const running = procs.filter(p => p.status === 'running').length
  const agentUp = node.lastSeenAt != null && (Date.now() - new Date(node.lastSeenAt).getTime()) < 30_000
  // 목록 자체를 최근에 못 가져왔으면(외부망 지연 등) 화면의 lastSeenAt이 낡은 것뿐일 수 있다 —
  // 이 경우 "offline"으로 단정하지 않고 "확인 지연"으로 구분 표시한다.
  const unknown = listStale && !agentUp
  const down    = node.role === 'FAULT'
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
            <span className={`ml-auto text-[10px] font-mono font-bold ${agentUp ? 'text-emerald-400' : unknown ? 'text-gray-400' : 'text-red-400'}`}>
              {agentUp ? 'connected' : unknown ? '확인 지연' : 'offline'}
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
  const [loading, setLoading]       = useState(true)
  const [failing, setFailing]       = useState(null) // 진행 중인 clusterId
  const [tab, setTab]               = useState('overview')
  const [snapCluster, setSnapCluster] = useState(null)   // 스냅샷 모달 대상
  const [lastOkAt, setLastOkAt]     = useState(null)     // 목록 조회 마지막 성공 시각
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
      const statuses = await Promise.all(
        listRes.data.map(c => getClusterStatus(c.id).then(r => r.data)
          // 조회 실패(타임아웃 등)를 "노드 0개"로 위장하면 실제로는 멀쩡한 노드가 오프라인/동기화
          // 끊김으로 오인 표시된다(외부망처럼 지연 큰 경로에서 특히 잦음). statusError로 구분해
          // "조회 실패"를 노드 다운과 별개로 렌더링한다.
          .catch(() => ({ clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [], statusError: true })))
      )
      setClusters(statuses)
      setLastOkAt(Date.now())
    } catch (e) {
      // 목록 조회 자체가 실패(네트워크 지연/타임아웃) — 기존 화면은 유지한다. 여기서 아무
      // 표시도 안 하면 시간이 지날수록 화면에 남은 lastSeenAt만 낡아가며 거짓 offline으로
      // 보인다(지연 큰 외부망에서 특히 잦음). lastOkAt 을 갱신하지 않아 listStale 로 노출한다.
      console.warn('클러스터 목록 조회 실패:', e)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv) }, [])

  const healthy = clusters.filter(c => !c.statusError && !c.nodes?.some(n => n.role === 'FAULT')).length
  // 목록 조회가 최근(폴링 2회 이상, 20초) 성공하지 못했으면 화면 데이터는 낡았을 수 있다 —
  // 이 경우 agentUp=false 를 "offline" 대신 "확인 지연"으로 표시해 오탐을 피한다.
  const listStale = lastOkAt != null && (Date.now() - lastOkAt) > 20_000

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">클러스터 목록</h2>
          <p className="text-xs text-gray-500 mt-1">Active/Standby 클러스터 쌍 현황</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>

      {listStale && (
        <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          최신 상태 조회가 지연되고 있습니다(네트워크 지연/타임아웃) — 아래 값은 마지막 확인 시점 기준이며, 실제 노드가 다운된 것과는 다를 수 있습니다.
        </div>
      )}

      {/* 탭: 개요 + 클러스터 상태(하트비트/메타데이터) */}
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
            const hasFault = !c.statusError && c.nodes?.some(n => n.role === 'FAULT')
            return (
              <div key={c.clusterId} className="card-bg rounded-xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${c.statusError ? 'bg-gray-500' : hasFault ? 'bg-red-400' : 'bg-green-400'}`} />
                    <span className="font-bold text-white">{c.clusterName}</span>
                    <span className="text-xs text-gray-500">VIP: {c.vip || '—'}</span>
                    {c.statusError && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700/60 text-gray-400" title="상태 조회 요청이 실패했습니다(네트워크 지연/타임아웃). 노드가 실제로 다운된 것과는 다릅니다.">
                        상태 조회 실패 — 재시도 중
                      </span>
                    )}
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
                {c.statusError ? (
                  <p className="text-xs text-gray-500 py-2">노드 상태를 불러오지 못했습니다(네트워크 지연/타임아웃) — 실제 노드 다운 여부는 알 수 없습니다. 새로고침해 재시도하세요.</p>
                ) : (c.nodes?.length ?? 0) === 0 ? (
                  <p className="text-xs text-gray-600 py-2">등록된 노드가 없습니다.</p>
                ) : (c.nodes?.length ?? 0) === 2 ? (
                  // 2노드 이중화 — PRIMARY 좌측 고정, 가운데에 실시간 동기화 표시
                  (() => {
                    const [a, b] = orderNodes(c.nodes)   // PRIMARY가 항상 왼쪽
                    const bothUp = agentUp(a) && agentUp(b)
                    const synced = bothUp && !hasFault
                    // 목록 조회가 지연 중이면 "동기화 끊김"으로 단정하지 않고 "확인 지연"으로 구분.
                    const unknownSync = listStale && !bothUp
                    return (
                      <div className="flex items-stretch gap-2">
                        <div className="flex-1"><NodeCard node={a} listStale={listStale} /></div>
                        <div className="relative flex items-center justify-center w-28 shrink-0">
                          {/* 연결 트랙: 동기화면 그라데이션, 끊기면 빨강 점선 */}
                          <div className={`absolute left-0 right-0 h-0.5 ${synced ? 'bg-gradient-to-r from-sky-500/50 via-emerald-400/70 to-emerald-500/50' : unknownSync ? 'border-t-2 border-dashed border-gray-600 h-0' : 'border-t-2 border-dashed border-red-500/40 h-0'}`} />
                          {/* 중앙 동기화 배지 */}
                          <div className={`relative z-10 flex flex-col items-center gap-1 rounded-xl border px-3 py-2 backdrop-blur-sm ${synced ? 'border-emerald-500/40 bg-emerald-500/10' : unknownSync ? 'border-gray-600 bg-gray-800/40' : 'border-red-500/40 bg-red-500/10'}`}>
                            {synced
                              ? <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" style={{ animationDuration: '3s' }} />
                              : <WifiOff className={`w-4 h-4 ${unknownSync ? 'text-gray-400' : 'text-red-400'}`} />}
                            <span className={`text-[9px] font-bold whitespace-nowrap ${synced ? 'text-emerald-400' : unknownSync ? 'text-gray-400' : 'text-red-400'}`}>
                              {synced ? '실시간 동기화' : unknownSync ? '확인 지연' : '동기화 끊김'}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1"><NodeCard node={b} listStale={listStale} /></div>
                      </div>
                    )
                  })()
                ) : (
                  // 1개 또는 3개+ 노드 — PRIMARY 우선 정렬, 좌우 그리드로 나란히
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {orderNodes(c.nodes).map(n => <NodeCard key={n.nodeId} node={n} listStale={listStale} />)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>)}

      {tab === 'heartbeat' && <HeartbeatTab   clusters={clusters} />}
      {tab === 'metadata'  && <MetadataSyncTab clusters={clusters} />}

      {snapCluster && (
        <SnapshotModal cluster={snapCluster} isOperator={isOperator}
          onClose={() => setSnapCluster(null)} onAfter={() => { setSnapCluster(null); load() }} />
      )}
    </div>
  )
}
