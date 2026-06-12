# Nemesis 사이드바 메뉴 개편 설계 (v1.0)

**날짜:** 2026-06-12  
**범위:** `frontend/src/components/Sidebar.jsx` 및 관련 라우트/페이지 레이블

---

## 1. 설계 철학

HA 운영자의 업무 흐름 중심으로 메뉴를 구성한다.

```
대시보드(전체 상태 파악)
  → 클러스터(구성·정책 관리)
  → 서비스(보호 대상 관리)
  → 운영(점검 실행)
  → 모니터링(상태 확인·리포트)
  → 시스템(Nemesis 자체 관리)
```

**핵심 원칙:**
- 구성(클러스터) / 관리(서비스·운영) / 상태(모니터링) 역할 분리
- 노드는 독립 메뉴가 아닌 클러스터 트리 안에서 확인
- 동기화 현황 + 에이전트 상태는 "클러스터 상태"로 통합 — HA 헬스는 한 화면에서

---

## 2. 최종 메뉴 구조

| 아이콘 | 메뉴 | 자식 항목 | 라우트 |
|--------|------|-----------|--------|
| 🏠 | 대시보드 | — | `/` |
| 🔄 | 클러스터 | 트리 뷰 | `/clusters/tree` |
| | | 클러스터 목록 | `/ha/groups` |
| | | 클러스터 설정 | `/settings/clusters` |
| | | HA 운영 절차 | `/ha/sequence` |
| 🛡 | 서비스 | 전체 서비스 | `/services` |
| | | DB | `/db` |
| | | Application | `/sw` |
| | | 컨테이너 | `/docker/containers` |
| ⚡ | 운영 | 점검 관리 | `/inspection` |
| 📊 | 모니터링 | 클러스터 상태 | `/monitoring/cluster` (신규) |
| | | 리포트 | `/reports` |
| ⚙ | 시스템 | 시스템 설정 | `/settings/system` |

---

## 3. 각 메뉴 콘텐츠

### 🏠 대시보드 (`/`)
전체 클러스터 헬스 요약: 클러스터 수, 서비스 수, 활성 알람, Primary/Standby 현황, 실시간 동기화, 주요 서비스 상태, 최근 이벤트.

### 🔄 클러스터

**트리 뷰** (`/clusters/tree`)  
`클러스터 > VIP / 노드 > Service / Agent` 계층 트리. 노드 상태를 시각적으로 파악.

**클러스터 목록** (`/ha/groups`)  
테이블 형태. VIP, 노드 수, 상태, 수정/삭제 액션. 트리 뷰와 같은 데이터를 다른 레이아웃으로 표시.

**클러스터 설정** (`/settings/clusters`)  
클러스터 생성, VIP 설정, 노드 추가/삭제, Failover 정책, Heartbeat, 동기화 정책.

**HA 운영 절차** (`/ha/sequence`)  
장애 대응 → Failover → Failback → 복구 절차 → 운영 Runbook. 기존 `/runbook` 콘텐츠를 이 페이지로 흡수.

### 🛡 서비스

**전체 서비스** (`/services`)  
Oracle, Nginx, Tomcat, Docker, Redis 등 보호 대상 서비스 통합 뷰.

**DB** (`/db`) — Oracle, PostgreSQL, MySQL  
**Application** (`/sw`) — Nginx, Apache, Tomcat, WebLogic  (기존 "SW" 레이블 변경)  
**컨테이너** (`/docker/containers`) — Docker, Podman

### ⚡ 운영

**점검 관리** (`/inspection`)  
일일/주간 점검 실행, 점검 결과 기록, 점검 이력 조회.

### 📊 모니터링

**클러스터 상태** (`/monitoring/cluster`) — 신규 라우트  
기존 `/ha/sync`(동기화 현황) + `/settings/agents`(에이전트 상태)를 통합한 단일 화면.  
표시 항목: Sync OK/Lag, Primary/Standby, VIP 상태, Agent Running, Heartbeat, 노드 상태, 서비스 상태.

**리포트** (`/reports`)  
장애 이력, Failover 이력, 가동률, 서비스 통계, 점검 리포트.

### ⚙ 시스템

**시스템 설정** (`/settings/system`)  
Nemesis 환경설정, 로그, 백업, 라이선스, 버전 정보.

---

## 4. 변경 상세

### 4-1. 메뉴에서 제거 (페이지 코드는 유지)

| 항목 | 기존 라우트 | 처리 |
|------|------------|------|
| 노드 | `/servers/list` | 메뉴 제거. 클러스터 트리에서 접근 가능 |
| 알람 현황 | `/alerts` | 메뉴 제거. 대시보드에서 요약 표시 |
| 알람 설정 | `/alerts/config` | 메뉴 제거. 직접 URL로 접근 가능하게 유지 |
| 이미지 | `/docker/images` | 메뉴 제거. 컨테이너 페이지 내부로 이동 검토 |

### 4-2. 이동/재배치

| 항목 | 기존 위치 | 새 위치 |
|------|----------|---------|
| 클러스터 설정 | 시스템 > 클러스터 설정 | 클러스터 > 클러스터 설정 |
| HA 운영 절차 | 클러스터 > 운영 절차 | 클러스터 > HA 운영 절차 |
| Runbook | 운영 > Runbook (단독) | 클러스터 > HA 운영 절차 페이지 내 흡수 |
| 동기화 현황 | 클러스터 > 동기화 현황 | 모니터링 > 클러스터 상태 (통합) |
| 에이전트 상태 | 모니터링 > 에이전트 상태 | 모니터링 > 클러스터 상태 (통합) |
| 리포트 | 상위 단독 메뉴 | 모니터링 > 리포트 |

### 4-3. 레이블 변경

| 기존 | 변경 후 | 라우트 |
|------|---------|--------|
| SW | Application | `/sw` (라우트 유지) |

---

## 5. 신규 라우트

| 라우트 | 페이지 | 설명 |
|--------|--------|------|
| `/monitoring/cluster` | `MonitoringCluster.jsx` (신규) | 동기화 현황 + 에이전트 상태 통합 뷰 |

---

## 6. 구현 범위

### Sidebar.jsx
- `MENU` 배열을 새 구조로 교체
- 아이콘 임포트 업데이트

### App.jsx
- `/monitoring/cluster` 라우트 추가
- `/runbook` → `/ha/sequence` redirect 추가 (기존 북마크 보호)

### HaSequence.jsx (`/ha/sequence`)
- 기존 Runbook 내용을 탭 또는 섹션으로 흡수
- 장애 대응 / Failover / Failback / 복구 절차 / Runbook 구성

### `pages/monitoring/ClusterStatus.jsx` (신규)
- 경로: `frontend/src/pages/monitoring/ClusterStatus.jsx`
- 기존 `/ha/sync` + `/settings/agents` 데이터를 단일 화면에 렌더
- 섹션: 동기화 상태 / 에이전트 상태 / Heartbeat / VIP / 노드 상태 / 서비스 상태

---

## 7. 영향 없는 항목

라우트 및 페이지 파일은 아래 항목 모두 그대로 유지한다.

`/`, `/clusters/tree`, `/ha/groups`, `/settings/clusters`, `/services`, `/db`, `/sw`, `/docker/containers`, `/inspection`, `/reports`, `/settings/system`, `/alerts`, `/alerts/config`, `/servers/list`, `/docker/images`
