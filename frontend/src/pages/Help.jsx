import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Network, Boxes, Zap, Activity, Settings,
  Bot, ShieldCheck, ChevronRight, Server, Bell,
} from 'lucide-react'

// 섹션 카드
function Card({ children, className = '' }) {
  return <div className={`card-bg rounded-2xl p-6 ${className}`}>{children}</div>
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-500/15 text-sky-300 text-[11px] font-bold flex items-center justify-center border border-sky-500/30">
        {n}
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-slate-200">{title}</p>
        <p className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">{children}</p>
      </div>
    </div>
  )
}

function MenuRow({ icon: Icon, name, desc }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-800/60 last:border-0">
      <Icon className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-[13px] font-bold text-slate-200">{name}</p>
        <p className="text-[12px] text-slate-500 mt-0.5">{desc}</p>
      </div>
    </div>
  )
}

function Term({ k, v }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="font-mono font-bold text-sky-300 w-24 flex-shrink-0">{k}</span>
      <span className="text-slate-400">{v}</span>
    </div>
  )
}

export default function Help() {
  const navigate = useNavigate()

  return (
    <div className="p-8 pt-0 space-y-6 max-w-5xl">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-black text-slate-100 tracking-tight uppercase flex items-center gap-3">
          <ShieldCheck className="text-sky-400 w-6 h-6" />
          NEMESIS 사용 도움말
        </h1>
        <p className="text-[12px] text-slate-500 mt-1 ml-9">
          AIX/Linux 엔터프라이즈 고가용성(HA) 장애대응 관제 콘솔 — 감지 · 페일오버 · 자가복구 · AI 운영
        </p>
      </div>

      {/* 개요 */}
      <Card>
        <h2 className="text-sm font-black text-slate-100 mb-2">NEMESIS는 무엇을 하나요?</h2>
        <p className="text-[13px] text-slate-400 leading-relaxed">
          여러 서버를 묶은 <b className="text-slate-200">HA 클러스터</b>를 실시간 감시합니다.
          각 노드의 에이전트가 상태·자원·프로세스를 보고하면, NEMESIS가 1초 주기로 생존을 판정하고,
          active(master) 노드가 죽으면 살아있는 standby로 <b className="text-slate-200">자동 페일오버</b>(VIP 인수)를 수행합니다.
          여기에 AI 운영자가 장애 원인을 진단하고 복구 조치를 제안합니다(승인 후 실행).
        </p>
      </Card>

      {/* 빠른 시작 */}
      <Card>
        <h2 className="text-sm font-black text-slate-100 mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" /> 빠른 시작
        </h2>
        <div className="space-y-3.5">
          <Step n="1" title="클러스터 만들기">
            <b>시스템 → 클러스터 설정</b>에서 클러스터를 만들고 서비스 VIP를 지정합니다.
          </Step>
          <Step n="2" title="노드 추가">
            클러스터 설정에서 <b>노드 추가</b>. Hostname·Real IP는 필수, 필요 시 VIP·
            <b> Heartbeat IP(사설 하트비트 망)</b>·<b>NIC(VIP·하트비트를 적용할 네트워크 카드)</b>를 입력합니다.
          </Step>
          <Step n="3" title="에이전트 설치">
            <b>시스템 → 에이전트 설치</b>에서 대상 서버에 SSH로 에이전트를 배포하면, 그 노드가 상태를 보고하기 시작합니다.
          </Step>
          <Step n="4" title="Active(master) 지정">
            노드 편집에서 역할을 <b>PRIMARY</b>로 지정하면 해당 노드가 master가 되고 VIP가 적용됩니다.
            승격 가능한 standby가 없으면 일시 무응답이 와도 master를 유지합니다(불필요한 강등 방지).
          </Step>
          <Step n="5" title="모니터링 & 페일오버">
            대시보드와 <b>클러스터 → 트리 뷰</b>에서 노드·서비스 상태를 확인합니다.
            active가 죽으면 자동 페일오버되고, 필요 시 <b>수동 전환(Failover)</b>도 가능합니다.
          </Step>
        </div>
      </Card>

      {/* 메뉴 안내 */}
      <Card>
        <h2 className="text-sm font-black text-slate-100 mb-2">메뉴별 기능</h2>
        <div>
          <MenuRow icon={LayoutDashboard} name="대시보드" desc="전체 시스템 상태 요약 — VIP·HA 쌍·서버·서비스(DB/App/Docker)·AI 패널·알림." />
          <MenuRow icon={Network} name="클러스터" desc="트리 뷰(클러스터→노드→서비스·에이전트), 클러스터 목록, 클러스터/노드 설정, HA 운영 절차(Runbook)." />
          <MenuRow icon={Boxes} name="서비스" desc="논리 서비스 카탈로그(WEB/WAS/DB/SW/컨테이너) 등록과 HA 대상 지정, 노드별 상태." />
          <MenuRow icon={Zap} name="운영" desc="컨테이너 등 운영 대상 상태 확인." />
          <MenuRow icon={Activity} name="모니터링" desc="클러스터 상태(복제·하트비트·에이전트 통합), 리포트." />
          <MenuRow icon={Settings} name="시스템" desc="시스템 설정, 클러스터 설정, 에이전트 설치." />
        </div>
      </Card>

      {/* AI 기능 */}
      <Card>
        <h2 className="text-sm font-black text-slate-100 mb-4 flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-400" /> AI 운영 기능
        </h2>
        <div className="space-y-3.5">
          <Step n="①" title="AI 장애 분석">
            <b>AI 분석</b> 페이지에서 노드를 선택해 분석을 실행하면, 에러 로그(또는 무응답 노드의 상태)를
            바탕으로 근본 원인과 복구 명령을 제시합니다. 다운된 노드도 진단할 수 있습니다.
          </Step>
          <Step n="②" title="AI 운영자 제안(AIOps)">
            장애 감지·페일오버 후 AI 운영자가 원인을 조사하고 조치를 <b>제안(PENDING)</b>합니다.
            대시보드 AI 패널의 제안 카드에서 <b>operator 이상 권한</b>으로 승인/거부합니다. 승인 시에만 실행됩니다.
          </Step>
          <Step n="③" title="알림 벨">
            헤더의 <Bell className="inline w-3.5 h-3.5 -mt-0.5" /> 벨에 대기 중(PENDING) 제안 수가 표시되고,
            클릭하면 최근 AI 알림을 볼 수 있습니다.
          </Step>
        </div>
      </Card>

      {/* 역할/권한 + 용어 */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-black text-slate-100 mb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> 사용자 권한
          </h2>
          <div className="space-y-2.5">
            <Term k="admin" v="전체 관리 — 사용자 생성 포함 모든 작업" />
            <Term k="operator" v="제어 가능 — 페일오버·VIP·제안 승인·명령 실행" />
            <Term k="viewer" v="읽기 전용 — 상태 조회만 가능" />
          </div>
        </Card>
        <Card>
          <h2 className="text-sm font-black text-slate-100 mb-3 flex items-center gap-2">
            <Server className="w-4 h-4 text-sky-400" /> 용어
          </h2>
          <div className="space-y-2.5">
            <Term k="PRIMARY" v="active(master) — VIP를 들고 서비스 중인 노드" />
            <Term k="STANDBY" v="대기 — 페일오버 시 승격 대상" />
            <Term k="FAULT" v="장애/무응답으로 판정된 노드" />
            <Term k="VIP" v="서비스 가상 IP — master가 인수" />
            <Term k="Heartbeat" v="노드 간 사설 망 생존 확인 통신" />
          </div>
        </Card>
      </div>

      {/* 바로가기 */}
      <div className="flex flex-wrap gap-2">
        {[
          ['대시보드로', '/'],
          ['클러스터 트리', '/clusters/tree'],
          ['AI 분석', '/ai-analysis'],
          ['에이전트 설치', '/settings/agents/install'],
        ].map(([label, to]) => (
          <button key={to} onClick={() => navigate(to)}
            className="flex items-center gap-1 text-xs text-slate-300 hover:text-white px-3 py-2 rounded-lg border border-gray-700 hover:bg-white/5">
            {label} <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}
