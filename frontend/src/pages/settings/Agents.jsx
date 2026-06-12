import React, { useEffect, useState } from 'react'
import { Server, Plus, Trash2, Edit2, RefreshCw, ChevronDown } from 'lucide-react'
import { getClusters, getClusterNodes, createNode, updateNode, deleteNode } from '../../api/client'
import { statusBadge, dot } from '../../lib/utils'

function NodeModal({ clusterId, initial, onClose, onSaved }) {
  const editing = !!initial
  const [form, setForm] = useState(initial ?? { hostname: '', ipAddress: '', role: 'STANDBY', osType: 'Linux' })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) await updateNode(clusterId, initial.nodeId, form)
      else         await createNode(clusterId, form)
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white">{editing ? '노드 수정' : '노드 추가'}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {[['호스트명','hostname','예: prod-node-03'],['IP 주소','ipAddress','예: 10.0.1.12']].map(([lbl, key, ph]) => (
            <div key={key}>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">{lbl}</label>
              <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">역할</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
                {['PRIMARY','STANDBY','FAULT'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase mb-1">OS</label>
              <select value={form.osType} onChange={e => setForm(f => ({ ...f, osType: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none">
                {['Linux','Windows','AIX'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white disabled:opacity-50">
              {saving ? '저장 중...' : editing ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AgentsSettings() {
  const [clusters, setClusters] = useState([])
  const [nodeMap,  setNodeMap]  = useState({})
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)

  async function load() {
    setLoading(true)
    try {
      const r = await getClusters()
      setClusters(r.data)
      const nm = {}
      await Promise.all(r.data.map(async c => {
        try { const nr = await getClusterNodes(c.id); nm[c.id] = nr.data } catch { nm[c.id] = [] }
      }))
      setNodeMap(nm)
      if (r.data.length > 0 && Object.keys(expanded).length === 0) setExpanded({ [r.data[0].id]: true })
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function removeNode(cid, nid, name) {
    if (!window.confirm(`"${name}" 노드를 삭제하시겠습니까?`)) return
    await deleteNode(cid, nid)
    load()
  }

  return (
    <div className="p-8 pt-0 space-y-5">
      {modal && (
        <NodeModal clusterId={modal.clusterId} initial={modal.node}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">에이전트 관리</h2>
          <p className="text-xs text-gray-500 mt-1">클러스터별 노드(에이전트) 설정</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading && clusters.length === 0
        ? <div className="text-center py-16 text-gray-500">로딩 중...</div>
        : clusters.map(c => (
          <div key={c.id} className="card-bg rounded-xl overflow-hidden">
            <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5"
              onClick={() => setExpanded(e => ({ ...e, [c.id]: !e[c.id] }))}>
              <div className="flex items-center gap-3">
                <Server className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-white text-sm">{c.name}</span>
                <span className="text-xs text-gray-500">VIP: {c.vip || '—'} · {(nodeMap[c.id] ?? []).length}개 노드</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={e => { e.stopPropagation(); setModal({ clusterId: c.id, node: null }) }}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-600/10 border border-blue-600/20 text-blue-400 hover:bg-blue-600/20">
                  <Plus className="w-3 h-3" /> 노드 추가
                </button>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded[c.id] ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {expanded[c.id] && (
              <div className="border-t border-gray-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 uppercase border-b border-gray-800/60">
                      {['호스트명','IP 주소','역할','OS','상태',''].map(h => (
                        <th key={h} className="text-left py-2.5 px-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(nodeMap[c.id] ?? []).map(n => (
                      <tr key={n.nodeId} className="border-b border-gray-800/40 hover:bg-white/5">
                        <td className="py-3 px-4">
                          <span className={`${dot(n.state)} mr-1`}>●</span>
                          <span className="font-medium text-white">{n.hostname}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-400 font-mono">{n.ipAddress ?? '—'}</td>
                        <td className="py-3 px-4"><span className={statusBadge(n.role)}>{n.role}</span></td>
                        <td className="py-3 px-4 text-gray-400">{n.osType ?? 'Linux'}</td>
                        <td className="py-3 px-4"><span className={statusBadge(n.state)}>{n.state}</span></td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1">
                            <button onClick={() => setModal({ clusterId: c.id, node: n })} className="p-1 text-gray-500 hover:text-white"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={() => removeNode(c.id, n.nodeId, n.hostname)} className="p-1 text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      }
    </div>
  )
}
