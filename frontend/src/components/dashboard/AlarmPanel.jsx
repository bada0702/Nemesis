import React, { useState } from 'react'
import { AlertTriangle, Info, AlertCircle, X, CheckCircle2 } from 'lucide-react'

const LEVEL = {
  CRITICAL: { Icon: AlertCircle, cls: 'status-red',    label: '치명' },
  WARNING:  { Icon: AlertTriangle, cls: 'status-orange', label: '경고' },
  INFO:     { Icon: Info,         cls: 'status-blue',  label: '정보' },
}

const fmt = (when) => (when ? new Date(when).toLocaleString('ko-KR') : '—')

// 알람 메시지를 분류해 문제 내용과 해결 방안을 제공하는 지식 기반.
// (백엔드 알람 메시지: "<host> CPU 95% 초과" / "Memory" / "Disk" / "<host> 노드 장애 감지")
const KB = {
  cpu: {
    title: 'CPU 사용률 초과',
    problem: 'CPU 사용률이 임계치를 초과했습니다. 이 상태가 지속되면 응답 지연, 요청 큐 적체, 타임아웃이 발생하고 심하면 서비스가 멈출 수 있습니다.',
    actions: [
      'top / ps aux --sort=-%cpu 로 CPU를 많이 쓰는 프로세스를 식별하세요.',
      '비정상·폭주 프로세스라면 재기동하거나 종료하세요.',
      '배치/크론 작업이 원인이면 실행 시간대를 분산하세요.',
      '상시 부하가 높으면 스케일아웃(노드 증설) 또는 부하 분산을 검토하세요.',
    ],
  },
  mem: {
    title: '메모리 사용률 초과',
    problem: '메모리 사용률이 임계치를 초과했습니다. 스왑이 과도해지면 성능이 급격히 저하되고, 한계에 도달하면 OOM Killer가 프로세스를 강제 종료할 수 있습니다.',
    actions: [
      'free -m / ps aux --sort=-%mem 으로 메모리 점유 상위 프로세스를 확인하세요.',
      '메모리 누수가 의심되는 프로세스(WAS 등)는 재기동하세요.',
      'JVM이라면 힙(-Xmx) 설정과 GC 로그를 점검하세요.',
      '캐시/버퍼를 정리하거나, 상시 부족하면 메모리를 증설하세요.',
    ],
  },
  disk: {
    title: '디스크 사용률 초과',
    problem: '디스크 사용률이 임계치를 초과했습니다. 파티션이 가득 차면 로그·데이터 쓰기가 실패하고 DB·애플리케이션이 중단될 수 있습니다.',
    actions: [
      'df -h 로 어떤 파티션이 찼는지, du -sh /* 로 대용량 디렉토리를 확인하세요.',
      '오래된 로그·임시 파일·코어 덤프를 삭제하세요.',
      '로그 로테이션(logrotate) 정책을 점검·적용하세요.',
      '정리 후에도 부족하면 볼륨 확장 또는 디스크를 증설하세요.',
    ],
  },
  node: {
    title: '노드 장애 감지',
    problem: '해당 노드의 heartbeat가 수신되지 않아 다운으로 판단되었습니다. Active 노드라면 페일오버 대상이 될 수 있습니다.',
    actions: [
      '노드의 전원·네트워크·에이전트(서비스) 상태를 확인하세요.',
      'ping / 명령채널 연결로 실제 통신 가능 여부를 점검하세요.',
      '복구가 어려우면 Standby로의 수동 전환(Failover)을 검토하세요.',
      '복구 후 동기화 상태와 VIP 위치를 확인하세요.',
    ],
  },
  generic: {
    title: '시스템 알람',
    problem: '시스템에서 감지된 이벤트입니다. 메시지 내용을 확인하고 관련 자원·서비스 상태를 점검하세요.',
    actions: [
      '대상 호스트와 서비스의 현재 상태를 확인하세요.',
      '관련 로그(애플리케이션/시스템)를 확인하세요.',
    ],
  },
}

// 메시지 텍스트로 알람 유형과 측정값(%)을 추출한다.
function classify(message = '') {
  const m = message
  let kind = 'generic'
  if (/CPU/i.test(m)) kind = 'cpu'
  else if (/Memory|메모리|\bMEM\b/i.test(m)) kind = 'mem'
  else if (/Disk|디스크/i.test(m)) kind = 'disk'
  else if (/노드 장애|fault|다운/i.test(m)) kind = 'node'
  const pct = (m.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1] || null
  return { kind, info: KB[kind], pct }
}

export default function AlarmPanel({ items = [], onClear, className = '' }) {
  const [selected, setSelected] = useState(null)

  return (
    <div className={`card-bg rounded-xl p-6 flex flex-col overflow-hidden ${className}`}>
      {/* ── 실시간 알람 ── */}
      <div className="flex justify-between items-center gap-2 mb-3 shrink-0">
        <h3 className="text-sm font-bold text-white whitespace-nowrap truncate">
          실시간 알람
          {items.length > 0 && <span className="ml-1 text-[10px] font-normal text-gray-500">({items.length})</span>}
        </h3>
        {items.length > 0 && onClear && (
          <button onClick={onClear}
            className="text-[10px] text-gray-500 hover:text-white px-1.5 py-1 whitespace-nowrap shrink-0">지우기</button>
        )}
      </div>
      {/* flex-1 min-h-0 가 있어야 패널 높이 안에서 스크롤이 동작(없으면 패널이 늘어남) */}
      <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
        {items.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-xs">알람 없음</div>
        ) : (
          items.map((item, i) => {
            const s = LEVEL[item.level] ?? LEVEL.INFO
            const Icon = s.Icon
            const when = item.ts ?? item.createdAt
            return (
              <button key={`${item.level}|${item.message}|${when ?? i}`}
                onClick={() => setSelected({ ...item, when })}
                className="w-full flex space-x-3 text-left rounded-lg px-1 py-1 -mx-1 hover:bg-white/5 transition-colors">
                <div className="mt-1 shrink-0">
                  <Icon className={`w-4 h-4 ${s.cls}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-bold ${s.cls} truncate`}>{item.message}</p>
                  <p className="text-[10px] text-gray-500 mt-1">{fmt(when)}</p>
                </div>
              </button>
            )
          })
        )}
      </div>

      {selected && <AlarmDetailModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function AlarmDetailModal({ item, onClose }) {
  const s = LEVEL[item.level] ?? LEVEL.INFO
  const Icon = s.Icon
  const { info, pct } = classify(item.message)
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${s.cls}`} />
            <span className={`text-sm font-bold ${s.cls}`}>{s.label} 알람 · {info.title}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">알람 내용</div>
            <p className="text-sm text-slate-100 break-words">{item.message}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">발생 시각</div>
              <p className="text-sm text-slate-300 font-mono">{fmt(item.when)}</p>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">심각도</div>
              <p className={`text-sm font-bold ${s.cls}`}>{item.level} ({s.label})</p>
            </div>
            {pct && (
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">측정값</div>
                <p className="text-sm text-slate-100 font-mono">{pct}%</p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
            <div className="text-[11px] font-bold text-amber-300 mb-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> 문제 내용
            </div>
            <p className="text-sm text-slate-200 leading-relaxed">{info.problem}</p>
          </div>

          <div className="rounded-lg border border-emerald-700/40 bg-emerald-500/5 p-3">
            <div className="text-[11px] font-bold text-emerald-300 mb-2 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> 해결 방안
            </div>
            <ol className="space-y-1.5 list-decimal list-inside text-sm text-slate-200 leading-relaxed">
              {info.actions.map((a, i) => <li key={i}>{a}</li>)}
            </ol>
          </div>
        </div>
        <div className="flex justify-end p-3 border-t border-slate-700 shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded">닫기</button>
        </div>
      </div>
    </div>
  )
}
