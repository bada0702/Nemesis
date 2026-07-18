import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Terminal, CheckCircle, XCircle, Loader, ChevronRight, ArrowLeft } from 'lucide-react'
import { getClusters, testAgentInstall, startAgentInstall, getClusterAgentKeys, createAgentKey } from '../../api/client'
import { getToken } from '../../api/token'

const inputCls = "w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500"

// 설치 단계별 대략적 진행률 — 백엔드 emit() 문구와 매칭
const INSTALL_STAGES = [
  { match: 'SSH 연결 중',          pct: 10 },
  { match: 'SSH 연결 완료',        pct: 20 },
  { match: '원격 디렉토리 생성',   pct: 30 },
  { match: 'install.sh 실행 중',   pct: 50 },
  { match: '에이전트 시작 중',     pct: 80 },
  { match: '관리서버 등록 확인 중', pct: 90 },
]

// crypto.randomUUID()는 보안 컨텍스트(HTTPS/localhost) 전용이라 평문 HTTP(:18090 등)에서
// undefined라 TypeError가 난다. getRandomValues는 제약이 없어 폴백으로 사용한다.
function genJobId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

function installProgress(logs, status) {
  if (status === 'done') return 100
  if (status === 'idle') return 0
  let pct = logs.length > 0 ? 5 : 0
  for (const line of logs) {
    for (const stage of INSTALL_STAGES) {
      if (line.includes(stage.match)) pct = Math.max(pct, stage.pct)
    }
  }
  return pct
}

// ─── Step 1: 서버 정보 ──────────────────────────────────────────────────────
function StepServerInfo({ form, setForm, clusters, onNext }) {
  const valid = form.host && form.sshUser && form.sshPassword && form.clusterId

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white">Step 1 — 대상 서버 정보</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">대상 서버 IP (Real IP)</label>
          <input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
            placeholder="10.0.1.12" className={inputCls} />
          <p className="text-[10px] text-gray-600 mt-1">NEMESIS_SERVICE_IP로 고정됩니다</p>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">핫비트 IP (선택)</label>
          <input value={form.heartbeatIp} onChange={e => setForm(f => ({ ...f, heartbeatIp: e.target.value }))}
            placeholder="비우면 서버 IP와 동일" className={inputCls} />
          <p className="text-[10px] text-gray-600 mt-1">NEMESIS_HEARTBEAT_IP — 별도 NIC 사용 시</p>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">SSH 사용자명</label>
          <input value={form.sshUser} onChange={e => setForm(f => ({ ...f, sshUser: e.target.value }))}
            placeholder="root" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">SSH 비밀번호</label>
          <input type="password" value={form.sshPassword}
            onChange={e => setForm(f => ({ ...f, sshPassword: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">SSH 포트</label>
          <input type="number" value={form.sshPort}
            onChange={e => setForm(f => ({ ...f, sshPort: +e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">클러스터</label>
          <select value={form.clusterId} onChange={e => setForm(f => ({ ...f, clusterId: e.target.value }))}
            className={inputCls}>
            <option value="">— 선택 —</option>
            {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">노드 역할</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            className={inputCls}>
            <option value="STANDBY">STANDBY</option>
            <option value="PRIMARY">PRIMARY</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <button onClick={onNext} disabled={!valid}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700">
          다음 — 연결 검증 <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: 연결 검증 ──────────────────────────────────────────────────────
function CheckRow({ label, ok, error, pending }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-800/50 last:border-0">
      <div className="w-5 h-5 flex-shrink-0 mt-0.5">
        {pending    ? <Loader      className="w-4 h-4 text-blue-400 animate-spin" /> :
         ok         ? <CheckCircle className="w-4 h-4 text-green-400" /> :
                      <XCircle     className="w-4 h-4 text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-white">{label}</span>
        {error && <p className="text-[10px] text-red-400 mt-0.5 break-words">{error}</p>}
      </div>
    </div>
  )
}

function StepConnTest({ form, onNext, onBack }) {
  const [state,  setState]  = useState('idle')
  const [result, setResult] = useState(null)

  async function runTest() {
    setState('testing')
    setResult(null)
    try {
      const r = await testAgentInstall({
        host:        form.host,
        sshPort:     form.sshPort,
        sshUser:     form.sshUser,
        sshPassword: form.sshPassword,
        heartbeatIp: form.heartbeatIp || null,
        clusterId:   form.clusterId   || null,
      })
      setResult(r.data)
    } catch (e) {
      setResult({ sshOk: false, sshError: e.message, peerChecks: [] })
    } finally {
      setState('done')
    }
  }

  const allOk = result &&
    result.sshOk &&
    (result.peerChecks ?? []).every(p => p.reachable)

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white">Step 2 — 연결 검증</h3>

      {state === 'idle' && (
        <div className="rounded-xl border border-gray-800 p-6 text-center space-y-3">
          <p className="text-xs text-gray-400">SSH 연결과 기존 클러스터 노드와의 핫비트(17000) 통신을 일괄 확인합니다.</p>
          <button onClick={runTest}
            className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
            연결 검증 시작
          </button>
        </div>
      )}

      {state === 'testing' && !result && (
        <div className="rounded-xl border border-gray-800 p-5 space-y-1">
          <CheckRow label={`SSH 접속 (${form.host}:${form.sshPort})`} ok={false} pending />
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-gray-800 p-5 space-y-0">
          <CheckRow label={`SSH 접속 (${form.host}:${form.sshPort})`}
            ok={result.sshOk} error={result.sshError} pending={false} />
          {(result.peerChecks ?? []).map(p => (
            <CheckRow key={p.nodeHostname}
              label={`${form.host} → ${p.nodeHostname} (${p.heartbeatIp}:17000) 핫비트`}
              ok={p.reachable} error={p.error} pending={false} />
          ))}
        </div>
      )}

      {state === 'done' && !allOk && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between gap-4">
          <p className="text-xs text-yellow-400">일부 항목이 실패했습니다. 방화벽 또는 포트 설정을 확인하세요.</p>
          <button onClick={() => onNext(true)}
            className="text-xs text-yellow-400 underline whitespace-nowrap">경고 무시하고 진행</button>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <ArrowLeft className="w-3.5 h-3.5" /> 이전
        </button>
        <div className="flex gap-3">
          {state === 'done' && (
            <button onClick={runTest}
              className="px-4 py-2 rounded-lg border border-gray-700 text-xs text-gray-400 hover:text-white">
              재시도
            </button>
          )}
          <button onClick={() => onNext(false)} disabled={!allOk}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700">
            다음 — 설치 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 3: 설치 실행 + SSE 로그 ──────────────────────────────────────────
function StepInstall({ form, onBack }) {
  const navigate = useNavigate()
  const [keys,    setKeys]   = useState([])
  const [apiKey,  setApiKey] = useState('')
  const [issuing, setIssuing]= useState(false)
  const [logs,    setLogs]   = useState([])
  const [status,  setStatus] = useState('idle')
  const logRef  = useRef(null)
  const esRef   = useRef(null)

  useEffect(() => {
    if (!form.clusterId) return
    getClusterAgentKeys(form.clusterId)
      .then(r => { setKeys(r.data); if (r.data.length > 0) setApiKey(r.data[0].apiKey) })
      .catch(() => {})
  }, [form.clusterId])

  async function handleIssueKey() {
    setIssuing(true)
    try {
      const { data } = await createAgentKey(form.clusterId)
      const { data: refreshed } = await getClusterAgentKeys(form.clusterId)
      setKeys(refreshed)
      setApiKey(data.apiKey)
    } catch (e) {
      alert('키 발급 실패: ' + (e.response?.data?.error ?? e.message))
    } finally {
      setIssuing(false)
    }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => () => { if (esRef.current) esRef.current.close() }, [])

  async function runInstall() {
    const jobId = genJobId()
    setLogs([])
    setStatus('running')

    const token = getToken()
    const es = new EventSource(`/api/agent-install/stream/${jobId}${token ? '?token=' + token : ''}`)
    esRef.current = es

    es.onmessage = e => {
      setLogs(prev => [...prev, e.data])
      if (e.data.startsWith('[SUCCESS]')) { setStatus('done');  es.close() }
      if (e.data.startsWith('[ERROR]'))   { setStatus('error'); es.close() }
    }
    es.onerror = () => {
      es.close()
      setStatus(s => {
        if (s !== 'running') return s
        setLogs(prev => [...prev, '[ERROR] 진행 로그 스트림 연결 실패 — 네트워크 상태를 확인하세요'])
        return 'error'
      })
    }

    try {
      await startAgentInstall({
        jobId,
        host:        form.host,
        sshPort:     form.sshPort,
        sshUser:     form.sshUser,
        sshPassword: form.sshPassword,
        heartbeatIp: form.heartbeatIp || null,
        clusterId:   form.clusterId,
        role:        form.role,
        apiKey,
      })
    } catch (e) {
      setLogs(prev => [...prev, '[ERROR] 설치 요청 실패: ' + e.message])
      setStatus('error')
      es.close()
    }
  }

  const lineColor = line => {
    if (line.startsWith('[SUCCESS]')) return 'text-green-400'
    if (line.startsWith('[ERROR]'))   return 'text-red-400'
    if (line.startsWith('[WARN]'))    return 'text-yellow-400'
    return 'text-gray-300'
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white">Step 3 — 설치 실행</h3>

      {status === 'idle' && (
        <div className="rounded-xl border border-gray-800 p-5 space-y-4">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">에이전트 API 키</label>
            <div className="flex gap-2">
              <div className="flex-1">
                {keys.length > 0 ? (
                  <select value={apiKey} onChange={e => setApiKey(e.target.value)} className={inputCls}>
                    {keys.map(k => (
                      <option key={k.id} value={k.apiKey}>{k.label} — {k.apiKey.slice(0, 12)}…</option>
                    ))}
                  </select>
                ) : (
                  <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                    placeholder="API 키를 직접 입력" className={inputCls} />
                )}
              </div>
              <button type="button" onClick={handleIssueKey} disabled={issuing || !form.clusterId}
                className="px-3 py-2 rounded-lg text-xs bg-gray-800 border border-gray-700 text-white hover:bg-gray-700 disabled:opacity-50 whitespace-nowrap">
                {issuing ? '발급 중...' : '새 키 발급'}
              </button>
            </div>
          </div>
          <div className="rounded-lg bg-gray-900/60 p-3 text-xs text-gray-500 space-y-1">
            <p>• 대상: <span className="text-white font-mono">{form.host}</span></p>
            <p>• NEMESIS_SERVICE_IP: <span className="text-blue-400 font-mono">{form.host}</span></p>
            <p>• NEMESIS_HEARTBEAT_IP: <span className="text-blue-400 font-mono">{form.heartbeatIp || form.host}</span></p>
            <p>• 역할: <span className="text-white">{form.role}</span></p>
            <p>• 클러스터 ID: <span className="text-gray-400 font-mono text-[10px]">{form.clusterId}</span></p>
          </div>
        </div>
      )}

      {(status === 'running' || status === 'error' || logs.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>
              {status === 'running' ? '설치 진행 중...' :
               status === 'error'   ? '설치 실패' :
               status === 'done'    ? '설치 완료' : ''}
            </span>
            <span>{installProgress(logs, status)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${installProgress(logs, status)}%` }}
            />
          </div>
        </div>
      )}

      {(status === 'running' || logs.length > 0) && (
        <div ref={logRef}
          className="bg-gray-950 border border-gray-800 rounded-xl p-4 h-64 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.length === 0 && (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader className="w-3 h-3 animate-spin" /> 설치 준비 중...
            </div>
          )}
          {logs.map((l, i) => <div key={i} className={lineColor(l)}>{l}</div>)}
          {status === 'running' && logs.length > 0 && (
            <div className="flex items-center gap-2 text-gray-600 mt-1">
              <Loader className="w-3 h-3 animate-spin" /> 실행 중...
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} disabled={status === 'running'}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white disabled:opacity-40">
          <ArrowLeft className="w-3.5 h-3.5" /> 이전
        </button>
        {status === 'idle' && (
          <button onClick={runInstall} disabled={!apiKey}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-green-700">
            <Terminal className="w-3.5 h-3.5" /> 설치 시작
          </button>
        )}
        {(status === 'done' || status === 'error') && (
          <button onClick={() => navigate('/settings/agents')}
            className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
            에이전트 관리로 이동
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 메인 위저드 ────────────────────────────────────────────────────────────
const STEPS = ['서버 정보', '연결 검증', '설치']

export default function AgentInstall() {
  const [step,     setStep]     = useState(0)
  const [clusters, setClusters] = useState([])
  const [form,     setForm]     = useState({
    host: '', sshPort: 22, sshUser: 'root', sshPassword: '',
    heartbeatIp: '', clusterId: '', role: 'STANDBY',
  })

  useEffect(() => {
    getClusters().then(r => setClusters(r.data)).catch(() => {})
  }, [])

  return (
    <div className="p-8 pt-0 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">에이전트 설치</h2>
        <p className="text-xs text-gray-500 mt-1">SSH를 통해 대상 서버에 Nemesis 에이전트를 원격 설치합니다</p>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="flex items-center">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
              ${i === step ? 'bg-blue-600/20 text-blue-400' :
                i < step   ? 'text-green-400' : 'text-gray-600'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0
                ${i === step ? 'bg-blue-600 text-white' :
                  i < step   ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              {s}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="w-4 h-4 text-gray-700 mx-1 flex-shrink-0" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 스텝 컨텐츠 */}
      <div className="card-bg rounded-xl p-6">
        {step === 0 && (
          <StepServerInfo form={form} setForm={setForm} clusters={clusters}
            onNext={() => setStep(1)} />
        )}
        {step === 1 && (
          <StepConnTest form={form}
            onNext={() => setStep(2)}
            onBack={() => setStep(0)} />
        )}
        {step === 2 && (
          <StepInstall form={form} onBack={() => setStep(1)} />
        )}
      </div>
    </div>
  )
}
