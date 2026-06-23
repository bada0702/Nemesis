# Nemesis AIOps SP5 — AI 운영 센터 설계

작성일: 2026-06-23
상태: 승인됨 (구현 계획 작성 대기)

## 1. 배경 / 목적

AIOps SP1~SP4로 aibot 사이드카 접목, 능동 모니터링(SP3), 페일오버 판단(SP4)이
구현됐다. 그러나 운영자가 AI 기능을 한곳에서 활용할 전용 화면이 없다.

- 백엔드에는 이미 `/api/ai/findings`(장애 발견), `/api/ai/proposals`(승인/거부·실행),
  `/api/ai/notifications`가 존재한다.
- 프론트 `AiAnalysis.jsx`는 `/ai-analysis`로 라우팅돼 있으나 **사이드바 메뉴에 없어
  사실상 고아 페이지**다.
- **"장애 예측"은 전무**하다. 현재 finding은 이미 발생한 의심 신호 기반의 사후 탐지다.

목표: 운영자가 **에러/현재 상태, 장애 예측을 확인하고 예방·복구 조치를 검토·승인**할 수
있는 통합 페이지 "AI 운영"을 만든다.

## 2. 확정된 결정

1. **장애 예측 = 하이브리드**: 규칙기반 prefilter로 추세 후보를 사전필터한 뒤,
   의심 항목만 LLM(사이드카 `/ai/scan`)에 보내 근거·심각도를 보강. SP3 scan 아키텍처와
   동일 패턴으로 일관성 유지.
2. **통합 'AI 운영' 1페이지**: 새 사이드바 메뉴 'AI 운영'(라우트 `/ai`). 한 페이지에
   3섹션(상단 탭): ①현황·에러 ②장애 예측 ③검토 승인. 기존 `AiAnalysis`는 흡수하고
   `/ai-analysis`는 `/ai`로 redirect.
3. **예측도 제안 생성**: 예측 심각도가 HIGH/CRITICAL이면 기존 proposal 파이프라인을
   그대로 타서 예방 조치안을 생성하고, 운영자가 검토·승인.

## 3. 아키텍처 개요

기존 SP3 파이프라인(`AiPrefilter → AiMonitorService → client.scan → AiFindingService
→ (HIGH/CRIT) AiProposal → 승인 → /ai/execute`)을 재사용·확장한다. 신규 개념은
"예측 신호" 하나이며, finding 저장/proposal 생성·승인·실행은 모두 기존 경로를 탄다.

```
[Scheduler] ─┬─ 반응형: AiPrefilter(현재값)      ─┐
             │                                    ├→ client.scan ─→ AiFindingService
             └─ 예측형: AiPredictPrefilter ───────┘     (category 구분)
                       (롤링 추세→ETA)                          │
                                                  (HIGH/CRIT) ──┴→ AiProposal ─→ 승인 ─→ /ai/execute
```

## 4. 백엔드 설계

### 4.1 AiPredictPrefilter (신규)
`com.nemesis.domain.aiops.monitor.AiPredictPrefilter`

- `MetricsCacheService`는 노드별 **최신 스냅샷만** 보관하므로, 이 컴포넌트가
  노드별 disk%/mem% **롤링 윈도우(인메모리 ring buffer)**를 유지한다.
  (기존 `AiPrefilter.cpuStreak`와 동일한 `ConcurrentHashMap` 인메모리 패턴.)
- 매 스캔 주기마다 최신값을 윈도우에 push하고, **선형 추세 기울기**를 계산해
  임계(예: 95%) **도달 ETA**를 추정한다.
- ETA가 설정 임계 이내면 `Suspect` 방출:
  - `signalType` = `DISK_TREND` / `MEM_TREND`
  - `severity`:
    - ETA ≤ criticalEtaMinutes → CRITICAL
    - ETA ≤ highEtaMinutes → HIGH
    - 그 외 임계 이내 → WARN
  - `detail`: `{ current, slopePerMin, etaMinutes, threshold }`
- 윈도우 샘플이 최소 개수(`minSamples`, 예: 4) 미만이거나 기울기 ≤ 0(증가 추세
  아님)이면 신호를 내지 않는다(graceful).

설정은 `AiOperatorProperties.Monitor`에 추가:
- `predictEnabled` (기본 true)
- `predictWindowSize` (기본 6)
- `predictMinSamples` (기본 4)
- `predictTargetPercent` (기본 95)
- `predictHorizonMinutes` (예측 대상 최대 ETA, 기본 360 = 6h)
- `predictHighEtaMinutes` (기본 120)
- `predictCriticalEtaMinutes` (기본 30)

ETA/추세 계산은 순수 함수로 분리해 단위 테스트 가능하게 한다
(예: `static long etaMinutes(double[] samples, long intervalMin, double target)`).

### 4.2 AiFinding 변경
- 컬럼 추가: `category VARCHAR(10) NOT NULL DEFAULT 'REACTIVE'`
  (값: `REACTIVE` | `PREDICTIVE`).
- 상수 추가: `AiFinding.REACTIVE`, `AiFinding.PREDICTIVE`, 신호상수
  `DISK_TREND`, `MEM_TREND`.
- ETA/근거는 기존 `detail`(JSON TEXT) 재사용 — 별도 컬럼 추가 안 함.
- DB 마이그레이션: 기존 마이그레이션 방식(프로젝트 컨벤션 따름)에 컬럼 추가.

### 4.3 AiMonitorService 변경
- `runScan()`에 예측 패스를 추가한다. 기존 반응형 스캔 수행 후:
  1. `predictPrefilter.evaluate()`로 예측 Suspect 수집
  2. 각 예측 Suspect → `investigate(s)`(기존 메서드 재사용, `client.scan` 동일 호출)
  3. 결과를 `findings.recordWarn/recordHigh`로 저장하되 **category=PREDICTIVE**로 기록
  4. HIGH/CRITICAL은 기존 `recordHigh` 경로가 proposal을 생성(현행 동작 유지)
- `reconcileResolved`는 반응형+예측형 active fingerprint를 **합집합**으로 넘겨
  예측 신호가 사라지면 자동 resolve.
- `AiFindingService.recordWarn/recordHigh`에 category 인자를 추가하거나
  Suspect에 category를 실어 분기. (구현 단계에서 시그니처 최소 변경안 선택.)

### 4.4 사이드카 (nemesis_service.py) 변경
- 최소 변경. `/ai/scan`은 이미 `suspectSignals`를 받으므로 새 signalType
  (`DISK_TREND`/`MEM_TREND`)만 전달하면 동작한다.
- 선택: `/ai/scan`의 예측형 signal에 대해 "향후 장애 가능성/근거를 추정하라"는
  프롬프트 힌트 한 줄 보강(`focusSignal`에 예측 의도 표기). 사이드카 미변경으로도
  동작하나, 예측 품질을 위해 권장.

### 4.5 API 변경
- `GET /api/ai/findings` — `category` 쿼리 파라미터 추가(미지정 시 전체).
  `AiFindingController` + `AiFindingRepository`에 필터 메서드 추가.
- proposals API(`/api/ai/proposals`, approve/reject)는 변경 없음.
- finding DTO에 `category`, `detail`(ETA 등) 노출.

## 5. 프론트엔드 설계

### 5.1 신규 페이지 AiOpsCenter.jsx
`frontend/src/pages/AiOpsCenter.jsx`, 라우트 `/ai`.

상단 탭 3개(단일 페이지):

1. **현황·에러** — `GET /api/ai/findings?category=REACTIVE&status=OPEN`
   - severity 뱃지, signalType, 호스트, 요약/진단, last seen.
2. **장애 예측** — `GET /api/ai/findings?category=PREDICTIVE&status=OPEN`
   - 예측 항목, ETA 텍스트("약 5시간 내 디스크 95% 도달"), 근거(diagnosis),
     심각도. detail의 etaMinutes/slope로 사람이 읽는 문구 렌더.
3. **검토 승인** — `GET /api/ai/proposals?status=PENDING`
   - 진단·근본원인·신뢰도(confidence), 조치명령 목록(command + riskLevel 뱃지),
     **승인 / 거부** 버튼. 승인 전 확인 모달은 기존 `AiAnalysis`의
     `ExecuteConfirmModal` 패턴 재사용.

각 탭 헤더에 미해결/대기 건수 뱃지. 폴링은 기존 대시보드 패턴(5~10초).

### 5.2 라우팅 / 메뉴
- `App.jsx`: `<Route path="/ai" element={<AiOpsCenter />} />` 추가,
  `/ai-analysis`는 `<Navigate to="/ai" replace />`.
- `Sidebar.jsx`: 최상위 메뉴 항목 `{ label: 'AI 운영', icon: Bot, path: '/ai' }` 추가
  (대시보드 다음 위치).

### 5.3 API 클라이언트
`frontend/src/api/client.js`에 정리:
- `getFindings({ category, status })`
- `getProposals({ status })`
- `approveProposal(id)` / `rejectProposal(id)`
(일부는 기존 `triggerAiAnalysis`/`getAiAnalysisResult`와 공존; 중복 정리.)

## 6. 데이터 흐름

1. 기존 `AiMonitorScheduler`(@Scheduled) → `AiMonitorService.runScan()`
   - 반응형: prefilter(현재값) → scan → findings(REACTIVE)
   - 예측형: predictPrefilter(추세) → scan → findings(PREDICTIVE) →
     HIGH/CRITICAL은 proposal 생성
2. 프론트 `AiOpsCenter`가 findings/proposals를 폴링해 3섹션 렌더.
3. 승인 → `POST /api/ai/proposals/{id}/approve` → 백엔드가 사이드카 `/ai/execute`로
   조치 실행 → status SUCCEEDED/FAILED → 관련 finding resolve.

## 7. 에러 처리

- 사이드카 다운 → 예측 패스 경고 로그 후 skip(기존 `AiOperatorService` 폴백과 동일).
  반응형 스캔에 영향 없음.
- 추세 샘플 부족/증가추세 아님 → 예측 미생성(graceful).
- LLM 타임아웃/무응답 → 1차 정보만으로 finding 기록, proposal 생략.
- 승인 실행 실패 → proposal status FAILED, finding 유지(현행 동작).

## 8. 테스트

**백엔드**
- `etaMinutes`/추세 계산 순수함수 단위 테스트(결정론: 상승/평탄/하강/샘플부족).
- `AiPredictPrefilter.evaluate()` — 캐시 mock으로 신호 방출/억제 검증.
- `AiMonitorService` 예측 패스 — `client` mock으로 finding(category=PREDICTIVE) 및
  HIGH/CRITICAL proposal 생성 검증.
- finding category 영속 + `category` 필터 쿼리.

**프론트엔드**
- 3섹션 렌더, 탭 전환, 건수 뱃지.
- 승인/거부 호출 및 확인 모달.

## 9. 범위 밖 (YAGNI)

- 장기 메트릭 이력 테이블/시계열 DB 도입(인메모리 롤링 윈도우로 충분).
- 예측 정확도 ML 모델(규칙+LLM 하이브리드로 시작).
- 예측 자동 실행(예측 조치도 반드시 승인 게이트 경유).
- 알림 채널 변경(기존 notifications 재사용).

## 10. 영향받는 파일(예상)

신규:
- `backend/.../aiops/monitor/AiPredictPrefilter.java`
- `frontend/src/pages/AiOpsCenter.jsx`
- DB 마이그레이션 1건(category 컬럼)

수정:
- `backend/.../aiops/monitor/AiFinding.java` (category, 신호상수)
- `backend/.../aiops/monitor/AiFindingService.java` / `AiFindingRepository.java`
  / `AiFindingController.java` (category 인자·필터)
- `backend/.../aiops/monitor/AiMonitorService.java` (예측 패스)
- `backend/.../aiops/AiOperatorProperties.java` (predict 설정)
- `frontend/src/App.jsx`, `frontend/src/components/Sidebar.jsx`,
  `frontend/src/api/client.js`
- (선택) `/opt/nemesis-aibot/nemesis_service.py` 예측 프롬프트 힌트
