import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Monitor, RefreshCw, ScanLine, Plus, X, Check, Trash2, Star, Search, AlertTriangle,
} from 'lucide-react'
import {
  getClusters, getServiceCatalog, scanServiceCatalog,
  registerServices, updateManagedService, deleteManagedService,
} from '../api/client'

const POLL_MS = 5000

const TYPE_META = {
  WEB:       { badge: 'bg-yellow-600',  label: 'WEB' },
  WAS:       { badge: 'bg-blue-600',    label: 'WAS' },
  DB:        { badge: 'bg-green-600',   label: 'DB' },
  SW:        { badge: 'bg-gray-600',    label: 'SW' },
  CONTAINER: { badge: 'bg-purple-600',  label: 'CTR' },
}

// 메뉴 프리셋: ?type=DB → DB만, ?type=APP → WEB+WAS+SW
const FILTER_PRESETS = {
  ALL: { label: '전체',       types: null },
  WEB: { label: 'Web',        types: ['WEB'] },
  WAS: { label: 'WAS',        types: ['WAS'] },
  DB:  { label: 'DB',         types: ['DB'] },
  SW:  { label: '기타 SW',    types: ['SW'] },
  APP: { label: 'Application',types: ['WEB', 'WAS', 'SW'] },
  CONTAINER: { label: '컨테이너', types: ['CONTAINER'] },
}

function TypeBadge({ type }) {
  const meta = TYPE_META[type] ?? TYPE_META.SW
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${meta.badge}`}>
      {meta.label}
    </span>
  )
}

// ── 자동 스캔 검토 모달 ───────────────────────────────────────
function ScanModal({ clusterId, onClose, onRegistered }) {
  const [scanning, setScanning] = useState(true)
  const [proposals, setProposals] = useState([])
  const [unknown, setUnknown]     = useState([])
  const [staleNodes, setStaleNodes] = useState([])
  const [checked, setChecked]     = useState({})
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    let cancelled = false
    async function doScan() {
      try {
        const r = await scanServiceCatalog(clusterId)
        if (cancelled) return
        const p = r.data.proposals ?? []
        const u = r.data.unknown ?? []
        setProposals(p)
        setUnknown(u)
        setStaleNodes(r.data.staleNodes ?? [])
        // known이고 미등록인 항목은 기본 체크
        const init = {}
        p.forEach((item, i) => { init[`p_${i}`] = !item.alreadyRegistered })
        setChecked(init)
      } catch (e) {
        if (!cancelled) setError('스캔 실패: ' + (e.response?.data?.message ?? e.message))
      } finally {
        if (!cancelled) setScanning(false)
      }
    }
    doScan()
    return () => { cancelled = true }
  }, [clusterId])

  async function handleRegister() {
    const items = [
      ...proposals.filter((_, i) => checked[`p_${i}`]),
      ...unknown.filter((_, i) => checked[`u_${i}`]),
    ].map(it => ({ name: it.name, displayName: it.displayName, type: it.type }))
    if (items.length === 0) { setError('등록할 항목을 선택하세요.'); return }
    setSaving(true); setError(null)
    try {
      await registerServices(clusterId, items)
      onRegistered()
    } catch (e) {
      setError('등록 실패: ' + (e.response?.data?.message ?? e.message))
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = Object.values(checked).filter(Boolean).length

  function Row({ item, ckey, registered }) {
    return (
      <label className={`flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer ${registered ? 'opacity-50' : 'hover:bg-white/5'}`}>
        <div
          onClick={e => { e.preventDefault(); if (!registered) setChecked(c => ({ ...c, [ckey]: !c[ckey] })) }}
          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0
            ${checked[ckey] ? 'bg-blue-600 border-blue-600' : 'border-gray-600'}`}>
          {checked[ckey] && <Check className="w-3 h-3 text-white" />}
        </div>
        <TypeBadge type={item.type} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-white">{item.displayName}</span>
          <span className="text-[10px] text-gray-500 ml-2 font-mono">{item.name}</span>
        </div>
        <div className="flex gap-1.5">
          {(item.nodes ?? []).map(n => (
            <span key={n.nodeId} className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
              <span className="text-green-400">●</span>{n.hostname}
            </span>
          ))}
        </div>
        {registered && <span className="text-[10px] text-gray-500">등록됨</span>}
      </label>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-2xl rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-blue-400" /> 서비스 자동 스캔 — 검토 후 등록
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {scanning ? (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-400 text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            전체 노드 스캔 중...
          </div>
        ) : (
          <>
            {staleNodes.length > 0 && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                메트릭 미수신 노드 (스캔 제외): {staleNodes.join(', ')}
              </div>
            )}

            {error && <p className="text-xs text-red-400 mb-4">{error}</p>}

            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-bold">
                자동 감지된 서비스 ({proposals.length}개) — 동일 서비스는 노드 간 자동 병합
              </p>
              {proposals.length === 0
                ? <p className="text-xs text-gray-500 py-2">감지된 알려진 서비스가 없습니다.</p>
                : <div className="space-y-1">
                    {proposals.map((item, i) => (
                      <Row key={`p_${i}`} item={item} ckey={`p_${i}`} registered={item.alreadyRegistered} />
                    ))}
                  </div>
              }
            </div>

            {unknown.length > 0 && (
              <div className="border-t border-gray-800 pt-4 mb-4">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-bold">
                  알 수 없는 프로세스 ({unknown.length}개) — 필요한 것만 선택
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {unknown.map((item, i) => (
                    <Row key={`u_${i}`} item={item} ckey={`u_${i}`} registered={item.alreadyRegistered} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white">
                취소
              </button>
              <button onClick={handleRegister} disabled={saving || selectedCount === 0}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700">
                {saving ? '등록 중...' : `선택 항목 등록 (${selectedCount}개)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 수동 추가 모달 ────────────────────────────────────────────
function AddModal({ clusterId, onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', displayName: '', type: 'SW', haManaged: false })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('프로세스명은 필수입니다.'); return }
    setSaving(true); setError(null)
    try {
      await registerServices(clusterId, [{
        name: form.name.trim(),
        displayName: form.displayName.trim() || form.name.trim(),
        type: form.type,
        haManaged: form.haManaged,
      }])
      onAdded()
    } catch (e2) {
      setError('추가 실패: ' + (e2.response?.data?.message ?? e2.message))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white">서비스 수동 추가</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">프로세스명 (매칭 패턴) <span className="text-red-400">*</span></label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="예: my_batch_daemon" className={inputCls} />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">표시명</label>
            <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              placeholder="예: 배치 데몬" className={inputCls} />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">타입</label>
            <div className="flex gap-2 flex-wrap">
              {Object.keys(TYPE_META).map(t => (
                <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors
                    ${form.type === t ? 'bg-blue-600/20 border-blue-600/40 text-blue-400' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <div onClick={() => setForm(f => ({ ...f, haManaged: !f.haManaged }))}
              className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer
                ${form.haManaged ? 'bg-amber-500 border-amber-500' : 'border-gray-600'}`}>
              {form.haManaged && <Check className="w-3 h-3 text-black" />}
            </div>
            <span className="text-xs text-gray-300">HA 대상으로 지정 (장애 감지·페일오버 판단 대상)</span>
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400">취소</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-xs bg-blue-600 text-white disabled:opacity-50">
              {saving ? '추가 중...' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── 서비스 행 ─────────────────────────────────────────────────
function ServiceRow({ svc, clusterId, onChanged }) {
  const [toggling, setToggling] = useState(false)
  const [delConfirm, setDelConfirm] = useState(false)

  async function toggleHa() {
    setToggling(true)
    try {
      await updateManagedService(clusterId, svc.id, { haManaged: !svc.haManaged })
      onChanged()
    } catch { /* ignore */ } finally { setToggling(false) }
  }

  async function doDelete() {
    try {
      await deleteManagedService(clusterId, svc.id)
      onChanged()
    } catch { /* ignore */ }
  }

  const healthy = svc.runningCount === svc.nodeCount && svc.nodeCount > 0

  return (
    <div className="card-bg rounded-xl p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <TypeBadge type={svc.type} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white truncate">{svc.displayName}</span>
              <span className="text-[10px] text-gray-600 font-mono">{svc.name}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {(svc.instances ?? []).map(inst => (
                <span key={inst.nodeId} className="text-[11px] font-mono flex items-center gap-1.5">
                  <span className={inst.state === 'RUNNING' ? 'text-green-400' : 'text-gray-600'}>●</span>
                  <span className="text-gray-400">{inst.hostname}</span>
                  {inst.pid && <span className="text-gray-600">PID {inst.pid}</span>}
                  <span className={inst.state === 'RUNNING' ? 'text-green-500 text-[10px]' : 'text-gray-600 text-[10px]'}>
                    {inst.state}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-[10px] font-mono ${healthy ? 'text-green-400' : 'text-amber-400'}`}>
            {svc.runningCount}/{svc.nodeCount} RUNNING
          </span>

          {/* HA 지정 토글 */}
          <button onClick={toggleHa} disabled={toggling}
            title={svc.haManaged ? 'HA 대상 해제' : 'HA 대상으로 지정'}
            className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all disabled:opacity-50
              ${svc.haManaged
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                : 'border-gray-700 text-gray-500 hover:border-amber-500/40 hover:text-amber-400'}`}>
            <Star className={`w-3 h-3 ${svc.haManaged ? 'fill-amber-400' : ''}`} />
            {svc.haManaged ? 'HA 대상' : 'HA 지정'}
          </button>

          {!delConfirm ? (
            <button onClick={() => setDelConfirm(true)}
              className="text-gray-600 hover:text-red-400 p-1.5 rounded transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setDelConfirm(false)}
                className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400">취소</button>
              <button onClick={doDelete}
                className="text-[10px] px-2 py-1 rounded bg-red-600 text-white font-bold">삭제</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 메인 ─────────────────────────────────────────────────────
export default function ServiceCatalog() {
  const [searchParams, setSearchParams] = useSearchParams()
  const preset = FILTER_PRESETS[searchParams.get('type')?.toUpperCase()] ? searchParams.get('type').toUpperCase() : 'ALL'

  const [clusters, setClusters]   = useState([])
  const [clusterId, setClusterId] = useState(null)
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('')
  const [scanOpen, setScanOpen]   = useState(false)
  const [addOpen, setAddOpen]     = useState(false)

  useEffect(() => {
    getClusters().then(r => {
      setClusters(r.data)
      if (r.data.length > 0) setClusterId(prev => prev ?? r.data[0].id)
      else setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const load = useCallback(async () => {
    if (!clusterId) return
    try { const r = await getServiceCatalog(clusterId); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }, [clusterId])

  useEffect(() => {
    if (!clusterId) return
    setLoading(true)
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
  }, [clusterId, load])

  const presetTypes = FILTER_PRESETS[preset].types
  const filtered = useMemo(() => items.filter(s =>
    (!presetTypes || presetTypes.includes(s.type)) &&
    (s.displayName.toLowerCase().includes(filter.toLowerCase()) ||
     s.name.toLowerCase().includes(filter.toLowerCase()))
  ), [items, presetTypes, filter])

  const haCount      = items.filter(s => s.haManaged).length
  const healthyCount = items.filter(s => s.runningCount === s.nodeCount && s.nodeCount > 0).length

  return (
    <div className="p-8 pt-0 space-y-6">
      {scanOpen && clusterId && (
        <ScanModal clusterId={clusterId} onClose={() => setScanOpen(false)}
          onRegistered={() => { setScanOpen(false); load() }} />
      )}
      {addOpen && clusterId && (
        <AddModal clusterId={clusterId} onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); load() }} />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">서비스 카탈로그</h2>
          <p className="text-xs text-gray-500 mt-1">클러스터 논리 서비스 등록 · HA 대상 지정 · 노드별 실시간 상태</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setScanOpen(true)} disabled={!clusterId}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 disabled:opacity-50">
            <ScanLine className="w-3.5 h-3.5" /> 자동 스캔
          </button>
          <button onClick={() => setAddOpen(true)} disabled={!clusterId}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> 수동 추가
          </button>
          <button onClick={load}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 서비스', value: items.length,                color: 'text-white' },
          { label: '정상',        value: healthyCount,                color: 'text-green-400' },
          { label: '이상',        value: items.length - healthyCount, color: items.length - healthyCount > 0 ? 'text-orange-400' : 'text-gray-500' },
          { label: 'HA 대상',     value: haCount,                     color: 'text-amber-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        {clusters.length > 1 && (
          <select value={clusterId ?? ''} onChange={e => setClusterId(e.target.value)}
            className="text-xs bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 outline-none">
            {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="서비스 검색..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
        </div>
        <div className="flex gap-2">
          {['ALL', 'WEB', 'WAS', 'DB', 'SW', 'CONTAINER'].map(t => (
            <button key={t}
              onClick={() => setSearchParams(t === 'ALL' ? {} : { type: t })}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors
                ${preset === t || (preset === 'APP' && t === 'ALL')
                  ? 'bg-blue-600/20 border-blue-600/40 text-blue-400'
                  : 'border-gray-700 text-gray-400 hover:text-white'}`}>
              {FILTER_PRESETS[t].label}
            </button>
          ))}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">로딩 중...</div>
      ) : clusters.length === 0 ? (
        <div className="card-bg rounded-xl py-16 flex flex-col items-center gap-3 text-gray-500">
          <Monitor className="w-10 h-10 opacity-20" />
          <p className="text-sm">등록된 클러스터가 없습니다. 먼저 클러스터를 추가하세요.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-bg rounded-xl py-16 flex flex-col items-center gap-3 text-gray-500">
          <Monitor className="w-10 h-10 opacity-20" />
          <p className="text-sm">{items.length === 0 ? '등록된 서비스가 없습니다.' : '필터에 맞는 서비스가 없습니다.'}</p>
          {items.length === 0 && (
            <button onClick={() => setScanOpen(true)} className="text-xs text-blue-400 hover:text-blue-300 underline">
              자동 스캔으로 등록해 보세요
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(svc => (
            <ServiceRow key={svc.id} svc={svc} clusterId={clusterId} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  )
}
