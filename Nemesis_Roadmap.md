# Nemesis — Product Roadmap
> Version 1.0 | 작성일: 2026-06-06

---

## 로드맵 전체 개요

```
2026 Q3          2026 Q4          2027 Q1          2027 Q2          2027 Q3~
─────────────────────────────────────────────────────────────────────────────
Phase 1          Phase 2          Phase 3          Phase 4          Phase 5
Foundation       HA Core          AI Failover      Self-Healing     Scale-Out
경량 기반 구축    HA 핵심 완성     AI 장애 조치     AI 자율 복구     확장 및 고도화
```

---

## Phase 1 — Foundation (2026 Q3)
> **목표: 관리 서버 + 에이전트 기반 인프라 완성**

### 핵심 목표
- 관리 서버 / 에이전트 기본 통신 구조 확립
- AIX / Linux 크로스 플랫폼 에이전트 동작 검증
- 웹 UI 기본 프레임 구성

### 세부 태스크

#### 관리 서버
- [ ] Spring Boot 프로젝트 초기화 (.jar 단일 배포 구조)
- [ ] H2 Embedded DB 연동 및 스키마 설계
- [ ] 에이전트 등록 / 해제 REST API
- [ ] 클러스터 메타데이터 JSON 저장 구조
- [ ] 기본 Web UI 레이아웃 (Thymeleaf + Chart.js)

#### 에이전트 (AIX / Linux)
- [ ] AIX 표준 Shell Script 메트릭 수집 (vmstat, iostat, ps, netstat)
- [ ] Linux 표준 Shell Script 메트릭 수집
- [ ] 관리 서버 REST API Push 전송 (3초 주기)
- [ ] 에이전트 자동 등록 로직 (관리 서버 IP 지정 → 자동 연동)

#### 스토리지
- [ ] IBM GPFS mmgetstate 파싱 및 상태 수집
- [ ] GPFS 상시 마운트 구성 가이드 작성

### 완료 기준 (Definition of Done)
- AIX 2대 또는 Linux 2대 환경에서 에이전트 → 관리 서버 메트릭 수집 정상 동작
- Web UI에서 노드 상태 실시간 확인 가능
- 설치 소요 시간 1시간 이내

---

## Phase 2 — HA Core (2026 Q4)
> **목표: 실제 Failover 및 VIP 이동 기능 완성**

### 핵심 목표
- Rule 기반 Failover 완성 (AI 없이도 기본 HA 동작)
- Runbook 자동화 엔진 완성
- 통합 모니터링 대시보드 완성

### 세부 태스크

#### HA Core
- [ ] 하트비트 모니터링 및 장애 감지 로직
- [ ] VIP 이동 명령 실행 (AIX ifconfig / Linux ip)
- [ ] GPFS 마운트 상태 기반 Failover 흐름 최적화
- [ ] Switchback (수동 복귀) 기능
- [ ] 긴급 수동 Failover 웹 버튼
- [ ] 핑퐁(Ping-Pong) 방지 로직 (간헐적 불안정 시 유예 대기)
- [ ] Management Plane / Data Plane 분리
  - 관리 서버 장애 시 에이전트 간 직접 통신으로 서비스 유지

#### Runbook 엔진
- [ ] JSON 절차서 정의 및 파싱
- [ ] 기동 / 종료 / 점검 절차 순차 실행
- [ ] 각 단계 Health Check 자동 수행
- [ ] 실행 감사 로그 저장 (누가 / 언제 / 어떤 절차서 / 결과)
- [ ] 절차서 버전 관리

#### 통합 모니터링
- [ ] CPU / Memory / Disk / Network 실시간 차트 (Chart.js)
- [ ] 프로세스 상태 모니터링 (DB / WAS / Web)
- [ ] GPFS 노드 헬스 시각화 (초록등 / 빨간등)
- [ ] Telegram / Email 알림 연동
- [ ] 이상 징후 임계값 설정 UI

### 완료 기준 (Definition of Done)
- AIX 2대 / Linux 2대 / AIX+Linux 혼합 구성에서 Failover 정상 동작
- VIP 이동 완료 시간 1초 이내 (GPFS 상시 마운트 기준)
- Runbook 기동/종료 절차 자동 실행 및 감사 로그 저장 확인

---

## Phase 3 — AI Failover (2027 Q1)
> **목표: AI LLM 기반 장애 판단 및 Failover 결정**

### 핵심 목표
- Rule 기반이 놓치는 소프트 장애를 AI가 감지
- LLM 연동 인터페이스 완성
- 온프레미스 LLM 지원

### 세부 태스크

#### AI 엔진
- [ ] OpenAI API 연동 (GPT-4o)
- [ ] Anthropic API 연동 (Claude)
- [ ] 온프레미스 LLM 연동 인터페이스 (Ollama / vLLM 호환)
- [ ] 프롬프트 템플릿 설계
  - 입력: 메트릭 스냅샷 + 에러 로그 5줄 프리뷰
  - 출력: `{ "failover": true/false, "reason": "...", "confidence": 0.0~1.0 }`
- [ ] AI 판단 결과 신뢰도 임계값 설정 (confidence < 0.7 시 관리자 확인 요청)

#### 소프트 장애 감지 시나리오
- [ ] 화이트아웃 감지 (프로세스 생존 + HTTP 응답 없음)
- [ ] OutOfMemoryError 지속 감지
- [ ] DB 락 누적 + 응답 지연 동시 감지
- [ ] WAS 스레드 풀 고갈 감지
- [ ] 아카이브 로그 영역 포화 감지

#### 판단 시나리오 검증
```
시나리오 A (트래픽 폭주)
CPU 95% + 에러 로그 없음 + 응답 정상
→ AI: "정상 연산 중, Failover 보류"

시나리오 B (소프트 장애)
CPU 30% + OutOfMemoryError 지속 + HTTP 503
→ AI: "복구 불가 내부 고사, 즉시 Failover 승인"

시나리오 C (네트워크 플래핑)
하트비트 1초 간격 끊김/복구 반복
→ AI: "간헐적 불안정, 핑퐁 방지 3분 대기"
```

### 완료 기준 (Definition of Done)
- 소프트 장애 3종 이상 시나리오에서 AI Failover 정상 동작
- AI 판단 응답 시간 10초 이내
- 온프레미스 LLM 환경에서도 동작 확인

---

## Phase 4 — AI Self-Healing (2027 Q2)
> **목표: 장애 노드 자동 복구 — 사람 없이 새벽 장애 해소**

### 핵심 목표
- Failover 이후 장애 노드를 AI가 분석하고 자동 복구
- DB / WAS / Web 레이어별 복구 액션 라이브러리 구축

### 세부 태스크

#### Self-Healing 엔진
- [ ] 장애 노드 격리 후 AI 로그 분석 파이프라인
- [ ] 복구 액션 라이브러리 (Shell 명령 시퀀스)
- [ ] 단계별 실행 + 결과 검증 루프
- [ ] 복구 성공 → Standby 재편입 대기 자동화
- [ ] 복구 실패 → 관리자 알림 + 수동 조치 가이드 제공
- [ ] Self-Healing 정책 설정 (자동 / 반자동 / 수동 3단계)

#### DB 레이어 복구 액션
- [ ] Oracle 리스너 재기동
- [ ] 락 세션 Kill 및 정리
- [ ] 아카이브 로그 영역 정리
- [ ] 파라미터 파일 오류 감지 및 직전 버전 롤백
- [ ] DB 프로세스 재기동 및 정상 확인

#### WAS 레이어 복구 액션
- [ ] Tomcat / JBoss JVM 힙 부족 → 옵션 조정 후 재기동
- [ ] 스레드 풀 고갈 → 설정 파일 수정 후 재기동
- [ ] 설정 파일 오류 → 직전 버전 롤백 후 재기동
- [ ] 좀비 프로세스 제거

#### Web 레이어 복구 액션
- [ ] Nginx / Apache 설정 문법 오류 → 롤백 후 재기동
- [ ] 포트 바인딩 오류 해소
- [ ] 인증서 만료 임박 알림

### 완료 기준 (Definition of Done)
- DB / WAS / Web 각 레이어 대표 장애 시나리오에서 자동 복구 성공
- Self-Healing 성공률 70% 이상
- 복구 전 과정 감사 로그 저장

---

## Phase 5 — Scale-Out & Enterprise (2027 Q3~)
> **목표: 엔터프라이즈 환경 확장 및 AI 고도화**

### 확장 방향

#### 클러스터 구성 확장
- [ ] N:M 다중 클러스터 구성 지원 (Active:Active)
- [ ] Docker / Podman 컨테이너 이중화 지원
- [ ] Docker Compose 기반 서비스 스택 Failover

#### AI 고도화
- [ ] 사내 축적 장애 로그 기반 온프레미스 LLM Fine-tuning
- [ ] 예측적 장애 감지 (Predictive Failure Detection)
  - 시계열 메트릭 분석으로 장애 발생 전 사전 경고
- [ ] HACMP 기존 설정 자동 분석 → Nemesis 설정 자동 변환 (마이그레이션 도구)

#### 운영 확장
- [ ] 전체 인프라 풀스택 관제 (Web / WAS / DB / Storage / Network)
- [ ] ITSM 연동 (ServiceNow 등 티켓 자동 생성)
- [ ] 멀티 클러스터 통합 관제 대시보드

---

## 마일스톤 요약

| Phase | 기간 | 핵심 산출물 |
|---|---|---|
| Phase 1. Foundation | 2026 Q3 | 관리 서버 + AIX/Linux 에이전트 + 기본 Web UI |
| Phase 2. HA Core | 2026 Q4 | Failover + VIP 이동 + Runbook 엔진 + 통합 모니터링 |
| Phase 3. AI Failover | 2027 Q1 | AI 장애 판단 + 소프트 장애 감지 + LLM 연동 |
| Phase 4. Self-Healing | 2027 Q2 | DB/WAS/Web 자동 복구 + 복구 감사 로그 |
| Phase 5. Scale-Out | 2027 Q3~ | N:M 구성 + Docker 지원 + AI Fine-tuning |

---

## 초기 타겟 시장

```
Primary
├── 공공기관 / 연구기관
│   AIX 2~4대 규모, HACMP 전문가 부족, 예산 제약
│
├── 중소 금융권 / 지방 금융기관
│   Oracle + Tomcat 스택, 야간 운영 인력 부족
│
└── 국방 관련 기관
    인터넷 차단 환경, 온프레미스 LLM 필수,
    AIX 잔존 시스템 다수

Secondary
└── 대기업 계열사 / SI 업체
    Kubernetes 도입 전 브리지 솔루션으로 활용
```

---

## 경쟁 포지셔닝

```
              고기능
                ▲
  Kubernetes    │
  (컨테이너 전용)│
                │              Nemesis
  HACMP ────────┼──────────────── ●
  VCS           │         (경량 + AI + 크로스플랫폼)
                │
  Pacemaker     │
                │
  ──────────────┼──────────────▶
  AIX 전용      │              크로스플랫폼
                │
              경량
```

---
