import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, GitBranch, Shield, Zap,
  Activity, Settings,
  ChevronDown, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import { LogoMark, LogoFull } from './Logo'

const MENU = [
  { label: '대시보드', icon: LayoutDashboard, path: '/' },

  { label: '클러스터', icon: GitBranch, path: null, children: [
    { label: '트리 뷰',      path: '/clusters/tree'     },
    { label: '클러스터 목록', path: '/ha/groups'         },
    { label: '클러스터 설정', path: '/settings/clusters' },
    { label: 'HA 운영 절차', path: '/ha/sequence'       },
  ]},

  { label: '서비스', icon: Shield, path: null, children: [
    { label: '전체 서비스',  path: '/services'            },
    { label: 'DB',          path: '/services?type=DB'   },
    { label: 'Application', path: '/services?type=APP'  },
    { label: '컨테이너',    path: '/docker/containers'   },
  ]},

  { label: '운영', icon: Zap, path: null, children: [
    { label: '점검 관리', path: '/inspection' },
  ]},

  { label: '모니터링', icon: Activity, path: null, children: [
    { label: '클러스터 상태', path: '/monitoring/cluster' },
    { label: '리포트',        path: '/reports'            },
  ]},

  { label: '시스템', icon: Settings, path: null, children: [
    { label: '시스템 설정', path: '/settings/system' },
  ]},
]

function MenuItem({ item, collapsed }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const [open, setOpen] = useState(false)
  const Icon = item.icon

  // 쿼리스트링 포함 비교 (예: /services?type=DB)
  const current = location.pathname + location.search
  const matches = p => p.includes('?') ? current === p : location.pathname === p && !location.search

  const isActive = item.path
    ? matches(item.path)
    : item.children?.some(c => matches(c.path))

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
                  ${matches(child.path)
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
