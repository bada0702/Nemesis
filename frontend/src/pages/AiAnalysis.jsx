import React, { useEffect, useState, useCallback } from 'react'
import { Bot, RefreshCw, Play, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { getClusters, getClusterStatus, triggerAiAnalysis, getAiAnalysisResult, executeAgentCommand } from '../api/client'
import { useAuth } from '../auth/AuthContext'

const RISK_COLORS = {
  LOW:    'text-green-400 bg-green-500/10 border-green-500/20',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  HIGH:   'text-red-400 bg-red-500/10 border-red-500/20',
}
const RISK_LABELS = { LOW: '낮음', MEDIUM: '중간', HIGH: '높음' }

function ExecuteConfirmModal({ nodeId, command, onClose }) {
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState(null)

  async function run() {
    setRunning(true)
    try {
      const r = await executeAgentCommand(nodeId, { command })
      setResult(r.data)
    } catch (e) {
      setResult({ error: e.response?.data?.error ?? e.message })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => !result && e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <h3 className="text-sm font-bold text-white mb-4">명령어 실행 확인</h3>
        <p className="text-xs text-gray-400 mb-3">다음 명령어를 실행합니다:</p>
        <code className="block bg-black/40 rounded-lg px-4 py-3 text-xs text-green-400 font-mono mb-4 break-all">
          {command}
        </code>

        {result ? (
          <div className="space-y-2 mb-4">
            {result.error && <p className="text-xs text-red-400">오류: {result.error}</p>}
            {result.stdout && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase mb-1">stdout</p>
                <pre className="bg-black/40 rounded px-3 py-2 text-xs text-gray-300 font-mono overflow-x-auto max-h-32">{result.stdout}</pre>
              </div>
            )}
            {result.stderr && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase mb-1">stderr</p>
                <pre className="bg-black/40 rounded px-3 py-2 text-xs text-red-300 font-mono overflow-x-auto max-h-32">{result.stderr}</pre>
              </div>
            )}
            {result.exitCode !== undefined && (
              <p className="text-xs text-gray-500">
                종료 코드: <span className={result.exitCode === 0 ? 'text-green-400' : 'text-red-400'}>{result.exitCode}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-yellow-400 mb-4">⚠ 실제 노드에서 즉시 실행됩니다. 계속하시겠습니까?</p>
        )}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white">
            {result ? '닫기' : '취소'}
          </button>
          {!result && (
            <button onClick={run} disabled={running}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700 flex items-center justify-center gap-2">
              {running
                ? <><div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />실행 중...</>
                : <><Play className="w-3 h-3" />실행</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AiAnalysis() {
  const [nodes,        setNodes]        = useState([])
  const [selectedId,   setSelectedId]   = useState(null)
  const [analysis,     setAnalysis]     = useState(null)
  const [analyzing,    setAnalyzing]    = useState(false)
  const [loadingNodes, setLoadingNodes] = useState(true)
  const [execModal,    setExecModal]    = useState(null)
  const { isOperator } = useAuth()

  useEffect(() => {
    async function loadNodes() {
      try {
        const listRes  = await getClusters()
        const statuses = await Promise.all(
          listRes.data.map(c => getClusterStatus(c.id).catch(() => null))
        )
        const allNodes = statuses.flatMap(s => s?.data?.nodes ?? [])
        setNodes(allNodes)
        if (allNodes.length > 0) setSelectedId(allNodes[0].nodeId)
      } catch { /* ignore */ }
      finally { setLoadingNodes(false) }
    }
    loadNodes()
  }, [])

  const loadAnalysis = useCallback(async (nodeId) => {
    if (!nodeId) return
    try {
      const r = await getAiAnalysisResult(nodeId)
      setAnalysis(r.data)
    } catch (e) {
      if (e.response?.status === 404) setAnalysis(null)
    }
  }, [])

  useEffect(() => { loadAnalysis(selectedId) }, [selectedId, loadAnalysis])

  async function handleAnalyze() {
    if (!selectedId) return
    setAnalyzing(true)
    try {
      await triggerAiAnalysis(selectedId)
      await loadAnalysis(selectedId)
    } catch (e) {
      alert('분석 실패: ' + (e.response?.data?.message ?? e.message))
    } finally {
      setAnalyzing(false)
    }
  }

  const selectedNode = nodes.find(n => n.nodeId === selectedId)

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" /> AI 장애 분석
          </h2>
          <p className="text-xs text-gray-500 mt-1">에러 로그를 AI가 분석하고 수정 명령어를 제안합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          {!loadingNodes && nodes.length > 0 && (
            <select value={selectedId ?? ''} onChange={e => setSelectedId(e.target.value)}
              className="text-xs bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500">
              {nodes.map(n => <option key={n.nodeId} value={n.nodeId}>{n.hostname ?? n.nodeId}</option>)}
            </select>
          )}
          <button onClick={handleAnalyze} disabled={analyzing || !selectedId}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {analyzing
              ? <><div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />분석 중...</>
              : <><RefreshCw className="w-3.5 h-3.5" />다시 분석</>}
          </button>
        </div>
      </div>

      {!analysis && !analyzing && (
        <div className="card-bg rounded-xl p-12 flex flex-col items-center gap-4 text-gray-500">
          <Bot className="w-12 h-12 opacity-20" />
          <p className="text-sm">분석 결과가 없습니다.</p>
          <p className="text-xs text-center">
            에이전트가 에러 로그를 push하면 자동 분석되거나,<br/>
            "다시 분석" 버튼을 눌러 수동으로 시작할 수 있습니다.
          </p>
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          <div className="card-bg rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {analysis.status === 'DONE'
                ? <CheckCircle className="w-4 h-4 text-green-400" />
                : analysis.status === 'ANALYZING'
                ? <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                : <AlertTriangle className="w-4 h-4 text-yellow-400" />}
              <span className="text-xs text-gray-300">
                노드: <span className="text-white font-medium">{selectedNode?.hostname ?? selectedId}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <Clock className="w-3 h-3" />
              {analysis.createdAt ? new Date(analysis.createdAt).toLocaleString('ko-KR') : '—'}
              <span className={`px-1.5 py-0.5 rounded ${analysis.triggerType === 'AUTO' ? 'bg-gray-700 text-gray-400' : 'bg-blue-500/20 text-blue-400'}`}>
                {analysis.triggerType === 'AUTO' ? '자동' : '수동'}
              </span>
            </div>
          </div>

          <div className="card-bg rounded-xl p-6">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">근본 원인</p>
            <p className="text-sm text-gray-200 leading-relaxed">{analysis.rootCause ?? '분석 중...'}</p>
          </div>

          {analysis.fixCommands && analysis.fixCommands.length > 0 && (
            <div className="card-bg rounded-xl p-6">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-4">수정 명령어</p>
              <div className="space-y-3">
                {analysis.fixCommands.map((cmd, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-black/20">
                    <span className="text-[10px] text-gray-600 font-mono mt-0.5 shrink-0">{cmd.order ?? i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <code className="block text-xs text-green-400 font-mono mb-1 break-all">{cmd.command}</code>
                      {cmd.description && <p className="text-[10px] text-gray-500">{cmd.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded border ${RISK_COLORS[cmd.risk] ?? RISK_COLORS.LOW}`}>
                        {RISK_LABELS[cmd.risk] ?? '낮음'}
                      </span>
                      <button
                        onClick={() => setExecModal({ nodeId: selectedId, command: cmd.command })}
                        disabled={!isOperator}
                        title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-blue-600/20 border border-blue-600/30 text-blue-400 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Play className="w-3 h-3" /> 실행
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {execModal && (
        <ExecuteConfirmModal
          nodeId={execModal.nodeId}
          command={execModal.command}
          onClose={() => setExecModal(null)}
        />
      )}
    </div>
  )
}
