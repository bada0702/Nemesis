import React, { useEffect, useState } from 'react'
import { Container, RefreshCw, Search, ScanSearch } from 'lucide-react'
import { getDockerContainers } from '../../api/client'
import { dot } from '../../lib/utils'

export default function Containers() {
  const [containers, setContainers] = useState([])
  const [filter, setFilter]         = useState('')
  const [nodeFilter, setNodeFilter] = useState('all')
  const [loading, setLoading]       = useState(true)
  const [errors, setErrors]         = useState([])

  // 에이전트 명령(docker ps/stats) 실행이라 주기 폴링 대신 수동 스캔으로 동작
  async function load() {
    setLoading(true)
    try {
      const r = await getDockerContainers()
      setContainers(r.data.containers ?? [])
      setErrors(r.data.errors ?? [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const nodes   = [...new Set(containers.map(c => c.node))]
  const running = containers.filter(c => c.status === 'running').length
  const filtered = containers.filter(c =>
    (nodeFilter === 'all' || c.node === nodeFilter) &&
    c.name.toLowerCase().includes(filter.toLowerCase())
  )

  function handleControl(container, action) {
    alert(`${container.name} ${action === 'start' ? '시작' : '중지'} 기능은 에이전트 명령 채널 연동 후 활성화됩니다.`)
  }

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">컨테이너 현황</h2>
          <p className="text-xs text-gray-500 mt-1">에이전트 명령 채널 기반 Docker 컨테이너 스캔</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 disabled:opacity-50">
            <ScanSearch className="w-3.5 h-3.5" /> {loading ? '스캔 중...' : '자동 스캔'}
          </button>
          <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">
          일부 노드 스캔 실패: {errors.join(' · ')}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체',   value: containers.length, color: 'text-white' },
          { label: '실행 중', value: running, color: 'text-green-400' },
          { label: '중지',   value: containers.length - running, color: containers.length - running > 0 ? 'text-red-400' : 'text-gray-500' },
          { label: '노드',   value: nodes.length, color: 'text-blue-400' },
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
            placeholder="컨테이너명 검색..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none" />
        </div>
        <select value={nodeFilter} onChange={e => setNodeFilter(e.target.value)}
          className="text-xs bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 outline-none">
          <option value="all">전체 노드</option>
          {nodes.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="card-bg rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800">
            <tr className="text-gray-500 uppercase">
              {['','이름','이미지','상태','노드','포트','CPU','메모리','생성일',''].map((h, i) => (
                <th key={i} className="text-left py-3 px-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0
              ? <tr><td colSpan="10" className="text-center py-12 text-gray-500">로딩 중...</td></tr>
              : filtered.map((c, i) => (
                <tr key={i} className="border-b border-gray-800/40 hover:bg-white/5">
                  <td className="py-3 px-3">
                    <Container className={`w-4 h-4 ${dot(c.status)}`} />
                  </td>
                  <td className="py-3 px-3 font-medium text-white">{c.name}</td>
                  <td className="py-3 px-3 text-gray-400 font-mono text-[10px]">{c.image}</td>
                  <td className="py-3 px-3">
                    <span className={`${dot(c.status)} font-medium`}>● {c.status}</span>
                  </td>
                  <td className="py-3 px-3 text-gray-400">{c.node}</td>
                  <td className="py-3 px-3 text-gray-500 font-mono text-[10px]">{c.ports}</td>
                  <td className="py-3 px-3 text-gray-300">{c.cpu}</td>
                  <td className="py-3 px-3 text-gray-300">{c.mem}</td>
                  <td className="py-3 px-3 text-gray-500">{c.created}</td>
                  <td className="py-3 px-3">
                    <div className="flex gap-1">
                      {c.status !== 'running'
                        ? <button onClick={() => handleControl(c, 'start')} className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20">시작</button>
                        : <button onClick={() => handleControl(c, 'stop')} className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">중지</button>}
                      <button className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400">로그</button>
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
