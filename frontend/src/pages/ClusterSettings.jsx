import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getClusterStatus, updateCluster, getClusterNodes,
  createNode, updateNode, deleteNode,
  applyClusterVip, downClusterVip, getClusterVipStatus,
} from '../api/client'
import { useAuth } from '../auth/AuthContext'
import ClusterTopologyPanel from '../components/ClusterTopologyPanel'
import DirSyncPanel from '../components/DirSyncPanel'

const OS_TYPES = ['Linux', 'AIX', 'RHEL', 'Ubuntu', 'CentOS']
const ROLES    = ['PRIMARY', 'STANDBY']
const OS_ICON  = { Linux: 'terminal', AIX: 'memory', RHEL: 'dns', Ubuntu: 'dns', CentOS: 'dns' }
const OS_COLOR = { Linux: 'text-emerald-400', AIX: 'text-amber-400', RHEL: 'text-red-400', Ubuntu: 'text-orange-400', CentOS: 'text-purple-400' }

function Badge({ children, color = 'slate' }) {
  const map = {
    sky:    'bg-sky-500/15 text-sky-300 border-sky-500/30',
    emerald:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    red:    'bg-red-500/15 text-red-300 border-red-500/30',
    amber:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
    slate:  'bg-slate-700/50 text-slate-400 border-slate-600/50',
  }
  return (
    <span className={`text-[9px] font-bold border rounded px-1.5 py-0.5 ${map[color] ?? map.slate}`}>{children}</span>
  )
}

// ── 노드 추가/수정 모달 ───────────────────────────────────────
function NodeFormModal({ clusterId, existing, onClose, onSaved }) {
  const isEdit = !!existing
  const [form, setForm] = useState({
    hostname:    existing?.hostname    ?? '',
    ipAddress:   existing?.ipAddress   ?? '',
    vip:         existing?.vip         ?? '',
    heartbeatIp: existing?.heartbeatIp ?? '',
    netIface:    existing?.netIface    ?? '',
    osType:      existing?.osType      ?? 'Linux',
    role:        existing?.role        ?? 'STANDBY',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    if (!form.hostname || !form.ipAddress) { setError('hostname과 IP는 필수입니다.'); return }
    setSaving(true); setError(null)
    try {
      let node
      if (isEdit) {
        const res = await updateNode(clusterId, existing.nodeId, form)
        node = res.data
      } else {
        const res = await createNode(clusterId, form)
        node = res.data
      }
      onSaved(node)
    } catch {
      setError('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500 transition-colors font-mono placeholder-slate-700'
  const labelCls = 'block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-sky-400 text-[20px]">dns</span>
            <h2 className="text-sm font-black text-on-surface font-display">
              {isEdit ? '노드 설정 수정' : '노드 추가'}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-400 transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {/* Hostname */}
          <div>
            <label className={labelCls}>Hostname <span className="text-red-500">*</span></label>
            <input value={form.hostname} onChange={e => set('hostname', e.target.value)}
              placeholder="예: prod-node-04" className={inputCls} />
          </div>

          {/* IP + VIP */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Real IP <span className="text-red-500">*</span></label>
              <input value={form.ipAddress} onChange={e => set('ipAddress', e.target.value)}
                placeholder="예: 10.0.1.13" className={inputCls} />
              <p className="text-[10px] text-slate-700 mt-1">실제 물리/가상 NIC IP</p>
            </div>
            <div>
              <label className={labelCls}>VIP (선택)</label>
              <input value={form.vip} onChange={e => set('vip', e.target.value)}
                placeholder="예: 10.0.1.1" className={inputCls} />
              <p className="text-[10px] text-slate-700 mt-1">서비스 Virtual IP</p>
            </div>
          </div>

          {/* 내부 하트비트 IP + NIC */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Heartbeat IP (선택)</label>
              <input value={form.heartbeatIp} onChange={e => set('heartbeatIp', e.target.value)}
                placeholder="예: 192.168.50.13" className={inputCls} />
              <p className="text-[10px] text-slate-700 mt-1">노드 간 사설 하트비트 망 IP</p>
            </div>
            <div>
              <label className={labelCls}>네트워크 카드 (NIC)</label>
              <input value={form.netIface} onChange={e => set('netIface', e.target.value)}
                placeholder="예: eth1 / en0" className={inputCls} />
              <p className="text-[10px] text-slate-700 mt-1">VIP·하트비트를 적용할 인터페이스</p>
            </div>
          </div>

          {/* OS Type */}
          <div>
            <label className={labelCls}>OS 유형 <span className="text-red-500">*</span></label>
            <div className="flex flex-wrap gap-2">
              {OS_TYPES.map(os => (
                <button
                  key={os} type="button"
                  onClick={() => set('osType', os)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all
                    ${form.osType === os
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                      : 'border-slate-700 text-slate-500 hover:border-slate-600'}`}
                >
                  <span className={`material-symbols-outlined text-[14px] ${form.osType === os ? 'text-sky-400' : OS_COLOR[os]}`}>
                    {OS_ICON[os]}
                  </span>
                  {os}
                </button>
              ))}
            </div>
            {(form.osType === 'AIX') && (
              <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[14px]">info</span>
                <p className="text-[10px] text-amber-300">AIX 서버는 mmgetstate 대신 mmlscluster 사용을 권장합니다.</p>
              </div>
            )}
          </div>

          {/* Role */}
          <div>
            <label className={labelCls}>Active 서버 지정</label>
            <div className="grid grid-cols-2 gap-3">
              {ROLES.map(r => (
                <button
                  key={r} type="button"
                  onClick={() => set('role', r)}
                  className={`flex flex-col items-start gap-1 px-4 py-3 rounded-xl border transition-all
                    ${form.role === r
                      ? r === 'PRIMARY'
                        ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                        : 'bg-slate-700/40 border-slate-600/60 text-slate-300'
                      : 'border-slate-800 text-slate-600 hover:border-slate-700'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-[16px] ${form.role === r ? (r==='PRIMARY'?'text-sky-400':'text-slate-400') : 'text-slate-700'}`}>
                      {r === 'PRIMARY' ? 'star' : 'backup'}
                    </span>
                    <span className="text-xs font-bold">{r}</span>
                  </div>
                  <span className="text-[9px] font-mono ml-6 opacity-70">
                    {r === 'PRIMARY' ? '현재 서비스 제공 서버' : '대기 복제 서버'}
                  </span>
                </button>
              ))}
            </div>
            {form.role === 'PRIMARY' && isEdit && (
              <div className="mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-[14px]">warning</span>
                <p className="text-[10px] text-amber-300">PRIMARY로 변경하면 기존 Primary 노드는 STANDBY로 자동 전환됩니다.</p>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-[12px] text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-400 hover:border-slate-600 transition-all">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-lg shadow-sky-600/20 disabled:opacity-50">
              {saving ? '저장 중...' : isEdit ? '변경 저장' : '노드 추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── VIP 실제 적용 상태 패널 ───────────────────────────────────
function VipStatusPanel({ clusterId, vip }) {
  const { isOperator } = useAuth()
  const [status, setStatus]       = useState(null)
  const [checking, setChecking]   = useState(false)
  const [applying, setApplying]   = useState(false)
  const [downing, setDowning]     = useState(false)
  const [actionResult, setActionResult] = useState(null)

  const check = useCallback(async () => {
    setChecking(true)
    try { const r = await getClusterVipStatus(clusterId); setStatus(r.data) }
    catch { /* ignore */ } finally { setChecking(false) }
  }, [clusterId])

  useEffect(() => { check() }, [check])

  async function apply() {
    setApplying(true); setActionResult(null)
    try {
      const r = await applyClusterVip(clusterId)
      setActionResult(r.data.applied
        ? { ok: true,  msg: 'VIP가 Primary 노드에 적용되었습니다. (ip addr show로 확인)' }
        : { ok: false, msg: 'VIP 적용 실패 — 노드별 결과를 확인하세요.' })
      check()
    } catch (e) {
      setActionResult({ ok: false, msg: 'VIP 적용 실패: ' + (e.response?.data?.message ?? e.message) })
    } finally { setApplying(false) }
  }

  async function down() {
    setDowning(true); setActionResult(null)
    try {
      const r = await downClusterVip(clusterId)
      setActionResult(r.data.removed
        ? { ok: true,  msg: '모든 노드에서 VIP가 해제되었습니다 (이중화 중지).' }
        : { ok: false, msg: 'VIP 해제 실패 — 노드별 결과를 확인하세요.' })
      check()
    } catch (e) {
      setActionResult({ ok: false, msg: 'VIP 해제 실패: ' + (e.response?.data?.message ?? e.message) })
    } finally { setDowning(false) }
  }

  if (!vip) return null

  return (
    <div className="bg-surface-container border border-surface-variant rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-400 text-[18px]">lan</span>
          <h3 className="text-sm font-black text-on-surface font-display">VIP 실제 적용 상태</h3>
          <span className="text-[11px] font-mono text-slate-500">{vip}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={check} disabled={checking}
            className="flex items-center gap-1.5 text-[11px] font-bold border border-slate-700 text-slate-400 hover:border-slate-600 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50">
            <span className="material-symbols-outlined text-[13px]">refresh</span>
            {checking ? '점검 중...' : '상태 점검'}
          </button>
          <button onClick={apply} disabled={applying || downing || !isOperator}
            title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
            className="flex items-center gap-1.5 text-[11px] font-bold bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <span className="material-symbols-outlined text-[13px]">play_circle</span>
            {applying ? '적용 중...' : 'VIP 적용'}
          </button>
          <button onClick={down} disabled={downing || applying || !isOperator}
            title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
            className="flex items-center gap-1.5 text-[11px] font-bold bg-red-600/15 hover:bg-red-600/25 border border-red-500/30 text-red-400 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <span className="material-symbols-outlined text-[13px]">stop_circle</span>
            {downing ? '해제 중...' : 'VIP 중지 (이중화 해제)'}
          </button>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mb-3">
        VIP 적용: Primary 노드에 vip-up, 그 외 노드에서 vip-down. 적용 후 <code className="font-mono">ip addr show</code>로 확인하세요.
        VIP 중지: 모든 노드에서 vip-down 실행 (이중화 해제).
      </p>

      {actionResult && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-[11px] ${actionResult.ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
          : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
          {actionResult.msg}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {(status?.nodes ?? []).map(n => (
          <div key={n.nodeId}
            className={`flex items-center gap-2 text-[11px] border rounded-lg px-3 py-2 font-mono
              ${n.vipPresent === true  ? 'border-emerald-500/30 bg-emerald-500/5' :
                n.vipPresent === false ? 'border-slate-700 bg-slate-800/30' :
                                         'border-amber-500/30 bg-amber-500/5'}`}>
            <span className={
              n.vipPresent === true  ? 'text-emerald-400' :
              n.vipPresent === false ? 'text-slate-600' : 'text-amber-400'}>
              {n.vipPresent === true ? '●' : n.vipPresent === false ? '○' : '?'}
            </span>
            <span className="text-slate-300">{n.hostname}</span>
            <span className="text-slate-600">{n.role}</span>
            <span className={
              n.vipPresent === true  ? 'text-emerald-400 font-bold' :
              n.vipPresent === false ? 'text-slate-600' : 'text-amber-400'}>
              {n.vipPresent === true ? 'VIP 있음' : n.vipPresent === false ? 'VIP 없음' : '통신 불가'}
            </span>
          </div>
        ))}
        {status && (status.nodes ?? []).length === 0 && (
          <p className="text-[11px] text-slate-600">등록된 노드가 없습니다.</p>
        )}
      </div>
    </div>
  )
}

// ── 클러스터 정보 수정 폼 ─────────────────────────────────────
function ClusterInfoPanel({ cluster, onUpdated }) {
  const [form,   setForm]   = useState({ name: cluster.name, vip: cluster.vip })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateCluster(cluster.id, form)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      onUpdated(form)
    } catch {} finally { setSaving(false) }
  }

  const inputCls = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500 transition-colors font-mono'

  return (
    <div className="bg-surface-container border border-surface-variant rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-sky-400 text-[18px]">tune</span>
        <h3 className="text-sm font-black text-on-surface font-display">클러스터 기본 정보</h3>
      </div>
      <form onSubmit={submit} className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">클러스터 이름</label>
          <input value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">클러스터 VIP</label>
          <input value={form.vip} onChange={e => setForm(f=>({...f,vip:e.target.value}))} className={inputCls} placeholder="예: 10.0.0.1" />
        </div>
        <div className="col-span-2 flex justify-end gap-3 pt-1">
          {saved && <span className="flex items-center gap-1 text-[11px] text-emerald-400"><span className="material-symbols-outlined text-[14px]">check_circle</span>저장 완료</span>}
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-sky-600/20 hover:bg-sky-600/35 border border-sky-500/40 text-sky-300 rounded-lg px-4 py-2 text-xs font-bold transition-all disabled:opacity-50">
            <span className="material-symbols-outlined text-[14px]">save</span>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── 노드 행 ───────────────────────────────────────────────────
function NodeRow({ node, clusterId, onEdit, onDelete }) {
  const [delConfirm, setDelConfirm] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  const ROLE_CLR = { PRIMARY: 'sky', STANDBY: 'slate', FAULT: 'red', RECOVERING: 'amber' }
  const STATE_DOT = { RUNNING: 'bg-emerald-500', STOPPED: 'bg-slate-600', FAULT: 'bg-red-500 animate-pulse' }

  async function confirmDelete() {
    setDeleting(true)
    try {
      await deleteNode(clusterId, node.nodeId)
      onDelete(node.nodeId)
    } catch {} finally { setDeleting(false) }
  }

  return (
    <div className="bg-surface-container border border-surface-variant hover:border-slate-700 rounded-xl p-4 transition-all">
      <div className="flex items-start justify-between gap-3">
        {/* 노드 정보 */}
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATE_DOT[node.state] ?? 'bg-slate-600'}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-on-surface font-mono">{node.hostname}</span>
              <Badge color={ROLE_CLR[node.role] ?? 'slate'}>{node.role}</Badge>
              <span className={`flex items-center gap-1 text-[10px] font-bold ${OS_COLOR[node.osType] ?? 'text-slate-400'}`}>
                <span className="material-symbols-outlined text-[12px]">{OS_ICON[node.osType] ?? 'dns'}</span>
                {node.osType}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-[10px] font-mono text-slate-500">IP: {node.ipAddress}</span>
              {node.vip && <span className="text-[10px] font-mono text-sky-600">VIP: {node.vip}</span>}
            </div>
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => onEdit(node)}
            className="flex items-center gap-1.5 text-[10px] font-bold border border-slate-700 text-slate-400 hover:border-sky-500/50 hover:text-sky-400 rounded-lg px-2.5 py-1.5 transition-all">
            <span className="material-symbols-outlined text-[13px]">edit</span>
            수정
          </button>
          {!delConfirm ? (
            <button onClick={() => setDelConfirm(true)}
              className="flex items-center gap-1.5 text-[10px] font-bold border border-slate-700 text-slate-400 hover:border-red-500/50 hover:text-red-400 rounded-lg px-2.5 py-1.5 transition-all">
              <span className="material-symbols-outlined text-[13px]">delete</span>
              삭제
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setDelConfirm(false)}
                className="text-[10px] font-bold border border-slate-700 text-slate-500 rounded-lg px-2.5 py-1.5 transition-all hover:border-slate-600">
                취소
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="text-[10px] font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-50">
                {deleting ? '삭제 중' : '확인 삭제'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 메인 ─────────────────────────────────────────────────────
export default function ClusterSettings() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const [cluster, setCluster]   = useState(null)
  const [nodes,   setNodes]     = useState([])
  const [modal,   setModal]     = useState(null)  // null | 'add' | node객체(수정)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [sr, nr] = await Promise.all([getClusterStatus(id), getClusterNodes(id)])
        setCluster({ id: +id, name: sr.data.clusterName, vip: sr.data.vip })
        setNodes(nr.data)
      } catch {} finally { setLoading(false) }
    }
    load()
  }, [id])

  function handleNodeSaved(node) {
    setNodes(prev => {
      const idx = prev.findIndex(n => n.nodeId === node.nodeId)
      if (idx >= 0) { const next = [...prev]; next[idx] = node; return next }
      return [...prev, node]
    })
    setModal(null)
  }

  function handleNodeDelete(nodeId) {
    setNodes(prev => prev.filter(n => n.nodeId !== nodeId))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <div className="w-5 h-5 border-2 border-t-sky-500 rounded-full animate-spin" />
          <span className="text-sm">설정 로딩 중...</span>
        </div>
      </div>
    )
  }

  const primaryNode = nodes.find(n => n.role === 'PRIMARY')

  return (
    <div className="p-8 pt-0 space-y-5">
      {modal && (
        <NodeFormModal
          clusterId={id}
          existing={typeof modal === 'object' && modal.nodeId ? modal : null}
          onClose={() => setModal(null)}
          onSaved={handleNodeSaved}
        />
      )}

      {/* 브레드크럼 */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-xs font-bold">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          대시보드
        </button>
        <span className="text-slate-700">/</span>
        <button onClick={() => navigate(`/cluster/${id}`)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors font-mono">
          {cluster?.name}
        </button>
        <span className="text-slate-700">/</span>
        <span className="text-xs text-slate-400">설정</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-on-surface font-display tracking-tight italic uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-sky-400 text-[24px]">settings</span>
            {cluster?.name} — 설정
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono ml-9">
            VIP: {cluster?.vip ?? '—'} / Primary: {primaryNode?.hostname ?? '—'} / 노드 {nodes.length}개
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/cluster/${id}`)}
            className="flex items-center gap-2 border border-slate-700 text-slate-400 hover:border-slate-600 rounded-lg px-4 py-2 text-xs font-bold transition-all">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            클러스터 상세
          </button>
        </div>
      </div>

      {/* 클러스터 기본 정보 */}
      {cluster && (
        <ClusterInfoPanel cluster={cluster} onUpdated={data => setCluster(c => ({ ...c, ...data }))} />
      )}

      {/* HA 토폴로지 */}
      <ClusterTopologyPanel clusterId={id} />

      {/* VIP 실제 적용 상태 */}
      {cluster && <VipStatusPanel clusterId={id} vip={cluster.vip} />}

      {/* 폴더 동기화 */}
      <DirSyncPanel clusterId={id} nodes={nodes} />

      {/* 노드 관리 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.18em] font-display flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
            노드 관리 ({nodes.length})
          </h2>
          <button onClick={() => setModal('add')}
            className="flex items-center gap-2 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 rounded-lg px-4 py-2 text-xs font-bold transition-all">
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            노드 추가
          </button>
        </div>

        {nodes.length === 0 ? (
          <div className="bg-surface-container border border-dashed border-slate-700 rounded-xl p-12 text-center">
            <span className="material-symbols-outlined text-slate-700 text-4xl mb-3 block">dns</span>
            <p className="text-slate-500 text-sm mb-4">등록된 노드가 없습니다.</p>
            <button onClick={() => setModal('add')}
              className="flex items-center gap-2 mx-auto bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 rounded-lg px-5 py-2.5 text-xs font-bold transition-all hover:bg-emerald-600/25">
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              첫 번째 노드 추가
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Primary 먼저 표시 */}
            {[...nodes].sort((a, b) => (a.role === 'PRIMARY' ? -1 : b.role === 'PRIMARY' ? 1 : 0)).map(node => (
              <NodeRow
                key={node.nodeId}
                node={node}
                clusterId={id}
                onEdit={n => setModal(n)}
                onDelete={handleNodeDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* 위험 구역 */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-red-400 text-[18px]">dangerous</span>
          <h3 className="text-sm font-black text-red-400 font-display">위험 구역</h3>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold text-slate-400">{cluster?.name} 클러스터 삭제</p>
            <p className="text-[10px] text-slate-600 mt-0.5">클러스터와 모든 노드 설정이 영구 삭제됩니다. 되돌릴 수 없습니다.</p>
          </div>
          <DeleteClusterButton clusterId={id} clusterName={cluster?.name} onDeleted={() => navigate('/')} />
        </div>
      </div>
    </div>
  )
}

function DeleteClusterButton({ clusterId, clusterName, onDeleted }) {
  const [step, setStep] = useState('idle')  // idle → confirm → deleting

  async function doDelete() {
    setStep('deleting')
    try {
      const { deleteCluster } = await import('../api/client')
      await deleteCluster(clusterId)
      onDeleted()
    } catch { setStep('idle') }
  }

  if (step === 'idle') {
    return (
      <button onClick={() => setStep('confirm')}
        className="flex items-center gap-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg px-4 py-2 text-xs font-bold transition-all">
        <span className="material-symbols-outlined text-[15px]">delete_forever</span>
        클러스터 삭제
      </button>
    )
  }
  if (step === 'confirm') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-red-400 font-bold">&apos;{clusterName}&apos; 을(를) 삭제하시겠습니까?</span>
        <button onClick={() => setStep('idle')} className="text-xs border border-slate-700 text-slate-400 rounded-lg px-3 py-1.5 hover:border-slate-600 transition-all">취소</button>
        <button onClick={doDelete} className="text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-1.5 font-bold transition-all">삭제 확인</button>
      </div>
    )
  }
  return <span className="text-[11px] text-slate-500">삭제 중...</span>
}
