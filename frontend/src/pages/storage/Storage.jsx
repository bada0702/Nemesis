import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { RefreshCw, HardDrive, Trash2, ScanLine, AlertTriangle, Plus, FolderSync } from 'lucide-react'
import {
  getClusters, getClusterStatus,
  getStorageDevices, scanStorage, registerStorageDevicesBatch, deleteStorageDevice,
} from '../../api/client'
import DirSyncPanel from '../../components/DirSyncPanel'

const FSTYPES = ['ext4', 'xfs']
const WWID_RE = /^[0-9a-fA-F]{8,64}$/
const DIR_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

function ClusterDiskPanel({ cluster }) {
  const nodes = cluster.nodes ?? []
  const activeNode = nodes.find(n => n.role === 'PRIMARY') || nodes[0]

  const [devices, setDevices] = useState([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [byNode, setByNode] = useState(null) // { [nodeId]: DiscoveredDevice[] | null }
  const [items, setItems] = useState([])     // 선택/수동추가된 등록 대기 행
  const [batchResults, setBatchResults] = useState(null)
  const [registering, setRegistering] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    const res = await getStorageDevices(cluster.clusterId)
    setDevices(res.data ?? [])
  }, [cluster.clusterId])

  useEffect(() => { load() }, [load])

  const runScan = async () => {
    if (nodes.length === 0) return
    setScanning(true); setScanError(''); setByNode(null); setItems([]); setBatchResults(null)
    try {
      const entries = await Promise.all(nodes.map(n =>
        scanStorage(cluster.clusterId, n.nodeId)
          .then(r => [n.nodeId, r.data])
          .catch(() => [n.nodeId, null])
      ))
      const map = {}
      entries.forEach(([nodeId, data]) => { map[nodeId] = data })
      setByNode(map)
    } catch (e) {
      setScanError(e.response?.data?.error || '스캔 실패')
    } finally {
      setScanning(false)
    }
  }

  // wwid 기준으로 노드별 스캔 결과를 합친 행 목록(양쪽에서 보여야 등록 가능 여부 판단용)
  const rows = useMemo(() => {
    if (!byNode) return []
    const map = new Map()
    nodes.forEach(n => {
      const list = byNode[n.nodeId]
      if (!list) return
      list.forEach(d => {
        if (!map.has(d.wwid)) map.set(d.wwid, { wwid: d.wwid, presence: {} })
        map.get(d.wwid).presence[n.nodeId] = d
      })
    })
    return [...map.values()]
  }, [byNode, nodes])

  const isSelectable = row => nodes.length <= 1 || nodes.every(n => row.presence[n.nodeId])
  const isChecked = wwid => items.some(it => it.wwid === wwid)

  const toggleRow = (row) => {
    setItems(prev => {
      if (prev.some(it => it.wwid === row.wwid)) return prev.filter(it => it.wwid !== row.wwid)
      const ref = row.presence[activeNode?.nodeId] ?? Object.values(row.presence)[0]
      return [...prev, {
        wwid: row.wwid, dirName: '', fstype: 'ext4',
        sizeBytes: ref?.sizeBytes ?? null, pathCount: ref?.pathCount ?? null,
        alreadyRegistered: ref?.alreadyRegistered ?? false, manual: false,
      }]
    })
  }

  const addManualRow = () => setItems(prev => [...prev,
    { wwid: '', dirName: '', fstype: 'ext4', sizeBytes: null, pathCount: null, manual: true }])
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx))
  const updateItem = (idx, field, value) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))

  const canSubmit = !!activeNode && items.length > 0 &&
    items.every(it => WWID_RE.test(it.wwid) && DIR_NAME_RE.test(it.dirName || '') && !it.alreadyRegistered)

  const submitBatch = async () => {
    if (!canSubmit) return
    setRegistering(true); setBatchResults(null); setScanError('')
    try {
      const payload = items.map(it => ({
        wwid: it.wwid, dirName: it.dirName.trim(), fstype: it.fstype,
        sizeBytes: it.sizeBytes, pathCount: it.pathCount,
        discoveredNodeId: it.manual ? null : activeNode.nodeId,
      }))
      const res = await registerStorageDevicesBatch(cluster.clusterId, activeNode.nodeId, payload)
      setBatchResults(res.data)
      const okWwids = new Set((res.data ?? []).filter(r => r.success).map(r => r.wwid))
      setItems(prev => prev.filter(it => !okWwids.has(it.wwid)))
      await load()
    } catch (e) {
      setScanError(e.response?.data?.error || '일괄 등록 실패')
    } finally {
      setRegistering(false)
    }
  }

  const removeDevice = async (deviceId) => {
    if (!window.confirm('이 디바이스 등록을 해제하시겠습니까? (실제 마운트/디스크는 변경되지 않습니다)')) return
    setDeleteError('')
    try {
      await deleteStorageDevice(cluster.clusterId, deviceId)
      load()
    } catch (e) {
      setDeleteError(e.response?.data?.error || '삭제 실패')
    }
  }

  return (
    <div className="card-bg rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-blue-400" />
          <span className="font-bold text-white">{cluster.clusterName}</span>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={nodes.length === 0 || scanning} onClick={runScan}
            className="flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white rounded px-3 py-1.5">
            <ScanLine className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            FC 스캔 (양쪽 노드)
          </button>
          <button onClick={addManualRow}
            className="flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-white rounded px-3 py-1.5">
            <Plus className="w-3.5 h-3.5" /> WWID 직접 추가
          </button>
        </div>
      </div>

      {scanError && <div className="text-xs text-red-400">{scanError}</div>}

      {byNode && (
        <div className="space-y-2">
          <p className="text-[10px] text-gray-500 uppercase">
            스캔 결과 (양쪽 노드에서 모두 보이는 wwid만 선택 가능 — 등록 전까지 저장되지 않음)
          </p>
          {rows.length === 0 ? (
            <p className="text-xs text-gray-600">발견된 LUN이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="font-normal pb-2 w-8"></th>
                    <th className="font-normal pb-2">WWID</th>
                    {nodes.map(n => (
                      <th key={n.nodeId} className="font-normal pb-2">{n.hostname}{n.role === 'PRIMARY' ? ' (active)' : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const selectable = isSelectable(row)
                    return (
                      <tr key={row.wwid} className="border-t border-gray-800/60">
                        <td className="py-2">
                          <input type="checkbox" disabled={!selectable}
                            checked={isChecked(row.wwid)} onChange={() => toggleRow(row)} />
                        </td>
                        <td className="py-2 font-mono text-gray-300">{row.wwid}</td>
                        {nodes.map(n => {
                          const d = row.presence[n.nodeId]
                          return (
                            <td key={n.nodeId} className="py-2 text-gray-400">
                              {d
                                ? `${d.name} · ${d.pathCount}경로${d.alreadyRegistered ? ' · 등록됨' : ''}`
                                : (!selectable && (
                                    <span className="text-amber-400 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3" /> 편측만 보임
                                    </span>
                                  ))}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2 border-t border-gray-800 pt-3">
          <p className="text-[10px] text-gray-500 uppercase">등록 대기 ({items.length}건)</p>
          {items.map((it, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-2 bg-gray-900/50 rounded-lg p-3">
              {it.manual ? (
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">WWID</label>
                  <input className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-56 font-mono"
                    value={it.wwid} onChange={e => updateItem(idx, 'wwid', e.target.value.trim())} />
                </div>
              ) : (
                <span className="text-xs text-gray-300 font-mono w-56">{it.wwid}</span>
              )}
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">공유 디렉토리명</label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-600">/nemesis/share/</span>
                  <input className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-32"
                    value={it.dirName} onChange={e => updateItem(idx, 'dirName', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">fstype</label>
                <select className="bg-gray-800 text-xs text-white rounded px-2 py-1"
                  value={it.fstype} onChange={e => updateItem(idx, 'fstype', e.target.value)}>
                  {FSTYPES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              {it.sizeBytes != null && (
                <span className="text-[10px] text-gray-500">
                  용량 {(it.sizeBytes / (1024 ** 3)).toFixed(1)} GiB
                </span>
              )}
              {it.alreadyRegistered && <span className="text-[10px] text-amber-400">이미 등록된 WWID</span>}
              <button onClick={() => removeItem(idx)} className="text-gray-500 hover:text-red-400 ml-auto">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button disabled={!canSubmit || registering} onClick={submitBatch}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded px-3 py-1.5">
            {registering ? '등록 중...' : `일괄 등록 (mount까지 실행 · active: ${activeNode?.hostname ?? '—'})`}
          </button>
        </div>
      )}

      {batchResults && (
        <div className="space-y-1 text-xs">
          {batchResults.map(r => (
            <div key={r.wwid} className={r.success ? 'text-green-400' : 'text-red-400'}>
              {r.success ? '✅' : '❌'} {r.wwid} {r.error ? `→ ${r.error}` : '→ 등록 완료'}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-800 pt-3">
        <p className="text-[10px] text-gray-500 uppercase mb-2">등록된 디바이스 ({devices.length})</p>
        {deleteError && <div className="text-xs text-red-400 mb-2">{deleteError}</div>}
        {devices.length === 0
          ? <p className="text-xs text-gray-600">등록된 공유 디바이스가 없습니다.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="font-normal pb-2">WWID</th>
                    <th className="font-normal pb-2">마운트 경로</th>
                    <th className="font-normal pb-2">fstype</th>
                    <th className="font-normal pb-2">크기</th>
                    <th className="font-normal pb-2">경로</th>
                    <th className="font-normal pb-2">출처</th>
                    <th className="font-normal pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map(d => (
                    <tr key={d.id} className="border-t border-gray-800/60">
                      <td className="py-2 font-mono text-gray-300">{d.wwid}</td>
                      <td className="py-2 text-gray-400 font-mono">{d.mountPath || '—'}</td>
                      <td className="py-2 text-gray-400">{d.fstype || '—'}</td>
                      <td className="py-2 text-gray-400">
                        {d.sizeBytes ? `${(d.sizeBytes / (1024 ** 3)).toFixed(1)} GiB` : '—'}
                      </td>
                      <td className="py-2 text-gray-400">{d.pathCount}</td>
                      <td className="py-2 text-gray-500">{d.source}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => removeDevice(d.id)} className="text-gray-500 hover:text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}

const TABS = [
  { key: 'dirsync', label: '로컬 폴더 동기화 설정', icon: FolderSync },
  { key: 'disk',    label: '공유 디스크 설정',      icon: HardDrive },
]

export default function Storage() {
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('dirsync')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const listRes = await getClusters()
      const stats = await Promise.all(
        listRes.data.map(c =>
          getClusterStatus(c.id).then(r => r.data)
            .catch(() => ({ clusterId: c.id, clusterName: c.name, nodes: [] }))
        )
      )
      setStatuses(stats)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-8 pt-0 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">공유 스토리지</h2>
          <p className="text-xs text-gray-500 mt-1">로컬 폴더 동기화 · FC SAN 디바이스 조회/등록 (Nemesis Share)</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 수동 갱신
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-800">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 text-sm font-bold px-4 py-2.5 border-b-2 transition-all ${
                tab === t.key ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {loading && statuses.length === 0 ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : statuses.length === 0 ? (
        <div className="text-center py-16 text-gray-500">등록된 클러스터가 없습니다.</div>
      ) : tab === 'dirsync' ? (
        statuses.map(c => (
          <div key={c.clusterId} className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <HardDrive className="w-4 h-4 text-blue-400" /> {c.clusterName}
            </div>
            <DirSyncPanel clusterId={c.clusterId} nodes={c.nodes ?? []} />
          </div>
        ))
      ) : (
        statuses.map(c => <ClusterDiskPanel key={c.clusterId} cluster={c} />)
      )}
    </div>
  )
}
