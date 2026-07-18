import React, { useEffect, useState, useCallback } from 'react'
import { Bell, HelpCircle, User, Menu, LogOut, X, Trash2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, roleLabel } from '../auth/AuthContext'
import { getAiNotifications, deleteAiFinding, rejectAiProposal } from '../api/client'

const PAGE_TITLES = {
  '/':                     { title: '대시보드',      sub: '전체 시스템의 상태를 한눈에 확인합니다.' },
  '/ai':                   { title: 'AI 운영 센터',  sub: 'AI 이상 징후·장애 예측·조치 승인을 관리합니다.' },
  '/ai/analysis':          { title: 'AI 장애 분석',  sub: '에러 로그를 AI가 분석하고 수정 명령어를 제안합니다.' },
  '/help':                 { title: '도움말',        sub: 'NEMESIS 사용 방법과 주요 기능 안내.' },
  '/clusters/tree':        { title: '트리 뷰',       sub: '클러스터 구성을 트리 형태로 확인합니다.' },
  '/ha/groups':            { title: '클러스터 목록', sub: '등록된 HA 클러스터를 관리합니다.' },
  '/settings/clusters':    { title: '클러스터 설정', sub: 'VIP·노드·Failover 정책을 설정합니다.' },
  '/ha/sequence':          { title: 'HA 운영 절차',  sub: '기동·중지·Failover 절차 및 Runbook을 관리합니다.' },
  '/services':             { title: '서비스 카탈로그', sub: '논리 서비스 등록·HA 대상 지정·노드별 상태를 관리합니다.' },
  '/services?type=DB':     { title: 'DB',            sub: '데이터베이스 서비스 상태를 확인합니다.' },
  '/services?type=APP':    { title: 'Application',   sub: '애플리케이션 서비스 상태를 확인합니다.' },
  '/docker/containers':    { title: '컨테이너',      sub: '컨테이너 실행 상태를 확인합니다.' },
  '/docker/images':        { title: '이미지',        sub: 'Docker 이미지 현황을 확인합니다.' },
  '/inspection':           { title: '점검 관리',     sub: '정기 점검 일정을 관리합니다.' },
  '/reports':              { title: '리포트',        sub: '장애·Failover 이력 및 가동률 통계를 조회합니다.' },
  '/settings/system':      { title: '시스템 설정',   sub: 'Nemesis 환경설정 및 시스템 정보를 관리합니다.' },
  '/settings/knowledge':   { title: '지식베이스',    sub: 'AI 장애 조사에 주입되는 장애 지식 파일을 편집합니다.' },
  '/settings/agents':      { title: '에이전트 관리', sub: '노드 에이전트 상태를 관리합니다.' },
  '/settings/agents/install': { title: '에이전트 설치', sub: 'SSH로 대상 서버에 Nemesis 에이전트를 원격 설치합니다.' },
  '/alerts':               { title: '알람 현황',     sub: '발생한 알람 목록을 확인합니다.' },
  '/alerts/config':        { title: '알람 설정',     sub: '알람 규칙을 설정합니다.' },
  '/servers/list':         { title: '서버 현황',     sub: '전체 노드 목록 및 리소스 상태를 확인합니다.' },
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']

export default function Navbar({ onMenuToggle }) {
  const location = useLocation()
  const { user, logout, isOperator } = useAuth()
  const [now, setNow] = useState('')
  const [notif, setNotif] = useState({ pending: 0, recent: [], openFindings: 0, recentFindings: [] })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)   // 처리 중인 항목 id
  const alertCount = (notif.pending ?? 0) + (notif.openFindings ?? 0)

  const loadNotif = useCallback(() => getAiNotifications()
    .then(r => setNotif(r.data)).catch(() => {}), [])

  useEffect(() => {
    let alive = true
    const load = () => { if (alive) loadNotif() }
    load()
    const id = setInterval(load, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [loadNotif])

  // 헤더 알림에서 직접 정리: finding 은 삭제, proposal(제안 대기)은 반려(dismiss).
  async function removeFinding(id) {
    setBusy(id)
    try { await deleteAiFinding(id) } catch { /* 무시 */ }
    finally { await loadNotif(); setBusy(null) }
  }
  async function dismissProposal(id) {
    setBusy(id)
    try { await rejectAiProposal(id) } catch { /* 무시 */ }
    finally { await loadNotif(); setBusy(null) }
  }

  const navigate = useNavigate()
  const page = PAGE_TITLES[location.pathname + location.search]
    ?? PAGE_TITLES[location.pathname]
    ?? { title: 'NEMESIS', sub: '' }

  useEffect(() => {
    const fmt = () => {
      const d = new Date()
      const ymd = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`
      const day = DAY_KO[d.getDay()]
      const hms = d.toLocaleTimeString('ko-KR', { hour12: false })
      setNow(`${ymd} (${day}) ${hms}`)
    }
    fmt()
    const id = setInterval(fmt, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="flex items-center justify-between px-4 md:px-8 py-4 bg-transparent">
      <div className="flex items-center space-x-3">
        <button
          onClick={onMenuToggle}
          className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
          aria-label="메뉴 열기"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-baseline space-x-3">
          <h2 className="text-lg md:text-xl font-semibold text-white">{page.title}</h2>
          <span className="text-sm text-gray-400 hidden sm:block">{page.sub}</span>
        </div>
      </div>

      <div className="flex items-center space-x-6 text-sm">
        <span className="text-gray-300">{now}</span>
        <div className="flex items-center space-x-4">
          <div className="relative">
            <button onClick={() => setOpen(o => !o)} className="relative p-1" aria-label="알림">
              <Bell className="w-5 h-5 text-gray-400" />
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                  {alertCount}
                </span>
              )}
            </button>
            {open && (
              <div className="absolute right-0 mt-2 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 p-2 text-xs">
                <p className="text-gray-400 px-2 py-1">AI 알림 (제안 대기 {notif.pending} · 열린 이슈 {notif.openFindings ?? 0})</p>
                {(notif.recentFindings ?? []).map(f => (
                  <div key={f.id} className="group flex items-start gap-1 px-2 py-1.5 border-t border-gray-800 text-gray-300">
                    <span className="flex-1 min-w-0">
                      <span className="text-red-400">[{f.severity}]</span> {f.signalType} — {f.summary}
                    </span>
                    <button onClick={() => removeFinding(f.id)} disabled={busy === f.id}
                      title="이 이슈 삭제"
                      className="shrink-0 p-0.5 text-gray-600 hover:text-red-400 disabled:opacity-40">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {notif.recent.map(n => (
                  <div key={n.id} className="group flex items-start gap-1 px-2 py-1.5 border-t border-gray-800 text-gray-300">
                    <span className="flex-1 min-w-0">
                      <span className="text-amber-400">[{n.status}]</span> {n.triggerReason}
                    </span>
                    {n.status === 'PENDING' && (
                      <button onClick={() => dismissProposal(n.id)} disabled={!isOperator || busy === n.id}
                        title={isOperator ? '제안 반려(dismiss)' : 'operator 이상 권한이 필요합니다'}
                        className="shrink-0 p-0.5 text-gray-600 hover:text-amber-400 disabled:opacity-40">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
                {notif.recent.length === 0 && (notif.recentFindings ?? []).length === 0 && (
                  <p className="text-gray-600 px-2 py-2">알림 없음</p>
                )}
              </div>
            )}
          </div>
          <button onClick={() => navigate('/help')} className="p-1" aria-label="도움말" title="도움말">
            <HelpCircle className="w-5 h-5 text-gray-400 hover:text-white transition-colors" />
          </button>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
              <User className="w-5 h-5 text-gray-300" />
            </div>
            <div className="text-xs">
              <p className="font-bold text-white leading-none">{user?.username ?? '-'}</p>
              <p className="text-gray-500 text-[10px]">{roleLabel(user?.role)}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            title="로그아웃" aria-label="로그아웃">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  )
}
