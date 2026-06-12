import React, { useEffect, useState } from 'react'
import { Layers, RefreshCw, ScanSearch, Trash2 } from 'lucide-react'
import { getDockerImages } from '../../api/client'

export default function Images() {
  const [images, setImages]     = useState([])
  const [nodeFilter, setNodeFilter] = useState('all')
  const [loading, setLoading]   = useState(true)

  async function load() {
    setLoading(true)
    try { const r = await getDockerImages(); setImages(r.data.images ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const nodes    = [...new Set(images.map(i => i.node))]
  const unused   = images.filter(i => !i.used).length
  const filtered = images.filter(i => nodeFilter === 'all' || i.node === nodeFilter)

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">이미지 관리</h2>
          <p className="text-xs text-gray-500 mt-1">에이전트 명령 채널 기반 Docker 이미지 스캔</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 disabled:opacity-50">
            <ScanSearch className="w-3.5 h-3.5" /> {loading ? '스캔 중...' : '자동 스캔'}
          </button>
          {unused > 0 && (
            <button className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20">
              <Trash2 className="w-3.5 h-3.5" /> 미사용 정리 ({unused})
            </button>
          )}
          <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 이미지', value: images.length, color: 'text-white' },
          { label: '사용 중',    value: images.filter(i => i.used).length, color: 'text-green-400' },
          { label: '미사용',     value: unused, color: unused > 0 ? 'text-orange-400' : 'text-gray-500' },
          { label: '노드',       value: nodes.length, color: 'text-blue-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {['all', ...nodes].map(n => (
          <button key={n} onClick={() => setNodeFilter(n)}
            className={`text-xs px-3 py-2 rounded-lg border transition-colors ${nodeFilter === n ? 'bg-blue-600/20 border-blue-600/40 text-blue-400' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
            {n === 'all' ? '전체 노드' : n}
          </button>
        ))}
      </div>

      <div className="card-bg rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800">
            <tr className="text-gray-500 uppercase">
              {['이름','태그','노드','크기','생성일','사용 여부',''].map(h => (
                <th key={h} className="text-left py-3 px-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0
              ? <tr><td colSpan="7" className="text-center py-12 text-gray-500">로딩 중...</td></tr>
              : filtered.map((img, i) => (
                <tr key={i} className={`border-b border-gray-800/40 hover:bg-white/5 ${!img.used ? 'opacity-60' : ''}`}>
                  <td className="py-3 px-4 font-medium text-white">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-400" />
                      {img.name}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-gray-400">{img.tag}</td>
                  <td className="py-3 px-4 text-gray-400">{img.node}</td>
                  <td className="py-3 px-4 text-gray-300">{img.size}</td>
                  <td className="py-3 px-4 text-gray-500">{img.created}</td>
                  <td className="py-3 px-4">
                    {img.used
                      ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">사용 중</span>
                      : <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400">미사용</span>}
                  </td>
                  <td className="py-3 px-4">
                    {!img.used && (
                      <button className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
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
