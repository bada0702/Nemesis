# 에이전트 SSH 설치 위저드 설계

**날짜:** 2026-06-16  
**경로:** `/settings/agents/install`  
**인증 방식:** SSH 비밀번호  
**로그:** SSE 실시간 스트리밍

---

## 위저드 흐름

```
Step 1 [서버 정보]  →  Step 2 [연결 검증]  →  Step 3 [설치 + 로그]
```

---

## Step 1 — 서버 정보 입력

| 필드 | 기본값 | 비고 |
|------|--------|------|
| 대상 서버 IP | — | NEMESIS_SERVICE_IP로 고정 |
| SSH 사용자명 | `root` | |
| SSH 비밀번호 | — | |
| SSH 포트 | `22` | |
| 클러스터 선택 | — | 기존 클러스터 드롭다운 |
| 노드 역할 | STANDBY | PRIMARY / STANDBY |
| 핫비트 IP | (서버 IP 동일) | 별도 NIC 사용 시 입력 |

---

## Step 2 — 연결 검증

버튼 클릭 한 번으로 순서대로 체크:

1. **SSH 접속** — 22포트 연결 + 인증
2. **관리서버 → 대상 17001** — 백엔드에서 `Socket.connect` 확인
3. **대상 → 피어 핫비트(17000)** — SSH 세션에서 `nc -z <peer_heartbeat_ip> 17000` 실행 (클러스터 내 기존 노드 전체)

- 피어 목록은 선택 클러스터의 등록 노드에서 자동 조회
- 실패 항목은 원인 표시
- 실패 시 Step 3 진입 불가 (경고 무시 강제 진행 옵션 제공)

---

## Step 3 — 설치 실행 + SSE 로그

- API 키 선택 (기존 키 드롭다운 또는 신규 발급)
- "설치 시작" 클릭 → 비동기 job 시작, SSE로 실시간 로그

**로그 시퀀스:**
```
[INFO]  SSH 연결 완료 (10.0.1.12:22)
[INFO]  /tmp/nemesis-install/ 디렉토리 생성
[INFO]  nemesis-agent.py 전송 중... ✓
[INFO]  collect.sh 전송 중... ✓
[INFO]  control.sh, healing/*.sh 전송 중... ✓
[INFO]  install.sh 실행 중...
[INFO]  에이전트 시작 (NEMESIS_SERVICE_IP=10.0.1.12)
[INFO]  관리서버 등록 확인 중...
[SUCCESS] 완료! 노드: prod-node-02 (STANDBY)
```

---

## 백엔드

| 항목 | 내용 |
|------|------|
| 의존성 | `com.jcraft:jsch:0.1.55` (build.gradle) |
| `POST /api/agent-install/test` | SSH + 포트 연결성 검증, 결과 JSON 반환 |
| `POST /api/agent-install/install` | 비동기 설치 job 시작 → jobId 반환 |
| `GET /api/agent-install/stream/{jobId}` | SseEmitter 로그 스트리밍 |
| `AgentInstallService` | JSch SSH/SCP + 비동기 job 관리 |

---

## 프론트엔드

| 항목 | 내용 |
|------|------|
| 신규 페이지 | `src/pages/settings/AgentInstall.jsx` |
| 라우트 | `/settings/agents/install` (App.jsx) |
| 사이드바 | 설정 메뉴에 "에이전트 설치" 링크 추가 |
| API 클라이언트 | `testAgentInstall`, `startAgentInstall` 추가 |
