import React, { useEffect, useState, useCallback } from 'react'
import { browseNodeDirs } from '../api/client'

export default function DirBrowserModal({ clusterId, node, onPick, onClose }) {
  const [path, setPath] = useState('/')
  const [dirs, setDirs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (p) => {
    setLoading(true); setError(null)
    try {
      const r = await browseNodeDirs(clusterId, node.nodeId, p)
      setDirs(r.data.dirs || []); setPath(r.data.path || p)
    } catch (e) {
      setError(e.response?.data?.message || '탐색 실패')
    } finally { setLoading(false) }
  }, [clusterId, node])

  useEffect(() => { load('/') }, [load])

  function enter(name) {
    const next = path.endsWith('/') ? path + name : path + '/' + name
    load(next)
  }
  function up() {
    if (path === '/') return
    const parent = path.replace(/\/[^/]+\/?$/, '') || '/'
    load(parent)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-[480px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-200">{node.hostname} 폴더 선택</span>
          <button onClick={up} className="text-xs text-sky-400">상위로</button>
        </div>
        <div className="px-4 py-2 text-xs font-mono text-slate-400 border-b border-slate-800 truncate">{path}</div>
        <div className="flex-1 overflow-auto p-2">
          {loading && <div className="text-xs text-slate-500 p-2">불러오는 중...</div>}
          {error && <div className="text-xs text-red-400 p-2">{error}</div>}
          {!loading && dirs.length === 0 && <div className="text-xs text-slate-600 p-2">하위 폴더 없음</div>}
          {dirs.map(d => (
            <button key={d} onClick={() => enter(d)}
              className="w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 rounded font-mono">
              <span className="material-icons text-amber-400 text-sm align-middle mr-1">folder</span>{d}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-slate-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400">취소</button>
          <button onClick={() => onPick(path)} className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded">이 폴더 선택</button>
        </div>
      </div>
    </div>
  )
}
