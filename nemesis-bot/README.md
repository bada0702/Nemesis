# AI Bot (aibot)

**완전 무료** API 키 기반 개인 AI 비서 - Telegram으로 언제 어디서나!

## ✨ 주요 특징

### 🆓 완전 무료 스킬 패키지
**9개의 API 키 불필요 스킬** 통합:
- 🌤️ **날씨**: Open-Meteo (무료)
- 📰 **뉴스**: RSS 피드 (무료)
- 📈 **주식**: yfinance (무료)
-   **환율**: yfinance (무료)
- 🔍 **검색**: Naver/DuckDuckGo (무료, API 키 불필요)
-  📁 **파일 관리**: 로컬 파일 시스템
- 🌐 **FTP**: FTP 프로토콜
- 💻 **시스템**: 명령 실행, 프로세스 관리
- 📝 **노트**: 로컬 JSON 기반 (개인 메모)
- ✅ **태스크**: 로컬 JSON 기반 (할 일 관리)
- 🖥️ **서버**: 서버 모니터링

### 🤖 멀티 AI 프로바이더
- **Gemini** (Google AI) - 1,500회/일 무료, 강력 추천!
- **Ollama** (로컬/클라우드 LLM)
- **OpenRouter** (다양한 무료/유료 모델)

### 🧠 장기 기억 (RAG)
- 사용자 정보 및 대화 내용 기억
- 로컬 파일 기반 저장소 (BM25 검색)

### ⏰ 스마트 스케줄링
- 자연어 알림 설정 ("10분 뒤 알려줘")
- 반복 작업 (Cron)
- Google 캘린더/Gmail 연동 (선택사항)

---

## 🚀 빠른 시작 (5분)

### 1. 필수 준비물

- **Telegram Bot Token**: [BotFather](https://t.me/botfather)에서 발급
- **Python 3.10 이상**

### 2. 설치

```bash
# 저장소 클론
git clone <repository-url>
cd aibot

# 의존성 설치
pip install -r requirements.txt

# 설정 파일 생성
cp .env.example .env
```

### 3. 설정

`.env` 파일을 열어 **텔레그램 토큰**을 입력하세요:

```bash
TELEGRAM_TOKEN=123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ
```

#### AI 모델 선택 (하나만 설정)

**옵션 A: Google Gemini (추천)**
```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key  # Google AI Studio에서 무료 발급
```

**옵션 B: Ollama (로컬)**
```bash
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

**옵션 C: OpenRouter (무료 모델)**
```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=google/gemini-2.0-flash-lite-preview-02-05:free
```

#### ⚠️ 접근 제한 (보안 필수)

`.env`에 **본인 텔레그램 ID**를 반드시 설정하세요. 비워두면 누구나 봇을 사용할 수 있고,
`system`(명령 실행) 스킬 때문에 모르는 사람이 서버에서 명령을 실행할 수 있습니다.

```bash
# 본인 ID는 텔레그램에서 @userinfobot 으로 확인
ALLOWED_USER_ID=12345678
```

### 4. 추가 기능 설정 (선택사항)

**Google 캘린더/Gmail 연동**:
```bash
# 설정 스크립트 실행
python setup_google.py
# 브라우저 로그인 후 token_google.json 생성 확인
```

### 5. 실행

```bash
python bot.py
```

---

## 📱 사용 예시

### 날씨 조회
```
사용자: 서울 날씨 어때?
AI: 현재 서울 날씨는 맑음이며 기온은 15도입니다.
```

### 주식/환율
```
사용자: 삼성전자 주가랑 달러 환율 알려줘
AI: 삼성전자(005930.KS)는 75,000원(+1.2%)입니다. 달러/원 환율은 1,350원입니다.
```

### 할 일 관리 (ToDo)
```
사용자: "보고서 작성" 할 일 추가해줘
AI: '보고서 작성' 태스크가 추가되었습니다. (ID: 1)

사용자: 할 일 목록 보여줘
AI: 1. 보고서 작성 (Todo)
```

### 구글 캘린더 (연동 시)
```
사용자: 내일 일정 알려줘
AI: 내일은 '팀 회의'가 오전 10시에 있습니다.
```

---

## 📁 프로젝트 구조

```
aibot/
├── bot.py                    # 메인 실행 파일
├── skills/                   # 스킬 패키지
│   ├── tasks.py              # 태스크 스킬
│   ├── notes.py              # 노트 스킬
│   ├── weather.py            # 날씨 스킬
│   ├── search.py             # 검색 스킬 (No API)
│   └── ...
├── data/                     # 데이터 저장소
├── notes/                    # 노트 저장소 (notes.json)
├── tasks/                    # 태스크 저장소 (tasks.json)
├── memory/                   # 장기 기억 저장소 (RAG)
├── requirements.txt          # 의존성 목록
├── .env                      # 환경 변수 (비공개)
├── setup_google.py           # 구글 연동 설정
└── configure.sh              # 설정 도우미 스크립트
```

---

## 🎯 업데이트 내역

### v2.1.1 (2026-06-19)
- ✅ **설치 버그 수정**: `requirements.txt`의 잘못된 `subprocess` 항목 제거 (stdlib라 `pip install` 실패 원인)
- ✅ **기본 설정 정상화**: `.env.example` 기본 프로바이더 `puter`→`gemini`, 미구현 GLM/Puter 블록 제거, 실제 지원하는 OpenRouter 추가
- ✅ **보안 안내 추가**: `ALLOWED_USER_ID` 미설정 시 누구나 사용 가능함을 빠른 시작에 명시
- ✅ **스크립트 수정**: `run.sh`(`.env` 기반 체크로 변경), `aibot.sh help` 명령 정상화
- ✅ **소스 정리**: 미사용 레거시 모듈·임시/테스트 스크립트 삭제

### v2.1.0 (2026-02-20)
- ✅ **코드 최적화**: 임시/중복 스크립트 정리 (BeautifulSoup4·Pandas는 동적 스킬에서 계속 사용)
- ✅ **구글 연동 간소화**: `setup_google.py`로 캘린더/지메일 통합 인증
- ✅ **ToDo 기능 수정**: 태스크 관리 기능 정상화 및 전용 저장소(`tasks/`) 적용
- ✅ **구조 정리**: `legacy/`, `keys/` 등 불필요한 디렉토리 삭제

### v2.0.0 (2026-02-11)
- ✅ 무료 스킬 패키지 통합 (9개)
- ✅ 멀티 프로바이더 구조 (Gemini, Ollama, OpenRouter)

---

##   문제 해결

- **실행 오류**: `pip install -r requirements.txt`를 다시 실행해보세요.
- **권한 문제**: 리눅스/맥에서 `./configure.sh` 실행 시 `chmod +x configure.sh`가 필요할 수 있습니다.
 `chmod +x aibot.sh`가 필요할 수 있습니다.
 `chmod +x install.sh`가 필요할 수 있습니다.
- **Google 인증 실패**: `token_google.json`을 삭제하고 `python setup_google.py`를 다시 실행하세요.
