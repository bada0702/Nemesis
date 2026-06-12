import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, GitBranch, Layers, Server, PlayCircle,
  Activity, BarChart3, Settings,
  ChevronDown, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import { LogoMark, LogoFull } from './Logo'

// 7축 기능 네비게이션 — 기술별 메뉴(DB/SW/Docker)는 "서비스" 아래로 흡수하고,
// 도메인 트리(Cluster→Node→Service)는 사이드바가 아니라 "클러스터" 화면 안에 둔다.
// 기존 라우트는 그대로 재사용한다(페이지 삭제 없음).
const MENU = [
  { label: '대시보드', icon: LayoutDashboard, path: '/' },

  // 클러스터 = HA 그룹. 트리/토폴로지/동기화/VIP는 이 섹션의 메인 뷰로 들어간다.
  { label: '클러스터', icon: GitBranch, path: null, children: [
    { label: '트리 뷰',     path: '/clusters/tree' },
    { label: '클러스터 목록', path: '/ha/groups'    },
    { label: '동기화 현황',  path: '/ha/sync'      },
    { label: '운영 절차',    path: '/ha/sequence'  },
  ]},

  // 보호 대상 서비스(Protected Services) — type 속성으로 DB/SW/컨테이너를 통합.
  // 전환기에는 기존 페이지를 type 필터처럼 자식으로 노출한다.
  { label: '서비스', icon: Layers, path: null, children: [
    { label: '전체 서비스', path: '/services' },
    { label: 'DB',        path: '/db' },
    { label: 'SW',        path: '/sw' },
    { label: '컨테이너',   path: '/docker/containers' },
    { label: '이미지',     path: '/docker/images' },
  ]},

  { label: '노드', icon: Server, path: '/servers/list' },

  // 운영 = 사람이 일으키는 액션(Failover/Failback/Runbook/점검).
  { label: '운영', icon: PlayCircle, path: null, children: [
    { label: 'Runbook', path: '/runbook' },
    { label: '점검 관리', path: '/inspection' },
  ]},

  // 모니터링 = 시스템이 만들어내는 신호(상태/알람/이벤트). 에이전트 상태는
  // 노드 가로지르는 fleet 신호라 여기에 집계 뷰로 함께 둔다.
  { label: '모니터링', icon: Activity, path: null, children: [
    { label: '알람 현황',    path: '/alerts' },
    { label: '알람 설정',    path: '/alerts/config' },
    { label: '에이전트 상태', path: '/settings/agents' },
  ]},

  { label: '리포트', icon: BarChart3, path: '/reports' },

  { label: '시스템', icon: Settings, path: null, children: [
    { label: '클러스터 설정', path: '/settings/clusters' },
    { label: '시스템 설정',  path: '/settings/system' },
  ]},
]

function MenuItem({ item, collapsed }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const [open, setOpen] = useState(false)
  const Icon = item.icon

  const isActive = item.path
    ? location.pathname === item.path
    : item.children?.some(c => location.pathname === c.path)

  if (item.children) {
    if (collapsed) {
      return (
        <button
          title={item.label}
          onClick={() => navigate(item.children[0].path)}
          className={`w-full flex items-center justify-center p-3 rounded-lg transition-colors
            ${isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
        >
          <Icon className="w-5 h-5" aria-hidden="true" />
        </button>
      )
    }
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-3 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white rounded-lg"
        >
          <div className="flex items-center">
            <Icon className="w-5 h-5 mr-3" aria-hidden="true" />
            {item.label}
          </div>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="pl-8 space-y-0.5 mt-0.5">
            {item.children.map(child => (
              <button
                key={child.label}
                onClick={() => navigate(child.path)}
                className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors
                  ${location.pathname === child.path
                    ? 'text-blue-400 bg-blue-600/10'
                    : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}
              >
                {child.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (collapsed) {
    return (
      <button
        title={item.label}
        onClick={() => item.path && navigate(item.path)}
        className={`w-full flex items-center justify-center p-3 rounded-lg transition-colors
          ${isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      onClick={() => item.path && navigate(item.path)}
      className={`w-full flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-colors
        ${isActive
          ? 'bg-blue-600 text-white'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
    >
      <Icon className="w-5 h-5 mr-3" aria-hidden="true" />
      {item.label}
    </button>
  )
}

function SidebarContent({ collapsed, onCollapse, onClose }) {
  return (
    <>
      <div className={`flex items-center p-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {collapsed
          ? <LogoMark className="w-8 h-8" />
          : <LogoFull />
        }
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 ml-2">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <nav className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} space-y-1 overflow-y-auto`}>
        {MENU.map(item => <MenuItem key={item.label} item={item} collapsed={collapsed} />)}
      </nav>
      {onCollapse && (
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={onCollapse}
            className="flex items-center justify-center text-xs text-gray-500 hover:text-white py-2 px-2 rounded-lg hover:bg-gray-800 w-full min-h-[44px]"
            aria-label={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
          >
            {collapsed
              ? <ChevronRight className="w-4 h-4" />
              : <><ChevronLeft className="w-4 h-4 mr-1.5" /><span>메뉴 접기</span></>
            }
          </button>
        </div>
      )}
    </>
  )
}

export default function Sidebar({ collapsed, onCollapse, mobileOpen, onMobileClose }) {
  return (
    <>
      {/* 데스크탑 사이드바 */}
      <aside className={`sidebar-bg hidden md:flex flex-col shrink-0 transition-all duration-200
        ${collapsed ? 'w-14' : 'w-48'}`}>
        <SidebarContent collapsed={collapsed} onCollapse={onCollapse} />
      </aside>

      {/* 모바일 드로어 */}
      <aside className={`sidebar-bg flex md:hidden flex-col w-64 fixed inset-y-0 left-0 z-30
        transition-transform duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <SidebarContent collapsed={false} onClose={onMobileClose} />
      </aside>
    </>
  )
}
