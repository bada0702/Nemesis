import React, { useEffect, useState } from 'react'
import { Package, RefreshCw, Search, ScanLine, Plus, X, Check } from 'lucide-react'
import { getSw, scanSw, registerSw } from '../api/client'
import { statusBadge, dot } from '../lib/utils'

const TYPE_COLORS = { WAS: 'bg-blue-600', WEB: 'bg-yellow-600', DB: 'bg-green-600', SYS: 'bg-gray-600' }

function SwScanModal({ nodeId, onClose, onRegistered }) {
  const [scanning,    setScanning]    = useState(false)
  const [known,       setKnown]       = useState([])
  const [unknown,     setUnknown]     = useState([])
  const [checked,     setChecked]     = useState({})
  const [custom,      setCustom]      = useState([])
  const [newName,     setNewName]     = useState('')
  const [newDisplay,  setNewDisplay]  = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    async function doScan() {
      setScanning(true)
      try {
        const r = await scanSw(nodeId)
        const k = r.data.known   ?? []
        const u = r.data.unknown ?? []
        setKnown(k)
        setUnknown(u)
        const init = {}
        k.forEach((_, i) => { init[`k_${i}`] = true })
        setChecked(init)
      } catch (e) {
        setError('스캔 실패: ' + (e.response?.data?.message ?? e.message))
      } finally {
        setScanning(false)
      }
    }
    doScan()
  }, [nodeId])

  function addCustom() {
    if (!newName.trim()) return
    setCustom(c => [...c, { name: newName.trim(), displayName: newDisplay.trim() || newName.trim(), type: 'CUSTOM' }])
    setNewName('')
    setNewDisplay('')
  }

  async function handleRegister() {
    const toRegister = [
      ...known.filter((_, i) => checked[`k_${i}`]).map(k => ({ ...k, type: 'KNOWN' })),
      ...custom,
    ]
    if (toRegister.length === 0) { setError('등록할 항목을 선택하세요.'); return }
    setSaving(true)
    try {
      await registerSw({ nodeId, processes: toRegister })
      onRegistered()
    } catch (e) {
      setError('등록 실패: ' + (e.response?.data?.message ?? e.message))
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = known.filter((_, i) => checked[`k_${i}`]).length + custom.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-blue-400" /> SW 자동 스캔 결과
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {scanning && (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-400 text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            스캔 중...
          </div>
        )}

        {!scanning && error && <p className="text-xs text-red-400 mb-4">{error}</p>}

        {!scanning && (
          <>
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-bold">
                자동 감지된 SW ({known.length}개)
              </p>
              {known.length === 0
                ? <p className="text-xs text-gray-500 py-2">감지된 Known SW가 없습니다.</p>
                : <div className="space-y-1.5">
                    {known.map((k, i) => (
                      <label key={i}
                        className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/5 cursor-pointer">
                        <div onClick={() => setChecked(c => ({ ...c, [`k_${i}`]: !c[`k_${i}`] }))}
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 cursor-pointer
                            ${checked[`k_${i}`] ? 'bg-blue-600 border-blue-600' : 'border-gray-600'}`}>
                          {checked[`k_${i}`] && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-white">{k.displayName}</span>
                          <span className="text-[10px] text-gray-500 ml-2 font-mono">{k.name}</span>
                        </div>
                        {k.pid && <span className="text-[10px] text-gray-600 font-mono">PID {k.pid}</span>}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">알려진 SW</span>
                      </label>
                    ))}
                  </div>
              }
            </div>

            <div className="border-t border-gray-800 pt-4 mb-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-bold">
                알 수 없는 프로세스 — 수동 등록 ({unknown.length}개 감지)
              </p>
              <div className="flex gap-2 mb-2">
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="프로세스명 (예: proc_xyz)"
                  className="flex-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
                <input value={newDisplay} onChange={e => setNewDisplay(e.target.value)}
                  placeholder="표시명"
                  className="flex-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
                <button onClick={addCustom}
                  className="px-3 py-1.5 text-xs bg-blue-600/20 border border-blue-600/30 text-blue-400 rounded-lg hover:bg-blue-600/30 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> 추가
                </button>
              </div>
              {custom.map((c, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-white/5 mb-1">
                  <span className="text-xs text-white flex-1">{c.displayName}</span>
                  <span className="text-[10px] text-gray-500 font-mono">{c.name}</span>
                  <button onClick={() => setCustom(c => c.filter((_, idx) => idx !== i))}
                    className="text-gray-500 hover:text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
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

export default function Sw() {
  const [items,      setItems]      = useState([])
  const [filter,     setFilter]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading,    setLoading]    = useState(true)
  const [scanModal,  setScanModal]  = useState(false)

  async function load() {
    setLoading(true)
    try { const r = await getSw(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const types    = [...new Set(items.map(i => i.type))]
  const filtered = items.filter(i =>
    (typeFilter === 'all' || i.type === typeFilter) &&
    i.name.toLowerCase().includes(filter.toLowerCase())
  )
  const running = items.filter(i => i.state === 'running').length
  // 등록된 SW에서 첫 번째 nodeId 추출 (없으면 null — 스캔 모달에서 노드 미선택 표시)
  const demoNodeId = items.find(i => i.nodeId)?.nodeId ?? null

  return (
    <div className="p-8 pt-0 space-y-6">
      {scanModal && (
        <SwScanModal
          nodeId={demoNodeId}
          onClose={() => setScanModal(false)}
          onRegistered={() => { setScanModal(false); load() }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">SW 관리</h2>
          <p className="text-xs text-gray-500 mt-1">미들웨어 및 시스템 소프트웨어 현황</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setScanModal(true)}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20">
            <ScanLine className="w-3.5 h-3.5" /> 자동 스캔
          </button>
          <button onClick={load}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 SW', value: items.length,           color: 'text-white' },
          { label: '실행 중', value: running,                color: 'text-green-400' },
          { label: '중지',    value: items.length - running, color: items.length - running > 0 ? 'text-red-400' : 'text-gray-500' },
          { label: '타입',    value: types.length,           color: 'text-blue-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="SW 이름 검색..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
        </div>
        <div className="flex gap-2">
          {['all', ...types].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${typeFilter === t ? 'bg-blue-600/20 border-blue-600/40 text-blue-400' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
              {t === 'all' ? '전체' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="card-bg rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800">
            <tr className="text-gray-500 uppercase">
              {['타입','이름','버전','상태','노드','포트','PID','가동 시간',''].map(h => (
                <th key={h} className="text-left py-3 px-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0
              ? <tr><td colSpan="9" className="text-center py-12 text-gray-500">로딩 중...</td></tr>
              : filtered.length === 0
              ? <tr><td colSpan="9" className="py-16">
                  <div className="flex flex-col items-center gap-3 text-gray-500">
                    <Package className="w-10 h-10 opacity-20" />
                    <p className="text-sm">등록된 SW가 없습니다.</p>
                    <button onClick={() => setScanModal(true)}
                      className="text-xs text-blue-400 hover:text-blue-300 underline">
                      자동 스캔으로 등록해 보세요
                    </button>
                  </div>
                </td></tr>
              : filtered.map((item, i) => (
                <tr key={i} className="border-b border-gray-800/40 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${TYPE_COLORS[item.type] ?? 'bg-gray-600'}`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-medium text-white">{item.name}</td>
                  <td className="py-3 px-4 text-gray-400">{item.version}</td>
                  <td className="py-3 px-4"><span className={`${dot(item.state)} font-medium`}>● {item.state}</span></td>
                  <td className="py-3 px-4 text-gray-400">{item.node}</td>
                  <td className="py-3 px-4 text-gray-400">{item.port ?? '—'}</td>
                  <td className="py-3 px-4 text-gray-500 font-mono">{item.pid ?? '—'}</td>
                  <td className="py-3 px-4 text-gray-400">{item.uptime ?? '—'}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1">
                      {item.state !== 'running'
                        ? <button className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20">기동</button>
                        : <button className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">중지</button>}
                      <button className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white">재시작</button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
