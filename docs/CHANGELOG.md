# 변경 이력 (Changelog)

이 파일은 Nemesis의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전은 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 따릅니다.

> **업그레이드 원칙**: DB 스키마 변경은 Flyway 마이그레이션(`backend/src/main/resources/db/migration/`)으로만 적용되며
> 서버 기동 시 자동 실행됩니다. 다운그레이드는 지원하지 않으므로, 업그레이드 전 PostgreSQL 볼륨(`nemesis-data`) 백업을 권장합니다.
> 에이전트(`agent/`)는 노드에 재배포 후 재시작이 필요합니다(`control.sh`는 재시작 없이 즉시 반영).

## [Unreleased] — feat/aiops-sp3

### Added (추가)
- **AI 운영 센터**: 현황·에러 / 장애 예측 / 검토 승인 3탭. 능동 모니터링 finding과 조치 제안을 한 곳에서 관리.
- **클러스터 AI 장애 진단**: 자원·에러로그를 포함한 컨텍스트 기반 4섹션 한국어 보고서(종합 상태·노드별 관찰·근본 원인·권장 조치). LLM 미설정 시 규칙 기반 폴백.
- **대시보드 실시간 로그 분석 패널**(구 OPEN ISSUE): finding 삭제, 연결된 AI 조치 제안 내용 표시.
- **AI 조치 제안 패널**: 대시보드 좌측 "진행중인 작업" 위에 별도 카드로 분리(채팅 패널 폭 확보).
- **Runbook 진단 명령**: `control.sh`에 `health`/`logs`/`replication`/`cluster-join`/`maintenance` 서브커맨드 추가.
- **CHANGELOG.md** 도입.

### Changed (변경)
- **대시보드 레이아웃**: 실시간 알람·실시간 로그 분석 패널을 이중화 동기화 패널과 동일 높이로 고정하고 내부 스크롤 처리(콘텐츠 누적 시에도 패널이 길어지지 않음).
- **DB/Application 패널**: 서비스를 노드(hostname)별로 그룹화하고, 종류별 실제 아이콘 표시.
- **동기화 지연 시간(Lag)**: 하드코딩 `0ms` 제거 → Primary·Standby heartbeat 시각 차이로 실측 표시.
- **LLM 프롬프트**: 근본 원인·조치 설명을 한국어로 강제.
- **실시간 알람 상세 모달**: 알람 유형(CPU/메모리/디스크/노드 장애)별 문제 내용·해결 방안을 제공하고 모달 크기 확대.
- **에러 메시지**: 로그인 실패 안내 구체화, 에이전트의 비허용 명령 거부 시 허용 목록 동봉.
- **에이전트 `--help`**: 인자 설명 추가.

### Fixed (수정)
- **노드 Runbook 버튼 실행 실패(403)**: 에이전트 화이트리스트를 통과하도록 모든 Runbook 작업을 `control.sh` 서브커맨드로 라우팅. `restart`는 `svc-restart` 단일 명령으로 교정(과거 `&&` 복합명령은 shell 미사용 실행이라 동작 안 함).
- **AI 운영 검토 승인 후 결과 미표시**: 승인 시 실행 결과(성공/실패·로그) 배너 표시.

### Security (보안)
- **읽기 API 무인증 노출 차단**: 기존에는 모든 GET/대시보드 API가 토큰 없이 접근 가능했음(인프라 토폴로지·IP·VIP·메트릭 노출). 이제 `/api/**`는 로그인 사용자(역할 무관) 토큰을 요구. 단 로그인(`/api/auth/login`), 에이전트 자체-인증 채널(`/api/agent/register|heartbeat|metrics|meta`), CORS preflight는 공개 유지.

## [1.0.0] — 기준선
- 관리 서버(Spring Boot) + PostgreSQL + Flyway, React/Vite 웹 UI, Python 단일 파일 에이전트.
- VIP 페일오버, 자가 복구(Self-Healing), 폴더 동기화(Directory Sync), RBAC, AIOps(aibot) 사이드카 연동.
