import React from 'react'

// NEMESIS 로고 아이콘 — 그라데이션 타일 + 방패(HA 보호) + 하트비트(모니터링)
export function LogoMark({ className = 'w-9 h-9' }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="nemesisGrad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      {/* 라운드 타일 */}
      <rect width="40" height="40" rx="11" fill="url(#nemesisGrad)" />
      {/* 방패 = HA 보호 */}
      <path
        d="M20 7 L30 11 V20 C30 26.5 25.6 31.2 20 33.5 C14.4 31.2 10 26.5 10 20 V11 Z"
        stroke="white" strokeWidth="1.6" strokeLinejoin="round" fill="white" fillOpacity="0.12"
      />
      {/* 하트비트 = 라이브니스/모니터링 */}
      <path
        d="M12.5 20.5 H16.4 L18.2 15.3 L21.4 25 L23.1 20.5 H27.5"
        stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

// 아이콘 + 워드마크 + 태그라인 (사이드바 펼침 상태용)
export function LogoFull() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className="w-9 h-9 shrink-0" />
      <div className="leading-none">
        <h1 className="text-xl font-black tracking-tight text-white">NEMESIS</h1>
        <p className="text-[8px] font-semibold tracking-[0.22em] text-sky-400/80 mt-1.5 uppercase whitespace-nowrap">
          Next Generation Smart HA
        </p>
      </div>
    </div>
  )
}
