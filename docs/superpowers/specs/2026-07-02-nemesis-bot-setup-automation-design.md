# AI 사이드카(nemesis-bot) systemd 자동 설치 — 설계

## 배경

`feat/aiops-sp3` 브랜치의 같은 세션에서 두 가지가 먼저 정리됐다:

1. **`/root/aibot` 이중 기동 버그 수정**: 텔레그램 봇(`/root/aibot/bot.py`)이 수동 `nohup` 프로세스와 systemd `aibot.service`(동일 스크립트) 양쪽에서 동시에 뜨려다 PID 락 충돌로 4일간 20,864회 재시작 루프. 수동 프로세스를 정리하고 systemd 단일 관리로 복귀.
2. **이름 충돌 정리**: Nemesis 쪽 AI 사이드카가 `/root/aibot`(텔레그램 봇)과 폴더명이 겹쳐 혼동을 유발 → 저장소 `Nemesis_v100/aibot/` → `nemesis-bot/`으로 개명, 운영 배포본 `/opt/nemesis-aibot` → `/opt/nemesis-bot`으로 개명(systemd `nemesis-sidecar.service`의 `WorkingDirectory` 갱신).
3. **유령 컨테이너 정리**: `docker-compose.yml`에 정의돼 있던 `nemesis-aibot` 서비스가 4일째 떠 있었지만 실제 트래픽은 없었음(백엔드가 부르는 `NEMESIS_AIBOT_URL`이 도커 브릿지 게이트웨이를 거쳐 systemd 인스턴스로 감) — 컨테이너·이미지 삭제 + compose 서비스 블록 제거.

3번 정리 결과 **신규 서버에 `setup.sh`로 설치하면 AI 사이드카가 전혀 안 뜨는 회귀**가 생겼다. 지금까지 이 사이드카는 이 호스트에서만 수동으로 구성돼 있었고(systemd 유닛 손수 작성, venv도 별개 프로젝트인 `/root/aibot`의 것을 공유), 신규 서버에는 그대로 재현 불가능한 상태였다. 이 스펙은 `setup.sh`가 신규 서버에서도 AI 사이드카를 자동으로 설치·기동하도록 만드는 것이 목표다.

## 결정된 사항

브레인스토밍 세션에서 사용자가 직접 선택:

- **실행 위치**: 저장소 체크아웃에서 직접 실행하지 않고, 지금과 같이 `/opt/nemesis-bot`으로 복사 설치하는 방식을 유지한다.
- **코드 동기화**: `setup.sh`를 재실행할 때마다 저장소 `nemesis-bot/`을 `/opt/nemesis-bot`으로 자동 동기화한다(`.env`/`data`는 보존). 지금까지 문서에 "동기화 수동"이라고 적혀 있던 문제를 여기서 해소한다.
- **`NEMESIS_AIBOT_URL` 안정화**: `.env.example` 기본값을 하드코딩된 도커 브릿지 IP(`http://172.18.0.1:18900`, 재부팅/네트워크 재생성 시 바뀔 수 있음)에서 `http://host.docker.internal:18900`로 바꾼다(`nemesis-server` 컨테이너에는 이미 `host.docker.internal` 매핑이 있음). 이번 이름 변경과는 무관한 안정성 수정이지만 범위에 포함하기로 함.

venv를 `/root/aibot`과 공유하지 않고 `/opt/nemesis-bot` 전용으로 새로 만드는 것은 선택지가 아니라 필수다 — `/root/aibot`은 Nemesis 저장소 밖의 별개 프로젝트(텔레그램 봇)라 신규 서버엔 존재하지 않는다.

## 설계

### `setup.sh` 신규 섹션 (기존 "4. 컨테이너 기동" 다음에 삽입, "1-b. Ollama" 섹션과 같은 스타일/관용구 재사용)

```
1) python3-venv 확인
   - `python3 -c "import venv"` 실패하면:
     - AUTO_INSTALL=1(NEMESIS_NO_INSTALL) 이면: warn 후 섹션 전체 skip, setup.sh는 계속 진행
     - 아니면: `apt-get install -y python3-venv` 시도, 그래도 실패하면 warn 후 skip

2) /opt/nemesis-bot 준비
   - 없으면 mkdir -p

3) 코드 동기화 (매 실행마다)
   - rsync -a --delete --exclude=.env --exclude=data --exclude=.git \
       "$ROOT/nemesis-bot/" /opt/nemesis-bot/
   - rsync 없으면 (설치 안 된 미니멀 서버 대비) cp -r 폴백 + 기존 .env/data 보존 로직

4) venv (조건부 재생성)
   - REQ_HASH="$(sha256sum "$ROOT/nemesis-bot/requirements.txt" | awk '{print $1}')"
   - 저장된 해시(/opt/nemesis-bot/.venv-hash)와 다르거나 venv 없으면:
     - python3 -m venv /opt/nemesis-bot/venv
     - /opt/nemesis-bot/venv/bin/pip install --no-cache-dir -r requirements.txt fastapi "uvicorn[standard]"
       (Dockerfile의 설치 커맨드와 동일하게 맞춤)
     - 성공 시 해시를 .venv-hash에 기록
   - 실패하면 warn 후 섹션 skip(치명적 아님)

5) .env 준비
   - /opt/nemesis-bot/.env 없으면:
     - cp /opt/nemesis-bot/.env.example /opt/nemesis-bot/.env
     - sed로 AI_PROVIDER=ollama, OLLAMA_BASE_URL=http://localhost:11434 채움
   - 있으면 그대로 보존

6) systemd 유닛 작성
   - 메인 .env에서 NEMESIS_AIBOT_TOKEN 읽기(없으면 앞 단계에서 이미 생성돼 있어야 함 — 기존 로직 그대로)
   - /etc/systemd/system/nemesis-sidecar.service 를 heredoc으로 작성(내용은 "현재 상태" 절 참고)
   - 기존 파일과 내용이 다를 때만 덮어쓰기(불필요한 재시작 방지)

7) 기동
   - systemctl daemon-reload
   - 유닛이 새로 생겼거나 내용이 바뀌었으면: systemctl enable --now nemesis-sidecar (또는 이미 active면 restart)
   - 이미 active이고 유닛 변경 없으면: 그대로 둠(불필요한 재시작 방지)

8) 헬스체크
   - 최대 30초 폴링: curl -fsS http://localhost:18900/docs
   - 성공: ok, 실패: warn(치명적 아님 — Ollama처럼 선택 기능 취급)
```

### systemd 유닛 템플릿

기존 수동 구성과 동일한 형태를 스크립트가 생성:

```ini
[Unit]
Description=Nemesis aibot sidecar (FastAPI, SP1/SP3 /ai/*) — Nemesis 전용 인스턴스
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/nemesis-bot
Environment=NEMESIS_AIBOT_TOKEN=<메인 .env의 NEMESIS_AIBOT_TOKEN 값>
ExecStart=/opt/nemesis-bot/venv/bin/python3 -m uvicorn nemesis_service:app --host 0.0.0.0 --port 18900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

(기존 유닛은 `ExecStart`가 `/root/aibot/venv/bin/python3`를 가리켰다 — 공유 venv였기 때문. 신규 설계에서는 `/opt/nemesis-bot/venv`로 자체 venv를 쓰므로 경로가 바뀐다. 이 호스트의 기존 유닛도 자동 설치 로직이 재실행되면 이 새 경로로 갱신된다 — 아래 "이 호스트 마이그레이션" 참고.)

### `.env.example` 수정

```diff
- NEMESIS_AIBOT_URL=http://nemesis-aibot:18900
+ NEMESIS_AIBOT_URL=http://host.docker.internal:18900
```

(주석도 "compose 서비스명" → "host의 systemd 사이드카" 로 갱신)

### setup.sh 안내 문구 조정

이전 세션에 "AI 사이드카는 compose에 없고 systemd로 별도 기동 필요"라고 바꿔둔 안내를, 자동 설치되므로 원래 취지("설치 시 함께 뜬다")에 맞게 다시 조정한다. 단, 정확히 "compose 컨테이너"가 아니라 "host systemd 서비스"로 뜬다는 점은 명시한다.

## 이 호스트에서의 마이그레이션

이 호스트는 이미 `/opt/nemesis-bot`이 `/root/aibot`의 공유 venv로 구성돼 있다. 자동화 로직을 이 호스트에서 실행하면:

- venv 해시가 없으므로(`.venv-hash` 파일 부재) 최초 1회 자체 venv를 새로 만든다(다운로드/설치 시간 소요, `requirements.txt` 51줄 기준 수 분 예상).
- systemd 유닛의 `ExecStart`가 `/root/aibot/venv/...` → `/opt/nemesis-bot/venv/...`로 바뀌므로 재시작이 발생한다(수 초 다운타임).
- 이후로는 `/root/aibot`과 완전히 독립적으로 동작 — `/root/aibot`이 없어지거나 바뀌어도 Nemesis AI 사이드카에 영향 없음(오히려 이번 결합도 제거가 부수 이득).

## 에러 처리 / 실패 시나리오

- **`python3-venv` 설치 실패** (오프라인 서버, apt 미러 문제 등): warn 후 섹션 skip, `setup.sh`는 정상 종료. AI 기능만 비활성.
- **`pip install` 실패** (네트워크, 의존성 컴파일 실패 등): warn 후 섹션 skip, 부분 생성된 venv는 다음 실행 때 해시 불일치로 재시도됨.
- **rsync 없음**: `cp -r` 폴백 사용, `.env`/`data`는 별도 백업/복원으로 보존.
- **systemd 없음(비-systemd 배포판)**: `command -v systemctl` 체크 후 없으면 섹션 전체 skip(warn) — Docker/Ollama도 이 환경 지원 안 하므로 일관성 있음.
- 이 섹션의 모든 실패는 `err`(스크립트 종료)가 아니라 `warn`(계속 진행)으로 처리한다. AI 사이드카는 핵심 HA 기능(감지·페일오버)과 무관한 부가 기능이기 때문.

## 테스트 계획

완전한 "빈 서버" 재현은 이 환경에서 어렵다(이미 `/opt/nemesis-bot`이 구성돼 있고 시스템 패키지도 이미 설치돼 있음). 대신:

1. **이 호스트에서 실제 마이그레이션 실행**: `setup.sh` 재실행 → venv 신규 생성 → systemd 유닛 갱신 → 재시작 → `/docs` 200 확인. 기존 기능(`AiOperatorClient` 경유 `/ai/investigate|execute|chat|scan`)이 새 venv에서도 동작하는지 스모크 테스트.
2. **재실행 idempotency**: 위 실행 직후 `setup.sh`를 한 번 더 실행 — venv 재생성 안 됨(해시 일치), systemd 유닛 재작성 안 됨(내용 동일), 불필요한 재시작 없음을 확인.
3. **venv 생성 로직 단독 드라이런**: 임시 디렉토리에 `requirements.txt`만 놓고 venv 생성 + pip install 스크립트 블록만 떼어 실행 — 신규 서버의 "처음부터 만들기" 경로를 근사 검증.
4. `NEMESIS_AIBOT_URL` 변경은 `.env.example`만 건드리므로 기존 `.env`(이미 생성됨)에는 영향 없음 — 이 호스트의 실제 동작 변화 없음, 신규 설치에만 적용됨을 확인.

## 범위 밖

- 완전한 물리적 "빈 서버" 통합 테스트(CI 등)는 이번 스펙 범위 밖.
- `nemesis-bot`의 Telegram/Gmail/KIS 등 불필요한 스킬 관련 env var 정리(현재 `.env.example`에 텔레그램 봇에서 물려받은 무관한 설정이 다수 있음)는 별도 작업으로 남긴다.
- 도커 기반 배포로 되돌리는 것(향후 필요 시)은 이 스펙에서 다루지 않는다.
