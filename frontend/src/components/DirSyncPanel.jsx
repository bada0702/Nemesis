import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import {
  getSyncJobs, createSyncJob, deleteSyncJob, runSyncJob,
  getSyncHistory, provisionSyncSsh,
} from '../api/client'
import DirBrowserModal from './DirBrowserModal'

export default function DirSyncPanel({ clusterId, nodes }) {
  const { isOperator } = useAuth()
  const [jobs, setJobs] = useState([])
  const [history, setHistory] = useState([])
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const [j, h] = await Promise.all([getSyncJobs(clusterId), getSyncHistory(clusterId)])
    setJobs(j.data || []); setHistory(h.data || [])
  }, [clusterId])
  useEffect(() => { load() }, [load])

  async function run(jid) {
    setMsg('동기화 실행 중...')
    try { const r = await runSyncJob(clusterId, jid); setMsg(JSON.stringify(r.data)); await load() }
    catch (e) { setMsg(e.response?.data?.message || '실행 실패') }
  }
  async function provision() {
    setMsg('SSH 신뢰 구성 중...')
    try { const r = await provisionSyncSsh(clusterId); setMsg(`프로비저닝: ${(r.data.provisioned||[]).join(', ')}`) }
    catch (e) { setMsg(e.response?.data?.message || 'SSH 구성 실패') }
  }
  async function remove(jid) {
    if (!confirm('이 동기화 작업을 삭제할까요?')) return
    await deleteSyncJob(clusterId, jid); await load()
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-200">폴더 동기화 (active → standby, rsync/heartbeat)</h3>
        <div className="flex gap-2">
          <button disabled={!isOperator} onClick={provision}
            title={isOperator ? '' : 'operator 이상 권한 필요'}
            className="px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded disabled:opacity-40">SSH 신뢰 구성</button>
          <button disabled={!isOperator} onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded disabled:opacity-40">+ 작업 추가</button>
        </div>
      </div>

      {msg && <div className="mb-3 text-xs font-mono text-slate-400 bg-slate-950 rounded p-2 break-all">{msg}</div>}

      <div className="space-y-2">
        {jobs.length === 0 && <div className="text-xs text-slate-600">동기화 작업이 없습니다.</div>}
        {jobs.map(j => (
          <div key={j.id} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-slate-200 font-mono truncate">{j.name}: {j.sourcePath} → {j.destPath}</div>
              <div className="text-[10px] text-slate-500">
                {j.scheduleSec > 0 ? `주기 ${j.scheduleSec}s` : '수동전용'}{j.mirrorDelete ? ' · mirror(--delete)' : ''}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button disabled={!isOperator} onClick={() => run(j.id)}
                className="px-2 py-1 text-xs bg-emerald-700 text-white rounded disabled:opacity-40">지금 동기화</button>
              <button disabled={!isOperator} onClick={() => remove(j.id)}
                className="px-2 py-1 text-xs text-red-400 disabled:opacity-40">삭제</button>
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">최근 이력</div>
          <div className="space-y-1">
            {history.slice(0, 10).map(h => (
              <div key={h.id} className="text-[11px] font-mono text-slate-500 flex justify-between">
                <span className={h.status === 'SUCCESS' ? 'text-emerald-400' : h.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}>{h.status}</span>
                <span className="truncate px-2">{h.filesCount}개 / {h.bytesTransferred}B / {h.durationMs}ms</span>
                <span>{new Date(h.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && (
        <AddJobModal clusterId={clusterId} nodes={nodes}
          onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load() }} />
      )}
    </div>
  )
}

function AddJobModal({ clusterId, nodes, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', sourcePath: '', destPath: '', scheduleSec: 0, mirrorDelete: false, excludes: '' })
  const [browsing, setBrowsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const browseNode = nodes.find(n => n.role === 'PRIMARY') || nodes[0]

  async function submit(e) {
    e.preventDefault(); setSaving(true); setError(null)
    try { await createSyncJob(clusterId, { ...form, destPath: form.destPath || form.sourcePath }); onSaved() }
    catch (e) { setError(e.response?.data?.message || '저장 실패'); setSaving(false) }
  }
  const input = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono'
  const label = 'block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={onClose}>
      <form onSubmit={submit} className="bg-slate-900 border border-slate-700 rounded-xl w-[440px] p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h4 className="text-sm font-bold text-slate-200">동기화 작업 추가</h4>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <div><label className={label}>이름</label><input className={input} value={form.name} onChange={e => set('name', e.target.value)} required /></div>
        <div>
          <label className={label}>소스 경로(active)</label>
          <div className="flex gap-2">
            <input className={input} value={form.sourcePath} onChange={e => set('sourcePath', e.target.value)} placeholder="/data/app" required />
            {browseNode && <button type="button" onClick={() => setBrowsing(true)} className="px-2 text-xs bg-slate-700 text-slate-200 rounded shrink-0">찾아보기</button>}
          </div>
        </div>
        <div><label className={label}>대상 경로(미입력 시 소스와 동일)</label><input className={input} value={form.destPath} onChange={e => set('destPath', e.target.value)} placeholder="(소스와 동일)" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>주기(초, 0=수동)</label><input type="number" min="0" className={input} value={form.scheduleSec} onChange={e => set('scheduleSec', Number(e.target.value))} /></div>
          <label className="flex items-center gap-2 text-xs text-slate-300 mt-5">
            <input type="checkbox" checked={form.mirrorDelete} onChange={e => set('mirrorDelete', e.target.checked)} />
            mirror(--delete)
          </label>
        </div>
        {form.mirrorDelete && <div className="text-[11px] text-amber-400">⚠ standby에서 소스에 없는 파일이 삭제됩니다.</div>}
        <div><label className={label}>제외 패턴(콤마/개행)</label><input className={input} value={form.excludes} onChange={e => set('excludes', e.target.value)} placeholder="*.log, tmp/" /></div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400">취소</button>
          <button type="submit" disabled={saving} className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded">저장</button>
        </div>
        {browsing && browseNode && (
          <DirBrowserModal clusterId={clusterId} node={browseNode}
            onPick={(p) => { set('sourcePath', p); setBrowsing(false) }} onClose={() => setBrowsing(false)} />
        )}
      </form>
    </div>
  )
}
