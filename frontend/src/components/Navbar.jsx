import React, { useEffect, useState } from 'react'
import { Bell, HelpCircle, User, Menu, LogOut } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth, roleLabel } from '../auth/AuthContext'

const PAGE_TITLES = {
  '/':                     { title: '대시보드',      sub: '전체 시스템의 상태를 한눈에 확인합니다.' },
  '/clusters/tree':        { title: '트리 뷰',       sub: '클러스터 구성을 트리 형태로 확인합니다.' },
  '/ha/groups':            { title: '클러스터 목록', sub: '등록된 HA 클러스터를 관리합니다.' },
  '/settings/clusters':    { title: '클러스터 설정', sub: 'VIP·노드·Failover 정책을 설정합니다.' },
  '/ha/sequence':          { title: 'HA 운영 절차',  sub: '기동·중지·Failover 절차 및 Runbook을 관리합니다.' },
  '/services':             { title: '서비스 카탈로그', sub: '논리 서비스 등록·HA 대상 지정·노드별 상태를 관리합니다.' },
  '/services?type=DB':     { title: 'DB',            sub: '데이터베이스 서비스 상태를 확인합니다.' },
  '/services?type=APP':    { title: 'Application',   sub: '애플리케이션 서비스 상태를 확인합니다.' },
  '/docker/containers':    { title: '컨테이너',      sub: '컨테이너 실행 상태를 확인합니다.' },
  '/inspection':           { title: '점검 관리',     sub: '정기 점검 일정을 관리합니다.' },
  '/monitoring/cluster':   { title: '클러스터 상태', sub: '복제·하트비트·에이전트 상태를 통합 확인합니다.' },
  '/reports':              { title: '리포트',        sub: '장애·Failover 이력 및 가동률 통계를 조회합니다.' },
  '/settings/system':      { title: '시스템 설정',   sub: 'Nemesis 환경설정 및 시스템 정보를 관리합니다.' },
  '/alerts':               { title: '알람 현황',     sub: '발생한 알람 목록을 확인합니다.' },
  '/alerts/config':        { title: '알람 설정',     sub: '알람 규칙을 설정합니다.' },
  '/servers/list':         { title: '노드 현황',     sub: '등록된 노드의 상태를 확인합니다.' },
  '/ai-analysis':          { title: 'AI 장애 분석',  sub: 'AI가 에러 로그를 분석하고 수정 명령어를 제안합니다.' },
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']

export default function Navbar({ onMenuToggle }) {
  const location = useLocation()
  const { user, logout } = useAuth()
  const [now, setNow] = useState('')

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
            <Bell className="w-5 h-5 text-gray-400" />
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
              3
            </span>
          </div>
          <HelpCircle className="w-5 h-5 text-gray-400" />
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
