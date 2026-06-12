import React, { useEffect, useState } from 'react'
import { Bell, HelpCircle, User, Menu, LogOut } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth, roleLabel } from '../auth/AuthContext'

const PAGE_TITLES = {
  '/':            { title: '대시보드',    sub: '전체 시스템의 상태를 한눈에 확인합니다.' },
  '/nodes':       { title: '노드 현황',   sub: '등록된 노드의 상태를 확인합니다.' },
  '/alerts':      { title: '알람 현황',   sub: '발생한 알람 목록을 확인합니다.' },
  '/services':    { title: '서비스',      sub: '서비스 목록을 확인합니다.' },
  '/db':          { title: 'DB 관리',     sub: '데이터베이스 상태를 확인합니다.' },
  '/sw':          { title: 'SW 관리',     sub: '소프트웨어 상태를 확인합니다.' },
  '/runbook':     { title: 'Runbook',     sub: '자동화 작업을 관리합니다.' },
  '/inspection':  { title: '점검 관리',   sub: '정기 점검 일정을 관리합니다.' },
  '/ai-analysis': { title: 'AI 장애 분석', sub: 'AI가 에러 로그를 분석하고 수정 명령어를 제안합니다.' },
  '/reports':     { title: '리포트',      sub: '보고서를 조회합니다.' },
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']

export default function Navbar({ onMenuToggle }) {
  const location = useLocation()
  const { user, logout } = useAuth()
  const [now, setNow] = useState('')

  const page = PAGE_TITLES[location.pathname] ?? { title: 'NEMESIS', sub: '' }

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
