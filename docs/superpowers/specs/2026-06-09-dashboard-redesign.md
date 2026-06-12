# Nemesis Dashboard Redesign — Design Spec
> Date: 2026-06-09 | Author: David Cho | Ref: Nemesis_PRD_new.md + dashboard_design.png

---

## 1. 목표

`dashboard_design.png` 기준으로 대시보드를 전면 재설계한다.
- 레이아웃: 다크 테마 (`#0D1117` / `#161B22`) 기반 멀티 패널 대시보드
- 사이드바: 12개 메뉴로 확장, NEMESIS 로고, 한글 메뉴
- 요약 카드 6종: 원형 게이지 포함
- 신규 패널: DB / SW / Docker / AI / 알람 / 진행 작업
- 신규 백엔드 API: 대시보드 집계 엔드포인트

---

## 2. 범위

| 영역 | 내용 |
|---|---|
| Frontend (변경) | `Sidebar.jsx`, `Navbar.jsx`, `Layout.jsx`, `Dashboard.jsx` |
| Frontend (신규) | `SummaryCard.jsx`, `ClusterStatusPanel.jsx`, `PerformancePanel.jsx`, `SwPanel.jsx`, `DockerPanel.jsx`, `AlarmPanel.jsx`, `AiPanel.jsx`, `TimelineChart.jsx` |
| Backend (신규) | `GET /api/dashboard/summary`, `GET /api/dashboard/performance`, `GET /api/dashboard/sw-status`, `GET /api/dashboard/docker`, `GET /api/alerts` |

**제외 범위**: 신규 관리 페이지(DB 관리, SW 관리, Docker 관리 등) → 별도 플랜으로 분리

---

## 3. 레이아웃 구조

```
┌─────────────────────────────────────────────────────────┐
│  Navbar: [NEMESIS 로고]  날짜/시간  [🔔]  [David Cho]    │
├──────────┬──────────────────────────────────────────────┤
│          │  [요약 카드 × 6]                              │
│          ├─────────────────────────────┬────────────────┤
│ Sidebar  │  서버 클러스터 상태 테이블   │  (정상) 쉴드   │
│  (240px) │  시스템 성능 (도넛 3개)      │  AI 판단 현황  │
│          │  클러스터 타임라인 차트      │  NEMESIS AI    │
│          │  SW/미들웨어 상태 테이블    │  실시간 알람   │
│          │  Docker 상태 패널           │                │
│          ├─────────────────────────────┴────────────────┤
│          │  서버 관리 현황 (클러스터) 테이블             │
└──────────┴──────────────────────────────────────────────┘
```

---

## 4. 컴포넌트 상세

### 4-1. Sidebar
- 배경: `#0D1117`
- 상단: NEMESIS 로고 (방패 아이콘 + 텍스트)
- 메뉴 그룹 1 — 메인:
  - 대시보드 (`grid_view`)
  - 노드 현황 (`dns`)
  - 알림 센터 (`notifications_active`)
  - Runbook (`play_circle`)
  - AI 로그 (`psychology`)
- 메뉴 그룹 2 — 설정:
  - 설정 (accordion)
    - 클러스터 관리
    - Docker 관리
    - 에이전트 관리
    - 시스템 설정
    - 보안 설정
- 너비: 240px (고정)
- 하단: 로그인 유저 정보

### 4-2. Navbar
- 높이: 56px, 배경: `#161B22`
- 좌측: NEMESIS 브랜드명
- 중앙: 페이지 타이틀 + 부제목
- 우측: 실시간 날짜/시간 | 알람 벨 (미확인 카운트 뱃지) | 유저 아바타 + 이름

### 4-3. 요약 카드 (6종) — `SummaryCard.jsx`

각 카드: 원형 게이지(SVG) + 숫자 + 라벨

| 카드 | 데이터 소스 |
|---|---|
| 클러스터 | `clusters` 총 수 |
| 활성 | `role=active` 노드 수 |
| 이슈대기(AI) | `failoverEvent` 건수 |
| VIP | VIP 할당 클러스터 수 |
| 에이전트 | 등록 에이전트 수 |
| 마지막 업데이트 | 폴링 타임스탬프 |

API: `GET /api/dashboard/summary` (신규)

### 4-4. 서버 클러스터 상태 테이블 — `ClusterStatusPanel.jsx`

컬럼: 그룹명 | Active Node | Standby Node | CPU | MEM | DISK | VIP | 상태
- 정상(초록) / 경고(노랑) / 장애(빨강) 색상 표시
- 클릭 시 `/cluster/:id`로 이동
- API: 기존 `GET /api/clusters` + `GET /api/clusters/:id/status`

### 4-5. 시스템 성능 현황 — `PerformancePanel.jsx`

도넛 차트 3개 (Chart.js Doughnut):
- CPU 평균 사용률
- Memory 평균 사용률
- Disk 평균 사용률

각 차트: 중앙에 % 숫자, 임계치별 색상 (정상 `#00C853` / 경고 `#FFD600` / 위험 `#FF1744`)
API: `GET /api/dashboard/performance` (신규, 에이전트 메트릭 캐시 집계)

### 4-6. 클러스터 타임라인 차트 — `TimelineChart.jsx`

Chart.js Line 차트:
- X축: 최근 10분 타임스탬프
- Y축: 활성 클러스터 수 or CPU 평균
- 5초 폴링으로 실시간 갱신
- API: `GET /api/dashboard/performance` (시계열 데이터 포함)

### 4-7. SW/미들웨어 상태 — `SwPanel.jsx`

테이블: SW명 | 타입(DB/WAS/Web) | 상태 | 노드
- API: `GET /api/dashboard/sw-status` (신규, 노드별 프로세스 상태 집계)

### 4-8. Docker 상태 — `DockerPanel.jsx`

컨테이너 현황 테이블: 노드 | 컨테이너 수 (기동/전체) | 상태
- 초기: Mock 데이터 (미구현 필드는 `-` 표시)
- API: `GET /api/dashboard/docker` (신규, Mock 응답)

### 4-9. AI 판단 현황 — (Dashboard 내 인라인)

최근 AI Failover 판단 이력:
- 시간 | 클러스터 | 판단(Failover 여부) | 신뢰도 | 이유
- API: 기존 `failoverEvent` 데이터 활용

### 4-10. NEMESIS AI 패널 — `AiPanel.jsx`

- AI 분석 요약 메시지 (정적 텍스트 or API 응답)
- 텍스트 입력창 ("AI에게 질문하기...")
- API: `GET /api/ai/analysis` (초기: Mock 메시지)

### 4-11. 실시간 알람 패널 — `AlarmPanel.jsx`

레벨: 치명(🔴) / 경고(🟡) / 정보(🔵)
목록: 레벨 | 메시지 | 발생시간
- 클릭 시 알림 센터로 이동
- API: `GET /api/alerts` (신규, 감사 로그 기반)

---

## 5. 신규 백엔드 API

### 5-1. `GET /api/dashboard/summary`
```json
{
  "clusterCount": 3,
  "activeNodeCount": 3,
  "issueWaitingCount": 0,
  "vipCount": 3,
  "agentCount": 6,
  "lastUpdatedAt": "2026-06-09T10:00:00+09:00"
}
```
구현: 기존 `ClusterRepository` + `NodeRepository` + `AgentKeyRepository` 집계

### 5-2. `GET /api/dashboard/performance`
```json
{
  "avgCpuPercent": 34.2,
  "avgMemoryPercent": 58.1,
  "avgDiskPercent": 45.0,
  "timeline": [
    { "timestamp": 1234567890000, "avgCpu": 32.1, "avgMem": 57.0 }
  ]
}
```
구현: `MetricsCacheService` 전체 캐시 집계

### 5-3. `GET /api/dashboard/sw-status`
```json
{
  "items": [
    { "name": "oracle", "type": "DB", "state": "running", "node": "server01" }
  ]
}
```
구현: `MetricsCacheService`의 `processes` 필드 집계

### 5-4. `GET /api/dashboard/docker`
```json
{
  "nodes": [
    { "hostname": "server01", "runningContainers": 0, "totalContainers": 0, "status": "N/A" }
  ]
}
```
구현: 초기 Mock (Docker 미구현), 노드 목록 기반 빈 응답

### 5-5. `GET /api/alerts`
```json
{
  "items": [
    { "level": "WARNING", "message": "server01 CPU 85% 초과", "createdAt": "..." }
  ]
}
```
구현: `AuditLog` 테이블 최근 20건 반환 (초기)

---

## 6. 디자인 토큰

```css
--bg-main:    #0D1117
--bg-card:    #161B22
--bg-panel:   #1C2128
--color-ok:   #00C853
--color-warn: #FFD600
--color-err:  #FF1744
--color-blue: #1E88E5
--text-main:  #E6EDF3
--text-sub:   #8B949E
--border:     #30363D
```

---

## 7. 성공 기준

- [ ] 기존 클러스터 추가/삭제/Failover 기능 정상 동작 (회귀 없음)
- [ ] 6개 요약 카드 데이터 정상 표시
- [ ] 서버 클러스터 상태 테이블 실시간 갱신 (5초 폴링)
- [ ] 시스템 성능 도넛 차트 3개 정상 렌더링
- [ ] 사이드바 모든 메뉴 클릭/네비게이션 동작
- [ ] Docker / AI 패널 Mock 데이터 표시

---

## 8. 제외 범위 (별도 플랜)

- 노드 현황 페이지 신규 구현
- Runbook 페이지 신규 구현
- AI 로그 페이지
- Docker 관리 페이지
- 에이전트 관리 페이지
- 보안 설정 페이지
