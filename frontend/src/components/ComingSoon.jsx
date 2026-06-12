import React from 'react'
import { Construction } from 'lucide-react'

/**
 * 백엔드 미구현 페이지 상단에 표시하는 "준비중" 안내 배너.
 * 화면(목업 디자인)은 그대로 두되, 실 데이터 소스가 없어 빈 화면으로 보이는 것을
 * "고장"으로 오해하지 않도록 명시한다. (HA Gap Analysis E-2)
 */
export default function ComingSoon({ feature }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <Construction className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div className="text-xs">
        <p className="text-amber-300 font-semibold">준비 중 기능</p>
        <p className="text-gray-400 mt-0.5 leading-relaxed">
          {feature} 백엔드가 아직 구현되지 않았습니다. 아래 화면은 디자인 미리보기이며,
          실 데이터 수집 파이프라인이 연결되면 자동으로 반영됩니다.
        </p>
      </div>
    </div>
  )
}
