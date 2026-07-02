# NEMESIS 배포 가이드

AI 자율형 서버 이중화(HA) 솔루션. 이 패키지는 배포에 필요한 소스 일체를 담습니다.
빌드 산출물·Git 이력·시크릿(.env)은 제외돼 있습니다.

## 원클릭 설치 (권장)

대상: 깨끗한 리눅스 서버(인터넷 가능). **Docker·Ollama가 없어도 setup.sh가 자동 설치합니다.**

```bash
unzip nemesis-deploy-*.zip && cd nemesis
./setup.sh
```

`setup.sh`가 하는 일:
1. Docker(+compose) 없으면 자동 설치
2. Ollama 없으면 자동 설치 + tool 지원 기본모델(`qwen2.5:3b`) pull
3. `.env` 자동 생성 (DB 비밀번호·aibot 공유토큰 자동 발급)
4. 프론트 `dist` 빌드(node 컨테이너)
5. `docker compose up -d --build` → **postgres + backend + frontend + aibot** 한 번에 기동
6. 헬스 확인 후 접속 URL 출력

접속: `http://<host>:18090` (UI) · API `:18080`

옵션:
- `NEMESIS_NO_INSTALL=1 ./setup.sh` — Docker/Ollama 자동설치 끄고 점검만
- `NEMESIS_DEFAULT_MODEL=none ./setup.sh` — 기본 모델 pull 생략
- `NEMESIS_DEFAULT_MODEL=llama3.2:3b ./setup.sh` — 다른 기본 모델 지정

## 설치 후 AI 설정

`.env`를 손댈 필요 없습니다. **UI '시스템 설정'에서 AI 모델만 고르면** 백엔드와 aibot이
모두 그 모델을 씁니다(DB가 단일 출처, 재기동 불필요). 에이전트 채팅은 **tool 지원 모델** 필요.

## 노드 에이전트

UI [시스템 > 에이전트 설치] 위저드(SSH 원격 설치) 사용. 포트: 명령 17001, 하트비트 17000.

## 구성

```
setup.sh            원클릭 설치(서버 배포용)
dev-install.sh      로컬 개발용(npm) — 배포 아님. ./nemesis.sh 로 vite dev
docker-compose.yml  postgres + backend + frontend + aibot
.env.example        환경변수 템플릿(setup.sh가 .env 자동 생성)
backend/            Spring Boot 소스 + Dockerfile
frontend/           React 소스 + dist/(nginx 서빙)
agent/              노드 에이전트(nemesis-agent.py, control.sh)
aibot/              AI 사이드카 핵심(FastAPI /ai/*) + Dockerfile
nginx/ postgres/    서빙·DB 초기화
```

## 보안

`.env`·Google 자격증명·런타임 데이터는 패키지에서 제외했습니다. 배포지에서 생성됩니다.
`setup.sh`가 DB 비밀번호와 `NEMESIS_AIBOT_TOKEN`(백엔드↔aibot 공유)을 자동 생성합니다.
