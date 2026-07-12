import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw, HardDrive, Trash2, ScanLine } from 'lucide-react'
import {
  getClusters, getClusterStatus,
  getStorageDevices, scanStorage, registerStorageDevice, deleteStorageDevice,
} from '../../api/client'

function RegisterForm({ clusterId, discoveredNodeId, prefill, onDone }) {
  const [form, setForm] = useState({
    wwid: prefill?.wwid || '',
    label: '',
    sizeBytes: prefill?.sizeBytes ?? '',
    pathCount: prefill?.pathCount ?? 1,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setSaving(true); setError('')
    try {
      await registerStorageDevice(clusterId, {
        wwid: form.wwid.trim(),
        label: form.label.trim() || null,
        sizeBytes: form.sizeBytes === '' ? null : Number(form.sizeBytes),
        pathCount: form.pathCount === '' ? null : Number(form.pathCount),
        discoveredNodeId: discoveredNodeId || null,
      })
      onDone()
    } catch (e) {
      setError(e.response?.data?.error || '등록 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 bg-gray-900/50 rounded-lg p-3">
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">WWID</label>
        <input className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-56"
          value={form.wwid} onChange={e => setForm(f => ({ ...f, wwid: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">라벨</label>
        <input className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-32"
          value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">크기(byte)</label>
        <input type="number" className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-32"
          value={form.sizeBytes} onChange={e => setForm(f => ({ ...f, sizeBytes: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">경로 수</label>
        <input type="number" className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-20"
          value={form.pathCount} onChange={e => setForm(f => ({ ...f, pathCount: e.target.value }))} />
      </div>
      <button disabled={saving || !form.wwid.trim()} onClick={submit}
        className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded px-3 py-1.5">
        등록
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  )
}

function ClusterStoragePanel({ cluster }) {
  const [devices, setDevices] = useState([])
  const [selectedNode, setSelectedNode] = useState('')
  const [discovered, setDiscovered] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    const res = await getStorageDevices(cluster.clusterId)
    setDevices(res.data ?? [])
  }, [cluster.clusterId])

  useEffect(() => { load() }, [load])

  const runScan = async () => {
    if (!selectedNode) return
    setScanning(true); setScanError(''); setDiscovered(null)
    try {
      const res = await scanStorage(cluster.clusterId, selectedNode)
      setDiscovered(res.data)
    } catch (e) {
      setScanError(e.response?.data?.error || '스캔 실패')
    } finally {
      setScanning(false)
    }
  }

  const removeDevice = async (deviceId) => {
    if (!window.confirm('이 디바이스 등록을 해제하시겠습니까? (실제 디스크는 변경되지 않습니다)')) return
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
          <select className="bg-gray-800 text-xs text-white rounded px-2 py-1"
            value={selectedNode} onChange={e => setSelectedNode(e.target.value)}>
            <option value="">노드 선택</option>
            {(cluster.nodes ?? []).map(n => (
              <option key={n.nodeId} value={n.nodeId}>{n.hostname}</option>
            ))}
          </select>
          <button disabled={!selectedNode || scanning} onClick={runScan}
            className="flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white rounded px-3 py-1.5">
            <ScanLine className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            FC 스캔
          </button>
          <button onClick={() => setShowManual(s => !s)}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-white rounded px-3 py-1.5">
            수동 등록
          </button>
        </div>
      </div>

      {scanError && <div className="text-xs text-red-400">{scanError}</div>}

      {discovered && (
        <div className="space-y-2">
          <p className="text-[10px] text-gray-500 uppercase">
            스캔 결과 ({discovered.length}건 — 등록 전까지 저장되지 않음)
          </p>
          {discovered.length === 0
            ? <p className="text-xs text-gray-600">발견된 LUN이 없습니다.</p>
            : discovered.map(d => (
                <div key={d.wwid} className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2 text-xs gap-3 flex-wrap">
                  <span className="text-gray-300 font-mono">{d.wwid}</span>
                  <span className="text-gray-500">{d.name} · {d.pathCount}경로</span>
                  {d.alreadyRegistered
                    ? <span className="text-green-400">등록됨</span>
                    : <RegisterForm clusterId={cluster.clusterId} discoveredNodeId={selectedNode}
                        prefill={{ wwid: d.wwid, sizeBytes: d.sizeBytes, pathCount: d.pathCount }}
                        onDone={() => { load(); setDiscovered(null) }} />}
                </div>
              ))}
        </div>
      )}

      {showManual && (
        <RegisterForm clusterId={cluster.clusterId} discoveredNodeId={null}
          onDone={() => { load(); setShowManual(false) }} />
      )}

      <div className="border-t border-gray-800 pt-3">
        <p className="text-[10px] text-gray-500 uppercase mb-2">등록된 디바이스 ({devices.length})</p>
        {deleteError && <div className="text-xs text-red-400 mb-2">{deleteError}</div>}
        {devices.length === 0
          ? <p className="text-xs text-gray-600">등록된 공유 디바이스가 없습니다.</p>
          : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 text-left">
                  <th className="font-normal pb-2">WWID</th>
                  <th className="font-normal pb-2">라벨</th>
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
                    <td className="py-2 text-gray-400">{d.label || '—'}</td>
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
          )}
      </div>
    </div>
  )
}

export default function Storage() {
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)

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
          <p className="text-xs text-gray-500 mt-1">FC SAN 디바이스 조회 · 등록 (Nemesis Share)</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 수동 갱신
        </button>
      </div>

      {loading && statuses.length === 0 ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : statuses.length === 0 ? (
        <div className="text-center py-16 text-gray-500">등록된 클러스터가 없습니다.</div>
      ) : statuses.map(c => <ClusterStoragePanel key={c.clusterId} cluster={c} />)}
    </div>
  )
}
