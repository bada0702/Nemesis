import React, { useEffect, useState } from 'react'
import { BarChart3, Download, RefreshCw, FileText, Eye, Trash2, X } from 'lucide-react'
import { getReports, getReport, generateReport, deleteReport, downloadReport } from '../api/client'
import { statusBadge } from '../lib/utils'

const TYPE_LABELS = { MONTHLY: '월간 운영', INCIDENT: '장애 이력', PERFORMANCE: '성능 분석', SECURITY: '보안 감사' }
const TYPE_COLORS = { MONTHLY: 'text-blue-400', INCIDENT: 'text-red-400', PERFORMANCE: 'text-green-400', SECURITY: 'text-orange-400' }
const GEN_TYPES   = ['MONTHLY', 'INCIDENT', 'PERFORMANCE', 'SECURITY']

export default function Reports() {
  const [items, setItems]   = useState([])
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [genType, setGenType] = useState('MONTHLY')
  const [generating, setGenerating] = useState(false)
  const [viewing, setViewing] = useState(null)   // {title, content} 모달

  async function load() {
    setLoading(true)
    try { const r = await getReports(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function generate() {
    setGenerating(true)
    try { await generateReport(genType); await load() }
    catch { /* ignore */ } finally { setGenerating(false) }
  }

  async function view(id) {
    try { const r = await getReport(id); setViewing(r.data) }
    catch (e) { alert('리포트 열기 실패: ' + (e?.response?.data?.message ?? e.message)) }
  }

  async function del(item) {
    if (!window.confirm(`'${item.title}' 리포트를 삭제하시겠습니까?`)) return
    try { await deleteReport(item.id); await load() }
    catch (e) { alert('삭제 실패: ' + (e?.response?.data?.message ?? e.message)) }
  }

  // 월간 운영 리포트 바로 보기: 최신 월간 리포트가 있으면 열고, 없으면 생성 후 연다.
  async function viewMonthly() {
    setGenerating(true)
    try {
      let monthly = items.find(i => i.type === 'MONTHLY')
      if (!monthly) {
        const g = await generateReport('MONTHLY')
        monthly = g.data
        await load()
      }
      await view(monthly.id)
    } catch (e) {
      alert('월간 리포트 보기 실패: ' + (e?.response?.data?.message ?? e.message))
    } finally { setGenerating(false) }
  }

  async function download(item) {
    try {
      const res = await downloadReport(item.id)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${item.title}.txt`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const types    = [...new Set(items.map(i => i.type))]
  const filtered = items.filter(i => typeFilter === 'all' || i.type === typeFilter)

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">리포트</h2>
          <p className="text-xs text-gray-500 mt-1">시스템 운영 보고서 및 분석 리포트</p>
        </div>
        <div className="flex gap-2">
          <button onClick={viewMonthly} disabled={generating}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            <Eye className="w-3.5 h-3.5" /> 월간 운영 리포트 바로 보기
          </button>
          <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <select value={genType} onChange={e => setGenType(e.target.value)}
            className="text-xs px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500">
            {GEN_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 disabled:opacity-50">
            <BarChart3 className="w-3.5 h-3.5" /> {generating ? '생성 중...' : '리포트 생성'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체',      value: items.length, color: 'text-white' },
          { label: '다운로드 가능', value: items.filter(i => i.status === 'READY').length, color: 'text-green-400' },
          { label: '생성 중',   value: items.filter(i => i.status === 'GENERATING').length, color: 'text-yellow-400' },
          { label: '리포트 유형', value: types.length, color: 'text-blue-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {['all', ...types].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors ${typeFilter === t ? 'bg-blue-600/20 border-blue-600/40 text-blue-400' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
            {t === 'all' ? '전체' : (TYPE_LABELS[t] ?? t)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {loading && filtered.length === 0
          ? <div className="text-center py-16 text-gray-500">로딩 중...</div>
          : filtered.map(item => (
            <div key={item.id} className="card-bg rounded-xl p-5 flex items-center justify-between hover:border-gray-600 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-gray-800`}>
                  <FileText className={`w-5 h-5 ${TYPE_COLORS[item.type] ?? 'text-gray-400'}`} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{item.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] ${TYPE_COLORS[item.type] ?? 'text-gray-400'}`}>{TYPE_LABELS[item.type] ?? item.type}</span>
                    <span className="text-gray-700">·</span>
                    <span className="text-[10px] text-gray-500">{item.createdAt}</span>
                    {item.size && <><span className="text-gray-700">·</span><span className="text-[10px] text-gray-500">{item.size}</span></>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={statusBadge(item.status)}>{item.status === 'READY' ? '완료' : '생성 중'}</span>
                {item.status === 'READY' && (
                  <>
                    <button onClick={() => view(item.id)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700/40 border border-gray-700 text-gray-200 hover:bg-gray-700/70">
                      <Eye className="w-3.5 h-3.5" /> 보기
                    </button>
                    <button onClick={() => download(item)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20">
                      <Download className="w-3.5 h-3.5" /> 다운로드
                    </button>
                  </>
                )}
                <button onClick={() => del(item)} title="삭제"
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-500/40">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {item.status === 'GENERATING' && (
                  <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-yellow-500 animate-pulse rounded-full" style={{ width: '60%' }} />
                  </div>
                )}
              </div>
            </div>
          ))
        }
      </div>

      {/* 리포트 바로 보기 모달 */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={e => e.target === e.currentTarget && setViewing(null)}>
          <div className="card-bg rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold text-white">{viewing.title}</span>
              </div>
              <button onClick={() => setViewing(null)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="overflow-auto p-6 text-[12px] leading-relaxed text-gray-300 whitespace-pre-wrap font-mono">
              {viewing.content || '(내용 없음)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
