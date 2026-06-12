# NEMESIS 디자인 감사 리포트
**날짜:** 2026-06-09  
**URL:** http://[::1]:5173/  
**범위:** 대시보드, 서비스, 알람, DB 관리, 점검 관리  
**분류:** APP UI (워크스페이스 중심, 데이터 덴스, 태스크 포커스)

---

## 헤드라인 점수

| 지표 | Before | After |
|------|--------|-------|
| **Design Score** | D+ | C+ |
| **AI Slop Score** | B | B |

---

## 첫인상

사이트는 **서버·클러스터 모니터링 대시보드**임을 즉시 전달합니다. 다크 테마와 초록색 상태 표시는 맥락에 적절합니다. 내 눈이 먼저 가는 곳: (1) 전체 상태 "정상" 카드, (2) 좌측 네비게이션 구조, (3) 비어있는 "이중화 동기화 상태" 패널.

한 단어로: **functional**. 기능은 작동하지만 polish가 없습니다.

---

## 추출된 디자인 시스템

| 항목 | 현황 | 평가 |
|------|------|------|
| **폰트** | Noto Sans KR + Segoe UI fallback | 기능적, generic |
| **헤딩 스케일** | H1=H2(24px), H3(18px or 14px), H4(14px) | 체계 없음 |
| **컬러** | 다크(#0b0e14), 파랑(blue-600), 시맨틱 상태색 | 적절 |
| **레이아웃** | 고정 w-48 사이드바, 12컬럼 그리드 | 반응형 없음 |
| **CSS 프레임워크** | Tailwind CDN (프로덕션 부적합) | ⚠️ 주의 |

---

## 발견사항 및 수정 내역

### HIGH IMPACT

#### ✅ FINDING-001: 모바일 레이아웃 완전 파손 → **수정 완료**
- **문제:** 고정폭 사이드바(w-48)가 모바일에서 컨텐츠를 덮음. 햄버거 메뉴 없음.
- **수정:** `Layout.jsx` — mobileOpen/collapsed 상태 추가. `Sidebar.jsx` — 데스크탑(숨김→아이콘→전체), 모바일(fixed 드로어). `Navbar.jsx` — 모바일 햄버거 버튼 추가.
- **파일:** `Layout.jsx`, `Sidebar.jsx`, `Navbar.jsx`
- **상태:** verified

#### ✅ FINDING-002: 터치 타겟 미달 → **수정 완료**
- **문제:** "더보기 >" 링크들 36×15px (최소 44px 필요). AI 패널 전송 버튼 16×16px.
- **수정:** `<a>` → `<button min-h-[44px]>`, AI 패널 버튼에 padding 추가.
- **파일:** 8개 대시보드 패널, `AiPanel.jsx`, `Dashboard.jsx`
- **상태:** verified

#### ✅ FINDING-004: "메뉴 접기" 버튼 비기능 → **수정 완료**
- **문제:** onClick 핸들러 없음 — 클릭해도 아무 일도 안 일어남.
- **수정:** collapsed 상태로 연결. 데스크탑에서 아이콘 전용 모드로 접힘.
- **상태:** verified

### MEDIUM IMPACT

#### ✅ FINDING-006/007: 헤딩 계층 구조 없음 → **수정 완료**
- **문제:** H1(NEMESIS, 24px) = H2(페이지 타이틀, 24px). H3/H4 모두 14px.
- **수정:** Navbar H2를 text-lg/xl로 축소. 섹션 H3들을 text-base로 상향.
- **상태:** verified

#### ✅ FINDING-009: 점검 관리 테이블 빈 상태 없음 → **수정 완료**
- **문제:** 데이터 없을 때 테이블 바디가 완전히 비어있음. 사용자가 다음 행동 모름.
- **수정:** 아이콘 + 메시지 + "첫 번째 점검 등록" CTA가 있는 빈 상태 추가.
- **상태:** verified

#### ✅ FINDING-008: Noto Sans KR 폰트 미로드 → **수정 완료**
- **문제:** index.css에 선언됐으나 Google Fonts link 없음.
- **수정:** Google Fonts preconnect + Noto Sans KR 400/500/600/700 로드 추가.
- **상태:** verified

### DEFERRED

#### ⏸ FINDING-003: Tailwind CSS CDN 사용 (프로덕션 부적합)
- **문제:** `<script src="https://cdn.tailwindcss.com">` — 브라우저 경고, 프로덕션 빌드에 미포함, CDN 의존.
- **수정 방법:** `npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p`
- **영향:** 배포 시 필수 수정

#### ⏸ FINDING-005: /servers, /topology 라우트 빈 페이지
- **문제:** 사이드바 "서버" 클릭 시 `/servers/list`로 이동하지만 직접 `/servers`는 404에 해당하는 빈 페이지 렌더링.
- **수정 방법:** App.jsx에 `<Route path="/servers" element={<Navigate to="/servers/list" replace />} />` 추가.

---

## Quick Wins 체크리스트 (완료)

- [x] 모바일 반응형 사이드바
- [x] "메뉴 접기" 기능 구현
- [x] 터치 타겟 44px 최소화
- [x] 헤딩 크기 계층 구분
- [x] 점검 관리 빈 상태 개선
- [x] Noto Sans KR 폰트 로드

---

## AI Slop 체크 (B)

| 패턴 | 여부 |
|------|------|
| 보라/인디고 그라디언트 배경 | ❌ 없음 |
| 아이콘-원+3컬럼 피쳐 그리드 | ❌ 없음 |
| 모든 요소 중앙 정렬 | ❌ 없음 |
| 균일한 풍성한 border-radius | ✅ 적절 |
| 장식용 블롭/웨이브 | ❌ 없음 |
| 이모지 디자인 요소 | ❌ 없음 |
| system-ui 기본 폰트 | ⚠️ Noto Sans로 수정됨 |

**AI Slop 평가: B** — 모니터링 대시보드답게 실용적입니다.

---

## PR 요약
> "디자인 리뷰: 모바일 레이아웃 완전 수정, 터치 타겟 개선, 메뉴 접기 기능 구현, 타이포그래피 계층 개선, 빈 상태 추가. Design Score D+ → C+."
