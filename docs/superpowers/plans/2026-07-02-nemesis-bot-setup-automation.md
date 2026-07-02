# AI 사이드카(nemesis-bot) systemd 자동 설치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `setup.sh`가 신규 서버에서도 AI 사이드카(nemesis-bot)를 `/opt/nemesis-bot`에 전용 venv + systemd 서비스로 자동 설치·기동하게 만들어, 유령 컨테이너 제거로 생긴 "신규 설치 시 AI 기능 전혀 안 뜸" 회귀를 해소한다.

**Architecture:** `setup.sh`에 Docker/Ollama 섹션과 같은 스타일로 새 섹션을 추가한다. 저장소의 `nemesis-bot/`을 `/opt/nemesis-bot`으로 rsync 동기화(코드만, `.env`/`data`/`venv` 보존) → 전용 venv 생성(requirements.txt 해시로 재설치 여부 판단) → `/opt/nemesis-bot/.env` 부트스트랩 → systemd 유닛(`nemesis-sidecar.service`) 작성/갱신 → 헬스체크. 모든 실패는 `warn`으로 처리해 스크립트 전체를 죽이지 않는다(AI는 핵심 HA 기능이 아닌 부가 기능).

**Tech Stack:** Bash(`setup.sh`), Python 3 venv, systemd, rsync.

**Spec:** `docs/superpowers/specs/2026-07-02-nemesis-bot-setup-automation-design.md` (커밋 `42e0dab`)

## Global Constraints

- 사이드카는 `/opt/nemesis-bot`에 **복사 설치**한다 (저장소 체크아웃에서 직접 실행하지 않음).
- `setup.sh`를 재실행할 때마다 저장소 `nemesis-bot/` → `/opt/nemesis-bot` **코드를 자동 동기화**한다. `.env`, `data/`, `venv/`, `.venv-hash`는 보존한다.
- venv는 `/root/aibot`과 **공유하지 않는다** — `/opt/nemesis-bot/venv`에 전용으로 생성한다(신규 서버엔 `/root/aibot`이 존재하지 않으므로).
- `.env.example`의 `NEMESIS_AIBOT_URL` 기본값은 `http://host.docker.internal:18900`(하드코딩된 도커 브릿지 IP 금지 — 재부팅 시 바뀔 수 있음).
- 이 기능의 **모든 실패는 `err`가 아니라 `warn`으로 처리**하고 `setup.sh`는 계속 진행한다(AI는 핵심 HA 기능과 무관한 부가 기능).
- `systemctl` 또는 `nemesis-bot/` 소스가 없는 환경에서는 섹션 전체를 건너뛴다(`warn`).
- `NEMESIS_NO_INSTALL=1`(`AUTO_INSTALL=1`)일 때는 apt 자동설치를 시도하지 않고 없으면 바로 skip(Docker/Ollama 섹션과 동일 패턴).

---

## File Structure

- Modify: `/var/www/html/Nemesis_v100/.env.example` — `NEMESIS_AIBOT_URL` 기본값 수정
- Modify: `/var/www/html/Nemesis_v100/setup.sh` — 신규 섹션(코드동기화/venv/env부트스트랩/systemd/헬스체크) 삽입 + 안내 배너 문구 갱신

새 파일은 생성하지 않는다. 신규 로직은 `setup.sh`의 기존 "1-b. Ollama" 섹션(줄 65-87)과 "2. .env" 섹션(줄 89) 사이에 순차적으로 삽입된다.

---

### Task 1: `.env.example`의 `NEMESIS_AIBOT_URL` 기본값 안정화

**Files:**
- Modify: `/var/www/html/Nemesis_v100/.env.example:22-25`

**Interfaces:**
- Consumes: 없음(독립 작업)
- Produces: `NEMESIS_AIBOT_URL` 기본값(신규 설치 시 `.env`에 복사되는 값). 이후 태스크와 무관 — `setup.sh`의 AI 사이드카 자동설치 로직과는 별개로, 이 값은 **백엔드 컨테이너**가 호스트의 사이드카를 호출할 때 쓰인다.

- [ ] **Step 1: 현재 내용 확인**

```bash
sed -n '22,26p' /var/www/html/Nemesis_v100/.env.example
```

Expected:
```
# AI 사이드카(aibot) — 백엔드↔aibot 공유 토큰(양쪽 동일해야 함. setup.sh 가 자동 생성)
NEMESIS_AIBOT_TOKEN=changeme-aibot-token
# 백엔드가 호출할 aibot 주소(compose 서비스명)
NEMESIS_AIBOT_URL=http://nemesis-aibot:18900
NEMESIS_AIOPS_ENABLED=true
```

- [ ] **Step 2: 수정**

`old_string`:
```
# 백엔드가 호출할 aibot 주소(compose 서비스명)
NEMESIS_AIBOT_URL=http://nemesis-aibot:18900
```

`new_string`:
```
# 백엔드가 호출할 aibot 주소(host의 systemd 사이드카, host.docker.internal 경유 — 컨테이너 재생성/재부팅에도 안정적)
NEMESIS_AIBOT_URL=http://host.docker.internal:18900
```

- [ ] **Step 3: 확인**

```bash
grep -n "NEMESIS_AIBOT_URL" /var/www/html/Nemesis_v100/.env.example
```

Expected: `NEMESIS_AIBOT_URL=http://host.docker.internal:18900` 한 줄만 출력.

이 호스트의 기존 `.env`는 이미 생성돼 있어 이 변경의 영향을 받지 않는다(신규 설치에만 적용). `grep NEMESIS_AIBOT_URL /var/www/html/Nemesis_v100/.env`로 현재 값이 그대로인지 확인해 회귀가 없음을 재확인한다.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/Nemesis_v100
git commit -m "fix(aiops): .env.example NEMESIS_AIBOT_URL을 host.docker.internal로 안정화" -- .env.example
```

---

### Task 2: AI 사이드카 코드 배치 섹션 추가 (전제조건 확인 + rsync 동기화)

**Files:**
- Modify: `/var/www/html/Nemesis_v100/setup.sh:87-89`

**Interfaces:**
- Consumes: `$ROOT`(기존 스크립트 상단에 정의됨), `$AUTO_INSTALL`(기존), `$SUDO`(기존)
- Produces: 이후 태스크가 쓰는 셸 변수 `AIBOT_SRC`(`$ROOT/nemesis-bot`), `AIBOT_DST`(`/opt/nemesis-bot`), `AIBOT_READY`(`1`=계속 진행, `0`=이후 태스크 전부 건너뜀 가드)

- [ ] **Step 1: 현재 경계 확인**

```bash
sed -n '85,90p' /var/www/html/Nemesis_v100/setup.sh
```

Expected:
```
else
    warn "Ollama 없음 — AI 기능은 Ollama 설치 후 UI 시스템설정에서 모델 지정 시 활성화."
fi

# ── 2. .env ───────────────────────────────────────────────────
if [ -f .env ]; then
```

- [ ] **Step 2: 신규 섹션 삽입**

`old_string`:
```
else
    warn "Ollama 없음 — AI 기능은 Ollama 설치 후 UI 시스템설정에서 모델 지정 시 활성화."
fi

# ── 2. .env ───────────────────────────────────────────────────
```

`new_string`:
```
else
    warn "Ollama 없음 — AI 기능은 Ollama 설치 후 UI 시스템설정에서 모델 지정 시 활성화."
fi

# ── 1-c. AI 사이드카(nemesis-bot) 자동 설치 ─────────────────────
AIBOT_SRC="$ROOT/nemesis-bot"
AIBOT_DST="/opt/nemesis-bot"
AIBOT_READY=1

if ! command -v systemctl &>/dev/null; then
    warn "systemd 없음 — AI 사이드카 자동 설치 건너뜀(수동 구성 필요)."
    AIBOT_READY=0
elif [ ! -d "$AIBOT_SRC" ]; then
    warn "nemesis-bot/ 소스 없음 — AI 사이드카 자동 설치 건너뜀."
    AIBOT_READY=0
fi

if [ "$AIBOT_READY" = "1" ] && ! python3 -c "import venv" &>/dev/null; then
    if [ "$AUTO_INSTALL" = "1" ]; then
        warn "python3-venv 미설치(NEMESIS_NO_INSTALL=1) — AI 사이드카 설치 건너뜀."
        AIBOT_READY=0
    else
        info "python3-venv 미설치 → 자동 설치..."
        ($SUDO apt-get update -y && $SUDO apt-get install -y python3-venv) 2>/dev/null || true
        python3 -c "import venv" &>/dev/null || { warn "python3-venv 설치 실패 — AI 사이드카 설치 건너뜀."; AIBOT_READY=0; }
    fi
fi

if [ "$AIBOT_READY" = "1" ]; then
    $SUDO mkdir -p "$AIBOT_DST"
    if command -v rsync &>/dev/null; then
        $SUDO rsync -a --delete \
            --exclude='.env' --exclude='data' --exclude='.git' --exclude='venv' --exclude='.venv-hash' \
            "$AIBOT_SRC"/ "$AIBOT_DST"/
    else
        warn "rsync 없음 — cp로 대체(.env/data/venv 보존)"
        TMP_KEEP="$(mktemp -d)"
        for keep in .env data venv .venv-hash; do
            [ -e "$AIBOT_DST/$keep" ] && cp -r "$AIBOT_DST/$keep" "$TMP_KEEP/$keep"
        done
        $SUDO rm -rf "${AIBOT_DST:?}"/*
        cp -r "$AIBOT_SRC"/. "$AIBOT_DST"/
        for keep in .env data venv .venv-hash; do
            [ -e "$TMP_KEEP/$keep" ] && cp -r "$TMP_KEEP/$keep" "$AIBOT_DST/$keep"
        done
        rm -rf "$TMP_KEEP"
    fi
    ok "AI 사이드카 코드 동기화 완료 ($AIBOT_DST)"
fi

# ── 2. .env ───────────────────────────────────────────────────
```

- [ ] **Step 3: 문법 확인**

```bash
bash -n /var/www/html/Nemesis_v100/setup.sh
```

Expected: 출력 없음(exit 0).

- [ ] **Step 4: 이 호스트에서 실행해 동작 확인**

```bash
cd /var/www/html/Nemesis_v100 && ./setup.sh 2>&1 | sed -n '/1-c\.\|AI 사이드카 코드 동기화/,+2p'
```

Expected: `[ OK ]  AI 사이드카 코드 동기화 완료 (/opt/nemesis-bot)` 출력.

```bash
diff -rq --exclude=.env --exclude=data --exclude=venv --exclude=.venv-hash --exclude=__pycache__ \
    /var/www/html/Nemesis_v100/nemesis-bot /opt/nemesis-bot
```

Expected: 출력 없음(두 디렉토리 동일 — `__pycache__` 등 빌드 산출물 차이는 무시).

```bash
ls /opt/nemesis-bot/.env  # 기존 .env가 그대로 남아있는지
```

Expected: 파일 존재, 삭제되지 않음.

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/Nemesis_v100
git commit -m "feat(aiops): setup.sh에 AI 사이드카 코드 동기화 섹션 추가" -- setup.sh
```

---

### Task 3: venv 생성(requirements.txt 해시 기반 조건부 재설치)

**Files:**
- Modify: `/var/www/html/Nemesis_v100/setup.sh` (Task 2가 추가한 블록의 끝, `# ── 2. .env` 바로 앞)

**Interfaces:**
- Consumes: Task 2가 만든 `AIBOT_DST`, `AIBOT_READY`
- Produces: `$AIBOT_DST/venv`(전용 가상환경), `$AIBOT_DST/.venv-hash`(마지막 설치한 requirements.txt의 sha256). `AIBOT_READY`를 pip 실패 시 `0`으로 낮출 수 있음(이후 태스크가 건너뛰도록)

- [ ] **Step 1: 삽입 지점 확인**

```bash
grep -n "AI 사이드카 코드 동기화 완료\|# ── 2\. \.env" /var/www/html/Nemesis_v100/setup.sh
```

Expected: `ok "AI 사이드카 코드 동기화 완료 ($AIBOT_DST)"` 다음 줄들에 `fi`, 빈 줄, `# ── 2. .env` 순서로 나옴.

- [ ] **Step 2: venv 생성 블록 삽입**

`old_string`:
```
    ok "AI 사이드카 코드 동기화 완료 ($AIBOT_DST)"
fi

# ── 2. .env ───────────────────────────────────────────────────
```

`new_string`:
```
    ok "AI 사이드카 코드 동기화 완료 ($AIBOT_DST)"
fi

if [ "$AIBOT_READY" = "1" ]; then
    REQ_FILE="$AIBOT_DST/requirements.txt"
    HASH_FILE="$AIBOT_DST/.venv-hash"
    NEW_HASH="$(sha256sum "$REQ_FILE" | awk '{print $1}')"
    OLD_HASH="$($SUDO cat "$HASH_FILE" 2>/dev/null || true)"
    if [ ! -x "$AIBOT_DST/venv/bin/python3" ] || [ "$NEW_HASH" != "$OLD_HASH" ]; then
        info "AI 사이드카 venv 생성/갱신(requirements.txt 변경 감지, 수 분 소요)..."
        $SUDO rm -rf "$AIBOT_DST/venv"
        $SUDO python3 -m venv "$AIBOT_DST/venv"
        if $SUDO "$AIBOT_DST/venv/bin/pip" install --no-cache-dir -r "$REQ_FILE" fastapi "uvicorn[standard]" \
                &>/tmp/nemesis-bot-pip.log; then
            echo "$NEW_HASH" | $SUDO tee "$HASH_FILE" >/dev/null
            ok "AI 사이드카 venv 준비 완료"
        else
            warn "AI 사이드카 pip install 실패(/tmp/nemesis-bot-pip.log 확인) — AI 기능 비활성."
            AIBOT_READY=0
        fi
    else
        ok "AI 사이드카 venv 최신 상태 — 재설치 건너뜀"
    fi
fi

# ── 2. .env ───────────────────────────────────────────────────
```

- [ ] **Step 3: 문법 확인**

```bash
bash -n /var/www/html/Nemesis_v100/setup.sh
```

Expected: 출력 없음.

- [ ] **Step 4: 최초 실행 — venv 신규 생성 확인**

이 호스트는 기존 `/opt/nemesis-bot/venv`가 없는 상태(지금까지 `/root/aibot`의 venv를 공유해왔음)이므로 최초 실행 시 신규 생성 경로를 그대로 탄다.

```bash
cd /var/www/html/Nemesis_v100 && time ./setup.sh 2>&1 | grep -A1 "venv"
```

Expected: `AI 사이드카 venv 생성/갱신...` → `[ OK ]  AI 사이드카 venv 준비 완료`. 수 분 소요 예상.

```bash
/opt/nemesis-bot/venv/bin/python3 -c "import fastapi, uvicorn; print('ok')"
cat /opt/nemesis-bot/.venv-hash
sha256sum /opt/nemesis-bot/requirements.txt
```

Expected: `ok` 출력, `.venv-hash` 값이 `sha256sum` 출력과 일치.

- [ ] **Step 5: 재실행 — 재설치 건너뜀(idempotency) 확인**

```bash
cd /var/www/html/Nemesis_v100 && time ./setup.sh 2>&1 | grep "venv"
```

Expected: `[ OK ]  AI 사이드카 venv 최신 상태 — 재설치 건너뜀` 만 출력, Step 4보다 훨씬 빠르게 끝남(pip install 재실행 없음).

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/Nemesis_v100
git commit -m "feat(aiops): setup.sh에 AI 사이드카 전용 venv 생성 섹션 추가" -- setup.sh
```

---

### Task 4: `/opt/nemesis-bot/.env` 부트스트랩

**Files:**
- Modify: `/var/www/html/Nemesis_v100/setup.sh` (Task 3 블록 끝, `# ── 2. .env` 바로 앞)

**Interfaces:**
- Consumes: Task 2/3의 `AIBOT_DST`, `AIBOT_READY`
- Produces: `$AIBOT_DST/.env`(없을 때만 생성, `AI_PROVIDER=ollama` / `OLLAMA_BASE_URL=http://localhost:11434` 채움)

- [ ] **Step 1: 삽입 지점 확인**

```bash
grep -n "AI 사이드카 venv 최신 상태\|# ── 2\. \.env" /var/www/html/Nemesis_v100/setup.sh
```

- [ ] **Step 2: `.env` 부트스트랩 블록 삽입**

`old_string`:
```
    else
        ok "AI 사이드카 venv 최신 상태 — 재설치 건너뜀"
    fi
fi

# ── 2. .env ───────────────────────────────────────────────────
```

`new_string`:
```
    else
        ok "AI 사이드카 venv 최신 상태 — 재설치 건너뜀"
    fi
fi

if [ "$AIBOT_READY" = "1" ]; then
    if [ ! -f "$AIBOT_DST/.env" ]; then
        [ -f "$AIBOT_DST/.env.example" ] && cp "$AIBOT_DST/.env.example" "$AIBOT_DST/.env" || $SUDO touch "$AIBOT_DST/.env"
        if grep -q '^AI_PROVIDER=' "$AIBOT_DST/.env" 2>/dev/null; then
            sed -i "s|^AI_PROVIDER=.*|AI_PROVIDER=ollama|" "$AIBOT_DST/.env"
        else
            echo "AI_PROVIDER=ollama" >> "$AIBOT_DST/.env"
        fi
        if grep -q '^OLLAMA_BASE_URL=' "$AIBOT_DST/.env" 2>/dev/null; then
            sed -i "s|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://localhost:11434|" "$AIBOT_DST/.env"
        else
            echo "OLLAMA_BASE_URL=http://localhost:11434" >> "$AIBOT_DST/.env"
        fi
        ok "AI 사이드카 .env 생성 (AI_PROVIDER=ollama)"
    else
        ok "AI 사이드카 .env 존재 — 보존"
    fi
fi

# ── 2. .env ───────────────────────────────────────────────────
```

- [ ] **Step 3: 문법 확인**

```bash
bash -n /var/www/html/Nemesis_v100/setup.sh
```

- [ ] **Step 4: 이 호스트에서 확인(기존 `.env` 보존 케이스)**

이 호스트는 `/opt/nemesis-bot/.env`가 이미 존재하므로 "보존" 분기를 탄다.

```bash
cd /var/www/html/Nemesis_v100 && ./setup.sh 2>&1 | grep "AI 사이드카 \.env"
md5sum /opt/nemesis-bot/.env  # 실행 전후 동일해야 함
```

Expected: `[ OK ]  AI 사이드카 .env 존재 — 보존`, 실행 전후 `.env`의 md5가 동일.

- [ ] **Step 5: "신규 생성" 분기 별도 검증(임시 디렉토리)**

실제 `/opt/nemesis-bot/.env`를 지우지 않고, 로직만 임시 디렉토리에서 재현한다:

```bash
TMPD="$(mktemp -d)"
cp /var/www/html/Nemesis_v100/nemesis-bot/.env.example "$TMPD/.env.example"
cd "$TMPD"
cp .env.example .env
sed -i "s|^AI_PROVIDER=.*|AI_PROVIDER=ollama|" .env
grep -q '^OLLAMA_BASE_URL=' .env && sed -i "s|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://localhost:11434|" .env || echo "OLLAMA_BASE_URL=http://localhost:11434" >> .env
grep -E "^AI_PROVIDER=|^OLLAMA_BASE_URL=" .env
rm -rf "$TMPD"
```

Expected:
```
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/Nemesis_v100
git commit -m "feat(aiops): setup.sh에 AI 사이드카 .env 부트스트랩 섹션 추가" -- setup.sh
```

---

### Task 5: systemd 유닛 작성/갱신 + 기동

**Files:**
- Modify: `/var/www/html/Nemesis_v100/setup.sh` (Task 4 블록 끝, `# ── 2. .env` 바로 앞)

**Interfaces:**
- Consumes: Task 2의 `AIBOT_DST`, `AIBOT_READY`, 그리고 스크립트 상단(줄 32)의 `$SUDO`. `NEMESIS_AIBOT_TOKEN`은 이후(현재 위치보다 뒤에 있는) "2. .env" 섹션이 메인 `.env`에 이미 채워둔 값을 읽는다 — **주의: 이 섹션은 반드시 "2. .env" 섹션 완료 이후에 실행돼야 하므로, 이번 태스크에서는 삽입 위치를 지금까지와 달리 "2. .env" 섹션 뒤로 옮긴다** (아래 Step 2 참고).
- Produces: `/etc/systemd/system/nemesis-sidecar.service`, 실행 중인 `nemesis-sidecar.service`

**중요한 순서 수정**: Task 2~4는 "1-b. Ollama" 뒤 / "2. .env" 앞에 삽입했지만, systemd 유닛에 넣을 `NEMESIS_AIBOT_TOKEN`은 "2. .env" 섹션이 메인 `.env`를 생성(또는 확인)한 **이후**에만 안전하게 읽을 수 있다. 따라서 이 태스크는 새 코드를 "2. .env" 섹션 **뒤**, 기존 "3. 프론트엔드 dist 빌드" **앞**에 삽입한다.

- [ ] **Step 1: 삽입 지점 확인**

```bash
sed -n '/# ── 2\. \.env/,/# ── 3\. 프론트엔드/p' /var/www/html/Nemesis_v100/setup.sh | tail -8
```

Expected 마지막 부분:
```
fi

# 운영 접속 origin 안내(외부 접속 시 CORS 추가 필요)
UI_PORT="$(grep -E '^NEMESIS_UI_PORT=' .env | cut -d= -f2 || true)"; UI_PORT="${UI_PORT:-18090}"

# ── 3. 프론트엔드 dist 빌드 (node 컨테이너) ─────────────────────
```

- [ ] **Step 2: systemd 유닛 블록 삽입**

`old_string`:
```
# 운영 접속 origin 안내(외부 접속 시 CORS 추가 필요)
UI_PORT="$(grep -E '^NEMESIS_UI_PORT=' .env | cut -d= -f2 || true)"; UI_PORT="${UI_PORT:-18090}"

# ── 3. 프론트엔드 dist 빌드 (node 컨테이너) ─────────────────────
```

`new_string`:
```
# 운영 접속 origin 안내(외부 접속 시 CORS 추가 필요)
UI_PORT="$(grep -E '^NEMESIS_UI_PORT=' .env | cut -d= -f2 || true)"; UI_PORT="${UI_PORT:-18090}"

# ── 2-b. AI 사이드카 systemd 서비스 ─────────────────────────────
if [ "$AIBOT_READY" = "1" ]; then
    AIBOT_TOKEN="$(grep -E '^NEMESIS_AIBOT_TOKEN=' .env | cut -d= -f2-)"
    UNIT_PATH="/etc/systemd/system/nemesis-sidecar.service"
    UNIT_TMP="$(mktemp)"
    cat > "$UNIT_TMP" <<EOF
[Unit]
Description=Nemesis aibot sidecar (FastAPI, SP1/SP3 /ai/*) — Nemesis 전용 인스턴스
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${AIBOT_DST}
Environment=NEMESIS_AIBOT_TOKEN=${AIBOT_TOKEN}
ExecStart=${AIBOT_DST}/venv/bin/python3 -m uvicorn nemesis_service:app --host 0.0.0.0 --port 18900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    UNIT_CHANGED=0
    if [ ! -f "$UNIT_PATH" ] || ! $SUDO diff -q "$UNIT_TMP" "$UNIT_PATH" &>/dev/null; then
        $SUDO cp "$UNIT_TMP" "$UNIT_PATH"
        $SUDO systemctl daemon-reload
        UNIT_CHANGED=1
    fi
    rm -f "$UNIT_TMP"

    if [ "$UNIT_CHANGED" = "1" ]; then
        $SUDO systemctl enable nemesis-sidecar.service 2>/dev/null || true
        $SUDO systemctl restart nemesis-sidecar.service
        ok "AI 사이드카 systemd 서비스 설치/갱신 후 재시작"
    elif ! $SUDO systemctl is-active --quiet nemesis-sidecar.service; then
        $SUDO systemctl enable --now nemesis-sidecar.service
        ok "AI 사이드카 systemd 서비스 시작"
    else
        ok "AI 사이드카 systemd 유닛 변경 없음 — 재시작 건너뜀"
    fi
fi

# ── 3. 프론트엔드 dist 빌드 (node 컨테이너) ─────────────────────
```

- [ ] **Step 3: 문법 확인**

```bash
bash -n /var/www/html/Nemesis_v100/setup.sh
```

- [ ] **Step 4: 이 호스트에서 실행 — 유닛 변경 감지 및 재시작 확인**

이 호스트의 기존 유닛은 `ExecStart=/root/aibot/venv/bin/python3 ...`를 가리키므로(공유 venv 방식), 새로 생성되는 유닛 내용(`/opt/nemesis-bot/venv/...`)과 달라 반드시 "설치/갱신 후 재시작" 분기를 탄다.

```bash
cat /etc/systemd/system/nemesis-sidecar.service | grep ExecStart  # 실행 전
cd /var/www/html/Nemesis_v100 && ./setup.sh 2>&1 | grep "systemd"
cat /etc/systemd/system/nemesis-sidecar.service | grep ExecStart  # 실행 후
systemctl is-active nemesis-sidecar.service
```

Expected: 실행 전 `ExecStart=/root/aibot/venv/bin/python3 ...` → 로그에 `[ OK ]  AI 사이드카 systemd 서비스 설치/갱신 후 재시작` → 실행 후 `ExecStart=/opt/nemesis-bot/venv/bin/python3 ...`, `active`.

- [ ] **Step 5: 재실행 — 변경 없음/재시작 안 함 확인**

```bash
cd /var/www/html/Nemesis_v100 && ./setup.sh 2>&1 | grep "systemd"
systemctl show nemesis-sidecar.service -p ActiveEnterTimestamp
```

Expected: `[ OK ]  AI 사이드카 systemd 유닛 변경 없음 — 재시작 건너뜀`, `ActiveEnterTimestamp`가 Step 4 시점 그대로(재시작 안 됐음).

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/Nemesis_v100
git commit -m "feat(aiops): setup.sh에 AI 사이드카 systemd 유닛 자동 설치 섹션 추가" -- setup.sh
```

---

### Task 6: 헬스체크 + 완료 안내 배너 갱신

**Files:**
- Modify: `/var/www/html/Nemesis_v100/setup.sh` (Task 5 블록 끝) 및 기존 "6. 안내" 섹션(현재 줄 156-159 부근, Task 1-5 삽입으로 줄 번호는 밀림)

**Interfaces:**
- Consumes: Task 5의 `AIBOT_READY`
- Produces: 없음(최종 사용자 안내 출력)

- [ ] **Step 1: 헬스체크 블록 삽입 지점 확인**

```bash
grep -n "AI 사이드카 systemd 유닛 변경 없음\|# ── 3\. 프론트엔드" /var/www/html/Nemesis_v100/setup.sh
```

- [ ] **Step 2: 헬스체크 블록 삽입**

`old_string`:
```
    else
        ok "AI 사이드카 systemd 유닛 변경 없음 — 재시작 건너뜀"
    fi
fi

# ── 3. 프론트엔드 dist 빌드 (node 컨테이너) ─────────────────────
```

`new_string`:
```
    else
        ok "AI 사이드카 systemd 유닛 변경 없음 — 재시작 건너뜀"
    fi

    info "AI 사이드카 헬스 대기(최대 30초)..."
    AIBOT_UP=0
    for i in $(seq 1 15); do
        if curl -fsS "http://localhost:18900/docs" &>/dev/null; then
            AIBOT_UP=1
            break
        fi
        sleep 2
    done
    if [ "$AIBOT_UP" = "1" ]; then
        ok "AI 사이드카 응답 확인 (포트 18900)"
    else
        warn "AI 사이드카 헬스 확인 실패 — 'systemctl status nemesis-sidecar' 로 확인하세요."
    fi
else
    warn "AI 사이드카 설치를 건너뛰었습니다 — AI 기능(/ai/*) 비활성."
fi

# ── 3. 프론트엔드 dist 빌드 (node 컨테이너) ─────────────────────
```

- [ ] **Step 3: 완료 안내 배너 수정**

```bash
grep -n "aibot 사이드카는 docker-compose" /var/www/html/Nemesis_v100/setup.sh
```

`old_string`:
```
echo "  AI:   aibot 사이드카는 docker-compose에 포함되지 않습니다 — systemd 서비스로"
echo "        별도 기동해야 AI 기능(/ai/*)이 동작합니다. 뜬 뒤엔 UI '시스템 설정'에서"
echo "        AI 모델만 고르면 백엔드·aibot 모두 그 모델로 동작합니다(별도 .env 편집 불필요)."
echo "        에이전트 채팅은 tool 지원 모델 필요(기본 ${NEMESIS_DEFAULT_MODEL:-qwen2.5:3b})."
```

`new_string`:
```
echo "  AI:   AI 사이드카(nemesis-bot)가 systemd 서비스로 함께 설치됐습니다. UI '시스템 설정'에서"
echo "        AI 모델만 고르면 백엔드·사이드카 모두 그 모델로 동작합니다(별도 .env 편집 불필요)."
echo "        에이전트 채팅은 tool 지원 모델 필요(기본 ${NEMESIS_DEFAULT_MODEL:-qwen2.5:3b})."
echo "        상태 확인: systemctl status nemesis-sidecar"
```

- [ ] **Step 4: 문법 확인**

```bash
bash -n /var/www/html/Nemesis_v100/setup.sh
```

- [ ] **Step 5: 전체 실행 — 헬스체크 및 배너 확인**

```bash
cd /var/www/html/Nemesis_v100 && ./setup.sh
```

Expected: 출력 끝부분에 `[ OK ]  AI 사이드카 응답 확인 (포트 18900)`, 이어서 `AI:   AI 사이드카(nemesis-bot)가 systemd 서비스로 함께 설치됐습니다...` 배너.

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/Nemesis_v100
git commit -m "feat(aiops): setup.sh AI 사이드카 헬스체크 + 완료 안내 배너 갱신" -- setup.sh
```

---

### Task 7: 전체 통합 검증 (idempotency 2회 연속 실행 + 실제 AI 기능 스모크 테스트)

**Files:** 없음(코드 변경 없음, 검증 전용)

**Interfaces:**
- Consumes: Task 1-6의 결과물 전체
- Produces: 검증 결과 로그(커밋 없음)

- [ ] **Step 1: 연속 2회 실행 — 완전한 idempotency 확인**

```bash
cd /var/www/html/Nemesis_v100
./setup.sh > /tmp/setup-run1.log 2>&1; echo "run1 exit: $?"
./setup.sh > /tmp/setup-run2.log 2>&1; echo "run2 exit: $?"
diff <(grep -E "venv|systemd|\.env" /tmp/setup-run1.log) <(grep -E "venv|systemd|\.env" /tmp/setup-run2.log)
```

Expected: 둘 다 exit 0. 두 실행 모두 AI 사이드카 관련 로그에 "건너뜀"/"보존"/"변경 없음"류 문구만 나와야 함(1회차에 이미 설치 완료된 상태이므로 2회차는 완전 idempotent, 1회차 로그와 비교 시 venv/systemd 관련 줄이 실질적으로 동일 패턴).

- [ ] **Step 2: 실제 AI 엔드포인트 스모크 테스트(백엔드 경유)**

```bash
curl -s http://localhost:18900/docs -o /dev/null -w "사이드카 직접: HTTP %{http_code}\n"
curl -s -o /dev/null -w "백엔드 경유(NEMESIS_AIBOT_URL): HTTP %{http_code}\n" \
    http://localhost:18080/api/ai/llm-config -H "Authorization: Bearer $(grep '^NEMESIS_AIBOT_TOKEN=' .env | cut -d= -f2-)"
```

Expected: 사이드카 직접 `HTTP 200`. 백엔드 경유는 라우트 존재 여부에 따라 200 또는 401(토큰 불일치 시) — 500이나 커넥션 실패만 아니면 정상(백엔드가 사이드카에 도달은 함).

- [ ] **Step 3: `/root/aibot`과의 결합 해소 확인**

```bash
systemctl show nemesis-sidecar.service -p ExecStart
ls -la /opt/nemesis-bot/venv/bin/python3
```

Expected: `ExecStart`가 `/opt/nemesis-bot/venv/bin/python3`를 가리킴(더 이상 `/root/aibot/venv` 아님) — 이번 세션 목표였던 "`/root/aibot`과 완전 독립" 달성 확인.

- [ ] **Step 4: 메모리 갱신**

`nemesis-aiops-aibot.md`에 자동화 완료 사실을 추가한다(별도 커밋 없음, memory 파일이므로 프로젝트 git과 무관):

```
**✅ setup.sh AI 사이드카 자동 설치 구현 완료 (2026-07-02):** 스펙 `docs/superpowers/specs/2026-07-02-nemesis-bot-setup-automation-design.md`, 플랜 `docs/superpowers/plans/2026-07-02-nemesis-bot-setup-automation.md`. setup.sh가 /opt/nemesis-bot에 전용 venv(requirements.txt 해시 기반 조건부 재설치) + systemd nemesis-sidecar.service를 자동 설치·재실행마다 코드 동기화(rsync, .env/data/venv 보존). 이 호스트에서 실제 마이그레이션 실행 — ExecStart가 /root/aibot/venv → /opt/nemesis-bot/venv로 전환, /root/aibot과 완전 독립. 2회 연속 idempotent 실행 확인.
```

- [ ] **Step 5: 최종 상태 보고**

전체 태스크 완료 후 `git log --oneline -7`로 6개(Task 1-6) 커밋이 순서대로 쌓였는지 확인하고 사용자에게 보고한다.

---

## Self-Review 결과

**Spec coverage:** 스펙의 8단계(venv 확인/코드동기화/venv생성/env준비/유닛작성/기동/헬스체크) 전부 Task 2-6에 매핑됨. `.env.example` 수정(스펙의 "부가 수정")은 Task 1. "이 호스트 마이그레이션" 절은 각 태스크의 Step 4/5 실행 검증에 반영됨. "테스트 계획" 3항목(idempotency, 신규생성 드라이런, URL 변경 무영향)은 Task 7 + 각 태스크 Step에 분산 반영됨.

**Placeholder 스캔:** 전 태스크에 실제 bash 코드 포함, TBD/TODO 없음.

**타입/변수 일관성 점검 및 수정 사항:** 최초 초안에서 rsync `--exclude` 목록에 `venv`/`.venv-hash`를 빠뜨리면 `--delete` 옵션 때문에 Task 3에서 만든 venv가 다음 실행 때 rsync에 의해 통째로 삭제되는 버그가 될 뻔해서, Task 2 작성 시점에 바로 잡아 `--exclude='venv' --exclude='.venv-hash'`를 포함시켰다(및 cp 폴백 경로도 동일하게 보존 대상에 포함). Task 5에서 `NEMESIS_AIBOT_TOKEN`을 읽으려면 메인 `.env`가 먼저 생성돼 있어야 하므로, Task 2-4와 달리 Task 5-6의 삽입 위치를 "2. .env" 섹션 **뒤**로 명시적으로 옮겼다(순서 의존성 명시).

**스코프 체크:** 단일 서브시스템(setup.sh 자동화), 별도 분해 불필요.
