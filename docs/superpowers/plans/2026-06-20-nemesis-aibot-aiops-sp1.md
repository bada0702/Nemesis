# Nemesis × aibot AIOps (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aibot(LangGraph 에이전트)을 Nemesis HA에 "AI 운영자 두뇌"로 접목해 감지→조사→조치제안→사람승인→실행→보고 한 가닥을 end-to-end로 동작시키고, 다 만든 뒤 실제 작동을 테스트한다.

**Architecture:** aibot은 `127.0.0.1:18900` FastAPI 사이드카 서비스(`/ai/investigate`·`/ai/execute`·`/ai/chat`)로 노출하고, Nemesis(Java)가 오케스트레이션(제안 저장·RBAC 승인·감사·헤더 알림)한다. 변경 행동은 항상 사람 승인 후 실행하되, active 노드 사망 페일오버는 기존 결정론 경로가 자동 수행한다. aibot이 죽어도 Nemesis HA는 영향받지 않는다(폴백).

**Tech Stack:** Python(FastAPI/uvicorn/paramiko, 기존 LangGraph), Java 17/Spring Boot/JPA/Flyway/RestTemplate, React/Vite/axios/lucide-react, PostgreSQL(테스트 H2 PostgreSQL 모드), Docker(`gradle:8.7-jdk17`).

## Global Constraints

- 백엔드 패키지: 신규 코드는 `com.nemesis.domain.aiops`.
- 설정 prefix: `nemesis.aiops.*` (application.yml), env 분리.
- aibot 서비스 바인드: `127.0.0.1:18900`만. 인증: 공유 Bearer `NEMESIS_AIBOT_TOKEN`.
- 로컬에 JDK/gradle 없음 → 백엔드 컴파일/테스트는 **Docker `gradle:8.7-jdk17`** 로만 수행.
- JSON 컬럼은 jsonb 대신 **TEXT + Jackson 직렬화**(H2 테스트 호환).
- 신규 제어 API(`approve`/`reject`)는 **RBAC operator+** (`RbacFilter` 경로 추가).
- HA 무의존 원칙: aibot 불통 시 investigate는 제안 생략(로그만), 기존 결정론 페일오버 경로 불변.
- 읽기/쓰기 분리: `/ai/investigate`는 읽기 도구만 바인드한 LangGraph로 실행. 변경은 승인된 명령셋을 `/ai/execute`가 그대로만 실행.
- SSH: aibot 전용 키 인증(paramiko). Nemesis는 `sshTarget{host,port,user}`만 전달(비밀번호 미저장). host=`node.serviceIp`, user=`nemesis.aiops.ssh-user`(기본 `root`), port=22.
- 기존 패턴 준수: 엔티티 Lombok `@Builder`+`@PrePersist`, 컨트롤러 `@RequiredArgsConstructor`, 한국어 주석/메시지.

---

## File Structure

**aibot (Python, `/root/aibot/`)**
- Create `nemesis_service.py` — FastAPI 앱(엔드포인트 4종 + 인증 + 에이전트 부팅).
- Create `nemesis_ops_tools.py` — Nemesis 연동/원격 SSH 도구(`nemesis_state`, `remote_tail_log`, `remote_read_file`, `remote_diagnose`, `remote_exec`).
- Modify `langgraph_agent.py` — 읽기전용 도구셋으로 1회 실행하는 `run_investigation()` 추가.
- Modify `requirements.txt` — `fastapi`, `uvicorn[standard]`, `paramiko`.
- Modify `.env.example` — `NEMESIS_AIBOT_TOKEN`, `NEMESIS_API_URL`, `NEMESIS_OPS_SSH_KEY`.
- Create `tests/test_nemesis_service.py` — 서비스 계약·인증·읽기전용·실행 한정 테스트.
- Create `nemesis-aibot.service` — systemd 유닛(부팅 자동기동).

**Nemesis backend (Java, `backend/src/main/java/com/nemesis/`)**
- Create `domain/aiops/AiProposal.java` — 제안 엔티티.
- Create `domain/aiops/AiProposalRepository.java` — 파생쿼리.
- Create `domain/aiops/AiOperatorProperties.java` — `@ConfigurationProperties("nemesis.aiops")`.
- Create `domain/aiops/AiOperatorClient.java` — aibot 호출(RestTemplate, 타임아웃, health).
- Create `domain/aiops/AiOperatorService.java` — 조율(investigate→제안, approve→execute, reject, 폴백).
- Create `domain/aiops/AiProposalController.java` — `/api/ai/proposals*`.
- Create `domain/aiops/dto/` — 요청/응답 record(`InvestigateRequest`, `InvestigateResponse`, `ExecuteRequest`, `ExecuteResponse`, `ProposalDto`).
- Modify `domain/ai/AiChatController.java` — aibot `/ai/chat` 프록시 + LlmService 폴백.
- Modify `domain/failover/FailoverTriggerListener.java` — SELF_HEAL/페일오버 후 `onFault` 비동기 조사 호출.
- Modify `security/RbacFilter.java` — approve/reject 경로 operator+.
- Modify `backend/src/main/resources/application.yml` — `nemesis.aiops.*`, RestTemplate Bean 확인.
- Create `backend/src/main/resources/db/migration/V11__ai_proposals.sql`.
- Create tests: `domain/aiops/AiOperatorServiceTest.java`, `AiProposalControllerRbacTest.java`, `AiOperatorClientTest.java`.

**Frontend (React, `frontend/src/`)**
- Modify `api/client.js` — 제안/알림 API + `aiChat` 확장.
- Modify `components/dashboard/AiPanel.jsx` — 제안 카드 + 승인/거부(operator 게이트).
- Modify `components/Navbar.jsx` — 벨을 실데이터(PENDING 카운트+드롭다운)로 연결.

---

## Phase 1 — aibot 서비스 (Python)

### Task 1: 서비스 스캐폴드 + `/health` + Bearer 인증

**Files:**
- Create: `/root/aibot/nemesis_service.py`
- Modify: `/root/aibot/requirements.txt`
- Modify: `/root/aibot/.env.example`
- Test: `/root/aibot/tests/test_nemesis_service.py`

**Interfaces:**
- Produces: FastAPI `app`; 의존성 `require_token`; 환경 `NEMESIS_AIBOT_TOKEN`. `GET /health` → `{"status":"ok"}`.

- [ ] **Step 1: 의존성 추가**

`requirements.txt` 끝에 추가:
```
fastapi>=0.110
uvicorn[standard]>=0.29
paramiko>=3.4
httpx>=0.27
```
설치: `cd /root/aibot && ./venv/bin/pip install -r requirements.txt`

- [ ] **Step 2: 실패하는 테스트 작성**

`/root/aibot/tests/test_nemesis_service.py`:
```python
import os
os.environ["NEMESIS_AIBOT_TOKEN"] = "test-secret"
from fastapi.testclient import TestClient
import nemesis_service

client = TestClient(nemesis_service.app)
AUTH = {"Authorization": "Bearer test-secret"}

def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

def test_chat_requires_token():
    r = client.post("/ai/chat", json={"message": "hi"})
    assert r.status_code == 401

def test_chat_rejects_wrong_token():
    r = client.post("/ai/chat", json={"message": "hi"},
                    headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
```

- [ ] **Step 3: 실패 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/test_nemesis_service.py::test_health_ok -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'nemesis_service'`

- [ ] **Step 4: 최소 구현**

`/root/aibot/nemesis_service.py`:
```python
"""
nemesis_service.py — Nemesis ↔ aibot 사이드카 FastAPI 서비스.
127.0.0.1:18900 에 바인드, 공유 Bearer 토큰으로 인증.
엔드포인트: /health, /ai/chat, /ai/investigate, /ai/execute
"""
import os
import logging
from fastapi import FastAPI, Depends, Header, HTTPException

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nemesis_service")

AIBOT_TOKEN = os.getenv("NEMESIS_AIBOT_TOKEN", "")

app = FastAPI(title="Nemesis aibot service")

def require_token(authorization: str = Header(default="")):
    if not AIBOT_TOKEN:
        raise HTTPException(status_code=503, detail="NEMESIS_AIBOT_TOKEN 미설정")
    if not authorization.startswith("Bearer ") or authorization[7:] != AIBOT_TOKEN:
        raise HTTPException(status_code=401, detail="invalid token")
    return True

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/ai/chat")
def chat(_: bool = Depends(require_token)):
    raise HTTPException(status_code=501, detail="not implemented")  # Task 2에서 구현
```

- [ ] **Step 5: 통과 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/test_nemesis_service.py -v`
Expected: 3 passed

- [ ] **Step 6: .env.example 갱신 + 커밋**

`.env.example`에 추가:
```
# Nemesis 연동 (사이드카 서비스)
NEMESIS_AIBOT_TOKEN=change-me-shared-secret
NEMESIS_API_URL=http://localhost:18080
NEMESIS_OPS_SSH_KEY=/root/aibot/.ssh/nemesis_ops
```
```bash
cd /root/aibot
git add nemesis_service.py requirements.txt .env.example tests/test_nemesis_service.py
git commit -m "feat(nemesis): aibot 사이드카 서비스 스캐폴드 + Bearer 인증"
```

---

### Task 2: `/ai/chat` — 기존 LangGraphAgent 재사용

**Files:**
- Modify: `/root/aibot/nemesis_service.py`
- Test: `/root/aibot/tests/test_nemesis_service.py`

**Interfaces:**
- Consumes: `require_token` (Task 1).
- Produces: `POST /ai/chat {message, sessionId?}` → `{"reply": str, "proposalId": str|null}`. 에이전트는 `get_agent()`로 지연 생성(테스트는 monkeypatch로 대체).

- [ ] **Step 1: 실패 테스트 추가**

`tests/test_nemesis_service.py`에 추가:
```python
def test_chat_returns_reply(monkeypatch):
    class FakeAgent:
        async def run(self, message, user_id, chat_id, progress_callback=None):
            return f"echo:{message}"
    monkeypatch.setattr(nemesis_service, "get_agent", lambda: FakeAgent())
    r = client.post("/ai/chat", json={"message": "상태 알려줘"}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["reply"] == "echo:상태 알려줘"
```

- [ ] **Step 2: 실패 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/test_nemesis_service.py::test_chat_returns_reply -v`
Expected: FAIL (501 not implemented)

- [ ] **Step 3: 구현**

`nemesis_service.py`의 chat 스텁을 교체하고 에이전트 빌더 추가:
```python
import asyncio

_agent = None

def get_agent():
    """기존 bot.py 와 동일하게 LangGraphAgent 를 1회 구성(텔레그램 제외)."""
    global _agent
    if _agent is None:
        from aibot import AIBot as AIEngine
        from langgraph_agent import LangGraphAgent
        from cron_scheduler import CronScheduler
        import mcp_server
        from skill_generator import SkillGenerator
        ai = AIEngine(calendar_client=None, reminder_manager=None, mcp_server=mcp_server)
        ai.cron_scheduler = CronScheduler()
        _agent = LangGraphAgent(
            skills_manager=ai.skills_manager,
            memory_manager=ai.memory_manager,
            cron_scheduler=ai.cron_scheduler,
            skill_generator=SkillGenerator(),
            tool_manager=getattr(ai, "tool_manager", None),
        )
    return _agent

@app.post("/ai/chat")
def chat(body: dict, _: bool = Depends(require_token)):
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message 비어있음")
    agent = get_agent()
    reply = asyncio.run(agent.run(message, user_id=0, chat_id=0))
    return {"reply": reply, "proposalId": None}
```
(기존 `@app.post("/ai/chat")` 스텁 데코레이터/함수는 제거.)

- [ ] **Step 4: 통과 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/test_nemesis_service.py -v`
Expected: 4 passed

- [ ] **Step 5: 커밋**

```bash
cd /root/aibot && git add nemesis_service.py tests/test_nemesis_service.py
git commit -m "feat(nemesis): /ai/chat 엔드포인트(LangGraphAgent 재사용)"
```

---

### Task 3: 원격 SSH 도구 + `/ai/investigate` (읽기전용)

**Files:**
- Create: `/root/aibot/nemesis_ops_tools.py`
- Modify: `/root/aibot/langgraph_agent.py`
- Modify: `/root/aibot/nemesis_service.py`
- Test: `/root/aibot/tests/test_nemesis_service.py`, `/root/aibot/tests/test_ops_tools.py`

**Interfaces:**
- Produces:
  - `nemesis_ops_tools.READ_TOOLS` (list[BaseTool]): `nemesis_state`, `remote_tail_log`, `remote_read_file`, `remote_diagnose`.
  - `nemesis_ops_tools.remote_exec(host, port, user, command) -> dict{exitCode, output}` (Task 4 사용).
  - `LangGraphAgent.run_investigation(context: dict, ssh_target: dict) -> dict` → `{diagnosis, rootCause, proposedActions:[{description,command,target,riskLevel}], confidence}`.
  - `POST /ai/investigate {context, sshTarget}` → 위 dict.

- [ ] **Step 1: ops 도구 실패 테스트**

`/root/aibot/tests/test_ops_tools.py`:
```python
import nemesis_ops_tools as ops

def test_read_tools_exclude_exec():
    names = {t.name for t in ops.READ_TOOLS}
    assert "remote_tail_log" in names
    assert "remote_read_file" in names
    assert "nemesis_state" in names
    assert "remote_exec" not in names   # 쓰기 도구는 읽기 셋에서 제외

def test_remote_exec_uses_paramiko(monkeypatch):
    calls = {}
    class FakeStdout:
        def read(self): return b"ok\n"
        channel = type("C", (), {"recv_exit_status": staticmethod(lambda: 0)})()
    class FakeClient:
        def set_missing_host_key_policy(self, *a): pass
        def connect(self, **kw): calls.update(kw)
        def exec_command(self, cmd): calls["cmd"] = cmd; return (None, FakeStdout(), FakeStdout())
        def close(self): pass
    monkeypatch.setattr(ops.paramiko, "SSHClient", lambda: FakeClient())
    r = ops.remote_exec("10.0.0.5", 22, "root", "echo ok")
    assert r["exitCode"] == 0
    assert "ok" in r["output"]
    assert calls["cmd"] == "echo ok"
```

- [ ] **Step 2: 실패 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/test_ops_tools.py -v`
Expected: FAIL — `ModuleNotFoundError: nemesis_ops_tools`

- [ ] **Step 3: ops 도구 구현**

`/root/aibot/nemesis_ops_tools.py`:
```python
"""Nemesis 운영 도구: 원격 SSH(읽기/실행) + Nemesis 상태 조회."""
import os
import json
import paramiko
import httpx
from langchain_core.tools import tool

NEMESIS_API_URL = os.getenv("NEMESIS_API_URL", "http://localhost:18080")
SSH_KEY = os.getenv("NEMESIS_OPS_SSH_KEY", "/root/aibot/.ssh/nemesis_ops")
SSH_USER_DEFAULT = os.getenv("NEMESIS_OPS_SSH_USER", "root")

# 조사/실행이 공유하는 SSH 컨텍스트(서비스가 요청별로 설정).
_ctx = {"host": None, "port": 22, "user": SSH_USER_DEFAULT}

def set_ssh_context(host, port=22, user=None):
    _ctx["host"] = host
    _ctx["port"] = port or 22
    _ctx["user"] = user or SSH_USER_DEFAULT

def remote_exec(host, port, user, command, timeout=30):
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        cli.connect(hostname=host, port=port, username=user,
                    key_filename=SSH_KEY, timeout=timeout)
        _, stdout, stderr = cli.exec_command(command)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        return {"exitCode": code, "output": (out + err)[:8000]}
    finally:
        cli.close()

def _read(command):
    c = _ctx
    if not c["host"]:
        return "❌ SSH 컨텍스트 미설정"
    r = remote_exec(c["host"], c["port"], c["user"], command)
    return r["output"] if r["exitCode"] == 0 else f"❌ (exit {r['exitCode']}) {r['output']}"

@tool
def remote_tail_log(path: str, lines: int = 100) -> str:
    """대상 노드의 로그 파일 마지막 N줄을 읽는다(읽기 전용)."""
    return _read(f"tail -n {int(lines)} {path}")

@tool
def remote_read_file(path: str) -> str:
    """대상 노드의 텍스트 파일 내용을 읽는다(읽기 전용, 최대 8KB)."""
    return _read(f"cat {path}")

@tool
def remote_diagnose() -> str:
    """대상 노드의 프로세스/디스크/메모리 개요를 수집한다(읽기 전용)."""
    return _read("echo '== ps =='; ps aux --sort=-%cpu | head -15; "
                 "echo '== disk =='; df -h; echo '== mem =='; free -m")

@tool
def nemesis_state(path: str = "/api/clusters") -> str:
    """Nemesis 백엔드의 읽기 API를 조회한다(예: /api/clusters)."""
    try:
        r = httpx.get(NEMESIS_API_URL + path, timeout=10)
        return r.text[:8000]
    except Exception as e:
        return f"❌ Nemesis 조회 실패: {e}"

READ_TOOLS = [remote_tail_log, remote_read_file, remote_diagnose, nemesis_state]
```

- [ ] **Step 4: ops 도구 통과 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/test_ops_tools.py -v`
Expected: 2 passed

- [ ] **Step 5: `run_investigation` 실패 테스트**

`tests/test_nemesis_service.py`에 추가:
```python
def test_investigate_returns_plan(monkeypatch):
    fake = {
        "diagnosis": "oracle pmon 부재",
        "rootCause": "archive full",
        "proposedActions": [{"description": "정리", "command": "rm x",
                             "target": "db2", "riskLevel": "MEDIUM"}],
        "confidence": 0.8,
    }
    class FakeAgent:
        def run_investigation(self, context, ssh_target):
            return fake
    monkeypatch.setattr(nemesis_service, "get_agent", lambda: FakeAgent())
    r = client.post("/ai/investigate", headers=AUTH, json={
        "context": {"hostname": "db2", "triggerReason": "PROCESS_DOWN: oracle"},
        "sshTarget": {"host": "10.0.0.12", "port": 22, "user": "root"},
    })
    assert r.status_code == 200
    body = r.json()
    assert body["confidence"] == 0.8
    assert body["proposedActions"][0]["riskLevel"] == "MEDIUM"
```

- [ ] **Step 6: `run_investigation` + 엔드포인트 구현**

`langgraph_agent.py`의 `LangGraphAgent` 클래스에 메서드 추가(파일 끝, 클래스 내부):
```python
    def run_investigation(self, context: dict, ssh_target: dict) -> dict:
        """읽기전용 도구만 바인딩해 1회 조사하고, 구조화 조치안 JSON을 반환한다."""
        import json as _json
        from nemesis_ops_tools import READ_TOOLS, set_ssh_context
        set_ssh_context(ssh_target.get("host"), ssh_target.get("port", 22),
                        ssh_target.get("user"))
        llm = self.llm_base.bind_tools(READ_TOOLS)
        graph = self._build_graph(READ_TOOLS, llm, self.llm_base)
        sys = (
            "당신은 Nemesis HA의 장애 조사관입니다. 읽기 도구로만 원인을 조사하고, "
            "절대 변경을 시도하지 마십시오. 조사가 끝나면 마지막 메시지에 아래 JSON만 출력하십시오:\n"
            '{"diagnosis":"...","rootCause":"...","proposedActions":'
            '[{"description":"...","command":"...","target":"<hostname>","riskLevel":"LOW|MEDIUM|HIGH"}],'
            '"confidence":0.0~1.0}'
        )
        msg = "장애 컨텍스트: " + _json.dumps(context, ensure_ascii=False)
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
        state = {"messages": [HumanMessage(content=msg)], "user_id": 0, "chat_id": 0,
                 "system_prompt": sys, "turn_count": 0, "reflexion_notes": [], "error_logs": []}
        import asyncio as _asyncio
        final = _asyncio.run(graph.ainvoke(state, config={"recursion_limit": 40}))
        text = ""
        for m in reversed(final["messages"]):
            if isinstance(m, AIMessage) and m.content:
                text = m.content if isinstance(m.content, str) else str(m.content)
                break
        return self._parse_plan(text, context)

    @staticmethod
    def _parse_plan(text: str, context: dict) -> dict:
        import json as _json, re
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                d = _json.loads(m.group(0))
                d.setdefault("proposedActions", [])
                d.setdefault("confidence", 0.5)
                return d
            except Exception:
                pass
        return {"diagnosis": text[:1000], "rootCause": "", "proposedActions": [],
                "confidence": 0.0}
```

`nemesis_service.py`에 엔드포인트 추가:
```python
@app.post("/ai/investigate")
def investigate(body: dict, _: bool = Depends(require_token)):
    context = body.get("context") or {}
    ssh_target = body.get("sshTarget") or {}
    return get_agent().run_investigation(context, ssh_target)
```

- [ ] **Step 7: 통과 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/ -v`
Expected: 모두 통과

- [ ] **Step 8: 커밋**

```bash
cd /root/aibot && git add nemesis_ops_tools.py langgraph_agent.py nemesis_service.py tests/
git commit -m "feat(nemesis): 읽기전용 조사 도구 + /ai/investigate (구조화 조치안)"
```

---

### Task 4: `/ai/execute` — 승인된 명령만 실행 + 검증

**Files:**
- Modify: `/root/aibot/nemesis_service.py`
- Test: `/root/aibot/tests/test_nemesis_service.py`

**Interfaces:**
- Consumes: `nemesis_ops_tools.remote_exec` (Task 3).
- Produces: `POST /ai/execute {proposalId, actions:[{command,target}], sshTarget}` → `{"status":"SUCCEEDED|FAILED","steps":[{command,exitCode,output}],"verification":str}`.

- [ ] **Step 1: 실패 테스트**

```python
def test_execute_runs_only_given_commands(monkeypatch):
    ran = []
    import nemesis_ops_tools as ops
    monkeypatch.setattr(ops, "remote_exec",
                        lambda h, p, u, c, **k: ran.append(c) or {"exitCode": 0, "output": "ok"})
    r = client.post("/ai/execute", headers=AUTH, json={
        "proposalId": "p1",
        "actions": [{"command": "systemctl restart oracle", "target": "db2"}],
        "sshTarget": {"host": "10.0.0.12", "port": 22, "user": "root"},
    })
    assert r.status_code == 200
    assert r.json()["status"] == "SUCCEEDED"
    assert ran == ["systemctl restart oracle"]   # 보여준 명령 그대로, 그것만

def test_execute_fails_on_nonzero(monkeypatch):
    import nemesis_ops_tools as ops
    monkeypatch.setattr(ops, "remote_exec",
                        lambda h, p, u, c, **k: {"exitCode": 1, "output": "boom"})
    r = client.post("/ai/execute", headers=AUTH, json={
        "proposalId": "p1",
        "actions": [{"command": "bad", "target": "db2"}],
        "sshTarget": {"host": "10.0.0.12", "port": 22, "user": "root"},
    })
    assert r.json()["status"] == "FAILED"
```

- [ ] **Step 2: 실패 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/test_nemesis_service.py::test_execute_runs_only_given_commands -v`
Expected: FAIL (404/501)

- [ ] **Step 3: 구현**

`nemesis_service.py`에 추가:
```python
@app.post("/ai/execute")
def execute(body: dict, _: bool = Depends(require_token)):
    import nemesis_ops_tools as ops
    t = body.get("sshTarget") or {}
    host, port, user = t.get("host"), t.get("port", 22), t.get("user", "root")
    steps, ok = [], True
    for a in (body.get("actions") or []):
        cmd = a.get("command", "")
        res = ops.remote_exec(host, port, user, cmd)
        steps.append({"command": cmd, "exitCode": res["exitCode"], "output": res["output"]})
        if res["exitCode"] != 0:
            ok = False
            break   # 실패 시 중단(자동 파괴적 재시도 금지)
    return {
        "status": "SUCCEEDED" if ok else "FAILED",
        "steps": steps,
        "verification": "모든 단계 종료코드 0" if ok else "단계 실패로 중단",
    }
```

- [ ] **Step 4: 통과 확인**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/ -v`
Expected: 모두 통과

- [ ] **Step 5: systemd 유닛 + 커밋**

`/root/aibot/nemesis-aibot.service`:
```ini
[Unit]
Description=Nemesis aibot sidecar service
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/aibot
EnvironmentFile=/root/aibot/.env
ExecStart=/root/aibot/venv/bin/uvicorn nemesis_service:app --host 127.0.0.1 --port 18900
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
```bash
cd /root/aibot && git add nemesis_service.py tests/ nemesis-aibot.service
git commit -m "feat(nemesis): /ai/execute(승인된 명령 한정 실행) + systemd 유닛"
```

---

## Phase 2 — Nemesis 백엔드 (Java)

### Task 5: Flyway V11 + AiProposal 엔티티 + 리포지토리

**Files:**
- Create: `backend/src/main/resources/db/migration/V11__ai_proposals.sql`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/AiProposal.java`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/AiProposalRepository.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiProposalRepositoryTest.java`

**Interfaces:**
- Produces:
  - `AiProposal` (Lombok `@Builder`): 필드 `id(UUID)`, `clusterId(UUID)`, `nodeId(UUID)`, `triggerType(String)`, `triggerReason(String)`, `diagnosis(String)`, `rootCause(String)`, `confidence(double)`, `proposedActions(String=JSON)`, `status(String)`, `executionLog(String)`, `decidedBy(String)`, `decidedAt(OffsetDateTime)`, `createdAt`, `expiresAt`.
  - 상태 상수: `PENDING/APPROVED/EXECUTING/SUCCEEDED/FAILED/REJECTED/EXPIRED`.
  - `AiProposalRepository.findByStatusOrderByCreatedAtDesc(String)`, `countByStatus(String)`, `findByStatusAndExpiresAtBefore(String, OffsetDateTime)`.

- [ ] **Step 1: 마이그레이션 작성**

`V11__ai_proposals.sql`:
```sql
CREATE TABLE ai_proposals (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID,
    node_id          UUID,
    trigger_type     VARCHAR(20) NOT NULL,
    trigger_reason   TEXT,
    diagnosis        TEXT,
    root_cause       TEXT,
    confidence       DOUBLE PRECISION DEFAULT 0,
    proposed_actions TEXT,                 -- JSON 배열 문자열
    status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    execution_log    TEXT,
    decided_by       VARCHAR(100),
    decided_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ
);
CREATE INDEX idx_ai_proposals_status ON ai_proposals(status);
```

- [ ] **Step 2: 엔티티 실패 테스트**

`AiProposalRepositoryTest.java`:
```java
package com.nemesis.domain.aiops;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("test")
class AiProposalRepositoryTest {

    @Autowired AiProposalRepository repo;

    @Test
    void saves_and_finds_pending() {
        repo.save(AiProposal.builder()
                .id(UUID.randomUUID()).triggerType("DETECTION")
                .status(AiProposal.PENDING).confidence(0.7)
                .proposedActions("[]").build());
        assertThat(repo.countByStatus(AiProposal.PENDING)).isEqualTo(1);
        assertThat(repo.findByStatusOrderByCreatedAtDesc(AiProposal.PENDING)).hasSize(1);
    }
}
```

- [ ] **Step 3: 엔티티 + 리포지토리 구현**

`AiProposal.java`:
```java
package com.nemesis.domain.aiops;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** SP1: AI 운영자(aibot)가 제안한 조치 + 승인/실행 상태. */
@Entity
@Table(name = "ai_proposals")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiProposal {

    public static final String PENDING = "PENDING", APPROVED = "APPROVED",
            EXECUTING = "EXECUTING", SUCCEEDED = "SUCCEEDED", FAILED = "FAILED",
            REJECTED = "REJECTED", EXPIRED = "EXPIRED";

    @Id private UUID id;

    @Column(name = "cluster_group_id") private UUID clusterId;
    @Column(name = "node_id")          private UUID nodeId;

    @Column(name = "trigger_type", nullable = false, length = 20) private String triggerType;
    @Column(name = "trigger_reason", columnDefinition = "TEXT")   private String triggerReason;

    @Column(columnDefinition = "TEXT") private String diagnosis;
    @Column(name = "root_cause", columnDefinition = "TEXT") private String rootCause;
    private double confidence;

    /** JSON 배열 문자열: [{description,command,target,riskLevel}] */
    @Column(name = "proposed_actions", columnDefinition = "TEXT") private String proposedActions;

    @Column(nullable = false, length = 20) private String status;

    @Column(name = "execution_log", columnDefinition = "TEXT") private String executionLog;
    @Column(name = "decided_by", length = 100) private String decidedBy;
    @Column(name = "decided_at") private OffsetDateTime decidedAt;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;
    @Column(name = "expires_at") private OffsetDateTime expiresAt;

    @PrePersist void prePersist() {
        if (createdAt == null) createdAt = OffsetDateTime.now();
        if (status == null) status = PENDING;
    }
}
```

`AiProposalRepository.java`:
```java
package com.nemesis.domain.aiops;

import org.springframework.data.jpa.repository.JpaRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface AiProposalRepository extends JpaRepository<AiProposal, UUID> {
    List<AiProposal> findByStatusOrderByCreatedAtDesc(String status);
    List<AiProposal> findTop50ByOrderByCreatedAtDesc();
    long countByStatus(String status);
    List<AiProposal> findByStatusAndExpiresAtBefore(String status, OffsetDateTime t);
}
```

- [ ] **Step 4: 통과 확인 (Docker)**

Run:
```bash
cd /var/www/html/Nemesis_v100/backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 \
  gradle test --tests "com.nemesis.domain.aiops.AiProposalRepositoryTest"
```
Expected: BUILD SUCCESSFUL, 1 test passed

- [ ] **Step 5: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add backend/src/main/resources/db/migration/V11__ai_proposals.sql \
        backend/src/main/java/com/nemesis/domain/aiops/AiProposal.java \
        backend/src/main/java/com/nemesis/domain/aiops/AiProposalRepository.java \
        backend/src/test/java/com/nemesis/domain/aiops/AiProposalRepositoryTest.java
git commit -m "feat(aiops): AiProposal 엔티티 + V11 마이그레이션 + 리포지토리"
```

---

### Task 6: AiOperatorProperties + AiOperatorClient

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorProperties.java`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorClient.java`
- Create: `backend/src/main/java/com/nemesis/domain/aiops/dto/AiOpsDtos.java`
- Modify: `backend/src/main/resources/application.yml`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientTest.java`

**Interfaces:**
- Produces:
  - `AiOperatorProperties` (prefix `nemesis.aiops`): `enabled(boolean=false)`, `baseUrl(String)`, `token(String)`, `sshUser(String="root")`, `timeoutSeconds(int=120)`, `proposalTtlMinutes(int=30)`.
  - DTO records: `InvestigateResponse(String diagnosis, String rootCause, List<Action> proposedActions, double confidence)`, `Action(String description, String command, String target, String riskLevel)`, `ExecuteResponse(String status, List<Map<String,Object>> steps, String verification)`.
  - `AiOperatorClient.health() -> boolean`, `investigate(Map<String,Object> ctx, Map<String,Object> sshTarget) -> InvestigateResponse|null`, `execute(UUID proposalId, List<Action> actions, Map<String,Object> sshTarget) -> ExecuteResponse|null`. 실패 시 null(폴백 신호).

- [ ] **Step 1: DTO 작성**

`dto/AiOpsDtos.java`:
```java
package com.nemesis.domain.aiops.dto;

import java.util.List;
import java.util.Map;

public class AiOpsDtos {
    public record Action(String description, String command, String target, String riskLevel) {}
    public record InvestigateResponse(String diagnosis, String rootCause,
                                      List<Action> proposedActions, double confidence) {}
    public record ExecuteResponse(String status, List<Map<String, Object>> steps, String verification) {}
}
```

- [ ] **Step 2: 클라이언트 실패 테스트 (MockRestServiceServer)**

`AiOperatorClientTest.java`:
```java
package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class AiOperatorClientTest {

    private AiOperatorProperties props() {
        AiOperatorProperties p = new AiOperatorProperties();
        p.setBaseUrl("http://localhost:18900");
        p.setToken("t"); p.setTimeoutSeconds(5);
        return p;
    }

    @Test
    void investigate_parses_plan() {
        RestTemplate rt = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.createServer(rt);
        server.expect(requestTo("http://localhost:18900/ai/investigate"))
              .andRespond(withSuccess("""
                {"diagnosis":"d","rootCause":"r",
                 "proposedActions":[{"description":"x","command":"c","target":"n","riskLevel":"LOW"}],
                 "confidence":0.9}""", MediaType.APPLICATION_JSON));
        AiOperatorClient client = new AiOperatorClient(rt, props());
        AiOpsDtos.InvestigateResponse resp = client.investigate(Map.of(), Map.of());
        assertThat(resp.confidence()).isEqualTo(0.9);
        assertThat(resp.proposedActions().get(0).command()).isEqualTo("c");
    }

    @Test
    void investigate_returns_null_on_error() {
        RestTemplate rt = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.createServer(rt);
        server.expect(requestTo("http://localhost:18900/ai/investigate"))
              .andRespond(req -> { throw new RuntimeException("aibot down"); });
        AiOperatorClient client = new AiOperatorClient(rt, props());
        assertThat(client.investigate(Map.of(), Map.of())).isNull();   // 폴백 신호
    }
}
```

- [ ] **Step 3: Properties + Client 구현**

`AiOperatorProperties.java`:
```java
package com.nemesis.domain.aiops;

import lombok.Getter; import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** SP1: aibot 사이드카 연동 설정. application.yml nemesis.aiops.* */
@Component
@ConfigurationProperties(prefix = "nemesis.aiops")
@Getter @Setter
public class AiOperatorProperties {
    private boolean enabled = false;
    private String  baseUrl = "http://localhost:18900";
    private String  token = "";
    private String  sshUser = "root";
    private int     timeoutSeconds = 120;
    private int     proposalTtlMinutes = 30;
}
```

`AiOperatorClient.java`:
```java
package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** aibot 사이드카 호출. 실패는 null 반환(상위에서 폴백). */
@Slf4j
@Component
public class AiOperatorClient {

    private final RestTemplate rt;
    private final AiOperatorProperties props;

    public AiOperatorClient(RestTemplate restTemplate, AiOperatorProperties props) {
        this.rt = restTemplate; this.props = props;
    }

    private HttpHeaders headers() {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.setBearerAuth(props.getToken());
        return h;
    }

    public boolean health() {
        try {
            ResponseEntity<Map> r = rt.getForEntity(props.getBaseUrl() + "/health", Map.class);
            return r.getStatusCode().is2xxSuccessful();
        } catch (Exception e) { return false; }
    }

    public InvestigateResponse investigate(Map<String, Object> ctx, Map<String, Object> sshTarget) {
        try {
            HttpEntity<Map<String, Object>> req =
                    new HttpEntity<>(Map.of("context", ctx, "sshTarget", sshTarget), headers());
            return rt.postForObject(props.getBaseUrl() + "/ai/investigate", req, InvestigateResponse.class);
        } catch (Exception e) {
            log.warn("aibot investigate 실패(폴백): {}", e.getMessage());
            return null;
        }
    }

    public ExecuteResponse execute(UUID proposalId, List<Action> actions, Map<String, Object> sshTarget) {
        try {
            HttpEntity<Map<String, Object>> req = new HttpEntity<>(Map.of(
                    "proposalId", proposalId.toString(), "actions", actions, "sshTarget", sshTarget), headers());
            return rt.postForObject(props.getBaseUrl() + "/ai/execute", req, ExecuteResponse.class);
        } catch (Exception e) {
            log.warn("aibot execute 실패: {}", e.getMessage());
            return null;
        }
    }
}
```

- [ ] **Step 4: application.yml 설정 + RestTemplate Bean 확인**

`application.yml`의 `nemesis:` 블록에 추가(예: `llm:` 위/아래):
```yaml
  aiops:
    enabled: ${NEMESIS_AIOPS_ENABLED:false}
    base-url: ${NEMESIS_AIBOT_URL:http://localhost:18900}
    token: ${NEMESIS_AIBOT_TOKEN:}
    ssh-user: ${NEMESIS_AIOPS_SSH_USER:root}
    timeout-seconds: ${NEMESIS_AIOPS_TIMEOUT:120}
    proposal-ttl-minutes: ${NEMESIS_AIOPS_TTL:30}
```
`RestTemplate` Bean이 이미 있는지 확인:
```bash
grep -rn "RestTemplate" backend/src/main/java/com/nemesis/config/ backend/src/main/java/com/nemesis/*Config*.java
```
없으면 `config/AppConfig.java`(없으면 생성)에 추가:
```java
@org.springframework.context.annotation.Bean
org.springframework.web.client.RestTemplate restTemplate() {
    var f = new org.springframework.http.client.SimpleClientHttpRequestFactory();
    f.setConnectTimeout(5000); f.setReadTimeout(125000);
    return new org.springframework.web.client.RestTemplate(f);
}
```
(이미 `AgentCommandClient`가 RestTemplate을 주입받으므로 Bean이 존재할 가능성 높음 — 중복 정의 금지.)

- [ ] **Step 5: 통과 확인 (Docker)**

Run:
```bash
cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 \
  gradle test --tests "com.nemesis.domain.aiops.AiOperatorClientTest"
```
Expected: 2 tests passed

- [ ] **Step 6: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add backend/src/main/java/com/nemesis/domain/aiops/ backend/src/main/resources/application.yml \
        backend/src/test/java/com/nemesis/domain/aiops/AiOperatorClientTest.java
git commit -m "feat(aiops): AiOperatorClient + Properties + DTO (폴백 null)"
```

---

### Task 7: AiOperatorService (조율)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/AiOperatorService.java`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiOperatorServiceTest.java`

**Interfaces:**
- Consumes: `AiProposalRepository`, `AiOperatorClient`, `AiOperatorProperties`, `NodeRepository`, `ObjectMapper`.
- Produces:
  - `onFault(UUID clusterId, UUID nodeId, String triggerType, String reason)` → investigate 호출, 조치안 있으면 `AiProposal` PENDING 저장 후 반환(없거나 aibot 불통 시 null).
  - `approve(UUID proposalId, String user) -> AiProposal` → EXECUTING→execute→SUCCEEDED/FAILED.
  - `reject(UUID proposalId, String user) -> AiProposal`.
  - `expireStale()` (스케줄러).

- [ ] **Step 1: 실패 테스트**

`AiOperatorServiceTest.java`:
```java
package com.nemesis.domain.aiops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiOperatorServiceTest {

    AiProposalRepository repo;
    AiOperatorClient client;
    NodeRepository nodeRepo;
    AiOperatorService svc;

    @BeforeEach
    void setup() {
        repo = mock(AiProposalRepository.class);
        client = mock(AiOperatorClient.class);
        nodeRepo = mock(NodeRepository.class);
        AiOperatorProperties props = new AiOperatorProperties();
        props.setEnabled(true);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        svc = new AiOperatorService(repo, client, props, nodeRepo, new ObjectMapper());
    }

    @Test
    void onFault_creates_pending_proposal_when_aibot_proposes() {
        Node n = new Node(); n.setHostname("db2"); n.setServiceIp("10.0.0.12");
        when(nodeRepo.findById(any())).thenReturn(Optional.of(n));
        when(client.investigate(any(), any())).thenReturn(new InvestigateResponse(
                "d", "r", List.of(new Action("x", "c", "db2", "LOW")), 0.8));

        AiProposal p = svc.onFault(UUID.randomUUID(), UUID.randomUUID(), "DETECTION", "reason");

        assertThat(p).isNotNull();
        assertThat(p.getStatus()).isEqualTo(AiProposal.PENDING);
        assertThat(p.getProposedActions()).contains("\"command\":\"c\"");
    }

    @Test
    void onFault_returns_null_when_aibot_down() {        // 폴백: HA 경로 불변
        when(nodeRepo.findById(any())).thenReturn(Optional.of(new Node()));
        when(client.investigate(any(), any())).thenReturn(null);
        assertThat(svc.onFault(UUID.randomUUID(), UUID.randomUUID(), "DETECTION", "r")).isNull();
        verify(repo, never()).save(any());
    }

    @Test
    void approve_executes_and_marks_succeeded() {
        UUID id = UUID.randomUUID();
        AiProposal p = AiProposal.builder().id(id).status(AiProposal.PENDING)
                .nodeId(UUID.randomUUID())
                .proposedActions("[{\"description\":\"x\",\"command\":\"c\",\"target\":\"db2\",\"riskLevel\":\"LOW\"}]")
                .build();
        when(repo.findById(id)).thenReturn(Optional.of(p));
        Node n = new Node(); n.setServiceIp("10.0.0.12");
        when(nodeRepo.findById(any())).thenReturn(Optional.of(n));
        when(client.execute(any(), any(), any()))
                .thenReturn(new ExecuteResponse("SUCCEEDED", List.of(), "ok"));

        AiProposal out = svc.approve(id, "admin");
        assertThat(out.getStatus()).isEqualTo(AiProposal.SUCCEEDED);
        assertThat(out.getDecidedBy()).isEqualTo("admin");
    }

    @Test
    void reject_marks_rejected_without_execute() {
        UUID id = UUID.randomUUID();
        when(repo.findById(id)).thenReturn(Optional.of(
                AiProposal.builder().id(id).status(AiProposal.PENDING).build()));
        AiProposal out = svc.reject(id, "op1");
        assertThat(out.getStatus()).isEqualTo(AiProposal.REJECTED);
        verify(client, never()).execute(any(), any(), any());
    }
}
```

- [ ] **Step 2: 실패 확인 (Docker)**

Run:
```bash
cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 \
  gradle test --tests "com.nemesis.domain.aiops.AiOperatorServiceTest"
```
Expected: 컴파일 실패(AiOperatorService 없음)

- [ ] **Step 3: 구현**

`AiOperatorService.java`:
```java
package com.nemesis.domain.aiops;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

/** SP1: 감지→조사→제안→승인→실행 조율. aibot 불통 시 제안 생략(HA 무영향). */
@Slf4j
@Service
public class AiOperatorService {

    private final AiProposalRepository repo;
    private final AiOperatorClient client;
    private final AiOperatorProperties props;
    private final NodeRepository nodeRepo;
    private final ObjectMapper mapper;

    public AiOperatorService(AiProposalRepository repo, AiOperatorClient client,
                             AiOperatorProperties props, NodeRepository nodeRepo, ObjectMapper mapper) {
        this.repo = repo; this.client = client; this.props = props;
        this.nodeRepo = nodeRepo; this.mapper = mapper;
    }

    @Transactional
    public AiProposal onFault(UUID clusterId, UUID nodeId, String triggerType, String reason) {
        if (!props.isEnabled()) return null;
        Node node = nodeRepo.findById(nodeId).orElse(null);
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("hostname", node != null ? node.getHostname() : "?");
        ctx.put("role", node != null && node.getRole() != null ? node.getRole().name() : "?");
        ctx.put("triggerType", triggerType);
        ctx.put("triggerReason", reason);

        InvestigateResponse r = client.investigate(ctx, sshTarget(node));
        if (r == null) { log.info("aibot 조사 불가 → 제안 생략"); return null; }   // 폴백

        AiProposal p = AiProposal.builder()
                .id(UUID.randomUUID()).clusterId(clusterId).nodeId(nodeId)
                .triggerType(triggerType).triggerReason(reason)
                .diagnosis(r.diagnosis()).rootCause(r.rootCause()).confidence(r.confidence())
                .proposedActions(toJson(r.proposedActions()))
                .status(AiProposal.PENDING)
                .expiresAt(OffsetDateTime.now().plusMinutes(props.getProposalTtlMinutes()))
                .build();
        return repo.save(p);
    }

    @Transactional
    public AiProposal approve(UUID proposalId, String user) {
        AiProposal p = repo.findById(proposalId)
                .orElseThrow(() -> new IllegalArgumentException("제안 없음: " + proposalId));
        if (!AiProposal.PENDING.equals(p.getStatus()))
            throw new IllegalStateException("PENDING 아님: " + p.getStatus());   // 이중 승인 방지
        p.setStatus(AiProposal.EXECUTING);
        p.setDecidedBy(user); p.setDecidedAt(OffsetDateTime.now());
        repo.save(p);

        List<Action> actions = fromJson(p.getProposedActions());
        Node node = p.getNodeId() != null ? nodeRepo.findById(p.getNodeId()).orElse(null) : null;
        ExecuteResponse res = client.execute(proposalId, actions, sshTarget(node));
        if (res == null) {
            p.setStatus(AiProposal.FAILED); p.setExecutionLog("aibot 실행 불가(서비스 불통)");
        } else {
            p.setStatus("SUCCEEDED".equals(res.status()) ? AiProposal.SUCCEEDED : AiProposal.FAILED);
            p.setExecutionLog(toJsonSafe(res));
        }
        return repo.save(p);
    }

    @Transactional
    public AiProposal reject(UUID proposalId, String user) {
        AiProposal p = repo.findById(proposalId)
                .orElseThrow(() -> new IllegalArgumentException("제안 없음: " + proposalId));
        p.setStatus(AiProposal.REJECTED);
        p.setDecidedBy(user); p.setDecidedAt(OffsetDateTime.now());
        return repo.save(p);
    }

    @Transactional
    public void expireStale() {
        OffsetDateTime now = OffsetDateTime.now();
        for (AiProposal p : repo.findByStatusAndExpiresAtBefore(AiProposal.PENDING, now)) {
            p.setStatus(AiProposal.EXPIRED);
            repo.save(p);
        }
    }

    private Map<String, Object> sshTarget(Node node) {
        Map<String, Object> t = new HashMap<>();
        t.put("host", node != null ? node.getServiceIp() : null);
        t.put("port", 22);
        t.put("user", props.getSshUser());
        return t;
    }

    private String toJson(List<Action> actions) {
        try { return mapper.writeValueAsString(actions); }
        catch (Exception e) { return "[]"; }
    }
    private String toJsonSafe(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return String.valueOf(o); }
    }
    private List<Action> fromJson(String json) {
        try { return mapper.readValue(json == null ? "[]" : json, new TypeReference<List<Action>>() {}); }
        catch (Exception e) { return List.of(); }
    }
}
```

- [ ] **Step 4: 통과 확인 (Docker)**

Run:
```bash
cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 \
  gradle test --tests "com.nemesis.domain.aiops.AiOperatorServiceTest"
```
Expected: 4 tests passed

- [ ] **Step 5: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add backend/src/main/java/com/nemesis/domain/aiops/AiOperatorService.java \
        backend/src/test/java/com/nemesis/domain/aiops/AiOperatorServiceTest.java
git commit -m "feat(aiops): AiOperatorService(조사→제안→승인→실행, 폴백)"
```

---

### Task 8: AiProposalController + RBAC

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/aiops/AiProposalController.java`
- Modify: `backend/src/main/java/com/nemesis/security/RbacFilter.java:54-61`
- Test: `backend/src/test/java/com/nemesis/domain/aiops/AiProposalControllerRbacTest.java`

**Interfaces:**
- Produces:
  - `GET /api/ai/proposals?status=PENDING` → `List<ProposalDto>`
  - `GET /api/ai/proposals/{id}` → `ProposalDto`
  - `POST /api/ai/proposals/{id}/approve` → `ProposalDto` (operator+)
  - `POST /api/ai/proposals/{id}/reject` → `ProposalDto` (operator+)
  - `GET /api/ai/notifications` → `{pending:long, recent:List<ProposalDto>}`
- 사용자명은 `Authorization` 토큰에서 `TokenService.verify(...)`로 추출(컨트롤러 내).

- [ ] **Step 1: RBAC 경로 추가**

`RbacFilter.java`의 `requirement(...)`에 (failover 라인들 근처) 추가:
```java
        if (path.matches("/api/ai/proposals/[^/]+/(approve|reject)")) return Need.OPERATOR;
```

- [ ] **Step 2: RBAC 실패 테스트**

`AiProposalControllerRbacTest.java`:
```java
package com.nemesis.domain.aiops;

import com.nemesis.security.TokenService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AiProposalControllerRbacTest {

    @LocalServerPort int port;
    @Autowired TestRestTemplate http;
    @Autowired TokenService tokenService;

    private HttpEntity<Void> as(String username, com.nemesis.domain.user.User.Role role) {
        String token = tokenService.issue(new TokenService.Principal(UUID.randomUUID(), username, role));
        HttpHeaders h = new HttpHeaders(); h.setBearerAuth(token);
        return new HttpEntity<>(h);
    }

    @Test
    void viewer_cannot_approve() {
        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/ai/proposals/" + UUID.randomUUID() + "/approve",
                HttpMethod.POST, as("v", com.nemesis.domain.user.User.Role.viewer), String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void list_is_open_to_authenticated_read() {
        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/ai/proposals?status=PENDING",
                HttpMethod.GET, as("v", com.nemesis.domain.user.User.Role.viewer), String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```
> 주의: `TokenService.issue`/`Principal` 시그니처가 다르면 `TokenService.java`를 열어 실제 발급 메서드에 맞춘다(테스트만 조정, 프로덕션 영향 없음).

- [ ] **Step 3: 컨트롤러 구현**

`AiProposalController.java`:
```java
package com.nemesis.domain.aiops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.security.TokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/ai/proposals")
@RequiredArgsConstructor
public class AiProposalController {

    private final AiProposalRepository repo;
    private final AiOperatorService service;
    private final TokenService tokenService;
    private final ObjectMapper mapper;

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @RequestParam(required = false) String status) {
        List<AiProposal> ps = (status == null || status.isBlank())
                ? repo.findTop50ByOrderByCreatedAtDesc()
                : repo.findByStatusOrderByCreatedAtDesc(status);
        return ResponseEntity.ok(ps.stream().map(this::dto).toList());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable UUID id) {
        return repo.findById(id).map(p -> ResponseEntity.ok(dto(p)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<Map<String, Object>> approve(
            @PathVariable UUID id, @RequestHeader("Authorization") String auth) {
        return ResponseEntity.ok(dto(service.approve(id, user(auth))));
    }

    @PostMapping("/{id}/reject")
    public ResponseEntity<Map<String, Object>> reject(
            @PathVariable UUID id, @RequestHeader("Authorization") String auth) {
        return ResponseEntity.ok(dto(service.reject(id, user(auth))));
    }

    private String user(String auth) {
        try { return tokenService.verify(auth.substring(7)).map(TokenService.Principal::username).orElse("?"); }
        catch (Exception e) { return "?"; }
    }

    private Map<String, Object> dto(AiProposal p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId()); m.put("clusterId", p.getClusterId());
        m.put("nodeId", p.getNodeId()); m.put("triggerType", p.getTriggerType());
        m.put("triggerReason", p.getTriggerReason()); m.put("diagnosis", p.getDiagnosis());
        m.put("rootCause", p.getRootCause()); m.put("confidence", p.getConfidence());
        m.put("status", p.getStatus()); m.put("decidedBy", p.getDecidedBy());
        m.put("createdAt", p.getCreatedAt());
        try { m.put("proposedActions", mapper.readValue(
                p.getProposedActions() == null ? "[]" : p.getProposedActions(), List.class)); }
        catch (Exception e) { m.put("proposedActions", List.of()); }
        return m;
    }
}
```

별도 알림 컨트롤러는 같은 패키지에 `AiNotificationController.java`로 분리:
```java
package com.nemesis.domain.aiops;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/ai/notifications")
@RequiredArgsConstructor
public class AiNotificationController {
    private final AiProposalRepository repo;

    @GetMapping
    public Map<String, Object> feed() {
        return Map.of(
            "pending", repo.countByStatus(AiProposal.PENDING),
            "recent", repo.findTop50ByOrderByCreatedAtDesc().stream().limit(10)
                .map(p -> Map.of("id", p.getId(), "status", p.getStatus(),
                        "triggerReason", p.getTriggerReason() == null ? "" : p.getTriggerReason(),
                        "createdAt", p.getCreatedAt())).toList());
    }
}
```

- [ ] **Step 4: 통과 확인 (Docker)**

Run:
```bash
cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 \
  gradle test --tests "com.nemesis.domain.aiops.AiProposalControllerRbacTest"
```
Expected: 2 tests passed (필요 시 Step 2 주의대로 TokenService 시그니처 조정)

- [ ] **Step 5: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add backend/src/main/java/com/nemesis/domain/aiops/AiProposalController.java \
        backend/src/main/java/com/nemesis/domain/aiops/AiNotificationController.java \
        backend/src/main/java/com/nemesis/security/RbacFilter.java \
        backend/src/test/java/com/nemesis/domain/aiops/AiProposalControllerRbacTest.java
git commit -m "feat(aiops): 제안 조회/승인/거부 컨트롤러 + 알림 피드 + RBAC"
```

---

### Task 9: 감지 연결 + AiChatController 프록시

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/failover/FailoverTriggerListener.java`
- Modify: `backend/src/main/java/com/nemesis/domain/ai/AiChatController.java`
- Test: `backend/src/test/java/com/nemesis/domain/failover/FailoverTriggerListenerTest.java` (있으면 확장, 없으면 생성)

**Interfaces:**
- Consumes: `AiOperatorService.onFault(...)` (Task 7), `AiOperatorClient`/`AiOperatorProperties` (Task 6).
- Produces: 감지 페일오버 후 비동기 ROOT_CAUSE 조사 제안. AiChat은 aibot `/ai/chat` 우선, 불통 시 LlmService 폴백.

- [ ] **Step 1: FailoverTriggerListener에 조사 호출 추가**

`FailoverTriggerListener.java`를 수정 — 필드 주입에 `AiOperatorService aiOperatorService` 추가, `onNodeFault` 끝(페일오버 결과 로그 뒤)에 추가:
```java
            // 페일오버는 자동 수행됨. 근본원인 조사는 비동기로 제안 생성(승인 필요).
            try {
                aiOperatorService.onFault(ev.clusterId(), ev.nodeId(), "ROOT_CAUSE",
                        "페일오버 후 근본원인 조사: " + ev.reason());
            } catch (Exception ex) {
                log.warn("AI 조사 제안 생성 실패(무시): {}", ex.getMessage());
            }
```
(생성자는 `@RequiredArgsConstructor`이므로 `private final AiOperatorService aiOperatorService;` 필드만 추가.)

- [ ] **Step 2: AiChatController 프록시 실패 테스트**

`backend/src/test/java/com/nemesis/domain/ai/AiChatControllerTest.java`:
```java
package com.nemesis.domain.ai;

import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.aiops.AiOperatorClient;
import org.junit.jupiter.api.Test;

import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiChatControllerTest {

    @Test
    void uses_aibot_when_available() {
        AiOperatorClient aibot = mock(AiOperatorClient.class);
        LlmService llm = mock(LlmService.class);
        when(aibot.health()).thenReturn(true);
        when(aibot.chat("상태?")).thenReturn("aibot 응답");
        AiChatController c = new AiChatController(llm, aibot);
        var resp = c.chat(Map.of("message", "상태?"));
        assertThat(resp.getBody().get("reply")).isEqualTo("aibot 응답");
        verifyNoInteractions(llm);
    }

    @Test
    void falls_back_to_llm_when_aibot_down() throws Exception {
        AiOperatorClient aibot = mock(AiOperatorClient.class);
        LlmService llm = mock(LlmService.class);
        when(aibot.health()).thenReturn(false);
        when(llm.isAvailable()).thenReturn(true);
        when(llm.chat(anyString(), eq("상태?"))).thenReturn("llm 응답");
        AiChatController c = new AiChatController(llm, aibot);
        var resp = c.chat(Map.of("message", "상태?"));
        assertThat(resp.getBody().get("reply")).isEqualTo("llm 응답");
    }
}
```

- [ ] **Step 3: AiOperatorClient.chat 추가 + AiChatController 수정**

`AiOperatorClient.java`에 메서드 추가:
```java
    public String chat(String message) {
        try {
            HttpEntity<Map<String, Object>> req =
                    new HttpEntity<>(Map.of("message", message), headers());
            Map<?, ?> r = rt.postForObject(props.getBaseUrl() + "/ai/chat", req, Map.class);
            return r != null ? String.valueOf(r.get("reply")) : null;
        } catch (Exception e) {
            log.warn("aibot chat 실패(폴백): {}", e.getMessage());
            return null;
        }
    }
```

`AiChatController.java` 전체 교체:
```java
package com.nemesis.domain.ai;

import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.aiops.AiOperatorClient;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiChatController {

    private final LlmService llmService;
    private final AiOperatorClient aibot;

    private static final String CHAT_SYSTEM =
            "당신은 Nemesis HA 시스템의 AI 어시스턴트입니다. " +
            "AIX/Linux 엔터프라이즈 인프라·고가용성·장애 분석 전문가로서 한국어로 간결하게 답하세요.";

    @PostMapping("/chat")
    public ResponseEntity<Map<String, String>> chat(@RequestBody Map<String, String> req) {
        String message = req.getOrDefault("message", "").trim();
        if (message.isEmpty())
            return ResponseEntity.badRequest().body(Map.of("error", "message가 비어 있습니다."));

        // 1순위: aibot(에이전트 루프). 불통이면 LLM 단발 폴백.
        if (aibot.health()) {
            String reply = aibot.chat(message);
            if (reply != null) return ResponseEntity.ok(Map.of("reply", reply));
        }
        if (!llmService.isAvailable())
            return ResponseEntity.ok(Map.of("reply",
                    "AI가 연결되지 않았습니다. aibot 서비스 또는 LLM_PROVIDER 설정을 확인하세요."));
        try {
            return ResponseEntity.ok(Map.of("reply", llmService.chat(CHAT_SYSTEM, message)));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("reply", "AI 응답 실패: " + e.getMessage()));
        }
    }
}
```

- [ ] **Step 4: 통과 확인 (Docker)**

Run:
```bash
cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 \
  gradle test --tests "com.nemesis.domain.ai.AiChatControllerTest" \
              --tests "com.nemesis.failover.FailoverOrchestratorTest"
```
Expected: 통과(기존 페일오버 테스트 회귀 없음)

- [ ] **Step 5: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add backend/src/main/java/com/nemesis/domain/failover/FailoverTriggerListener.java \
        backend/src/main/java/com/nemesis/domain/ai/AiChatController.java \
        backend/src/main/java/com/nemesis/domain/aiops/AiOperatorClient.java \
        backend/src/test/java/com/nemesis/domain/ai/AiChatControllerTest.java
git commit -m "feat(aiops): 감지→AI 조사 제안 연결 + AiChat aibot 프록시(LLM 폴백)"
```

---

## Phase 3 — 프론트엔드 (React)

### Task 10: API 클라이언트 확장

**Files:**
- Modify: `frontend/src/api/client.js:98-104`

**Interfaces:**
- Produces: `getAiProposals(status?)`, `getAiProposal(id)`, `approveAiProposal(id)`, `rejectAiProposal(id)`, `getAiNotifications()`. (`aiChat` 유지.)

- [ ] **Step 1: API 추가**

`client.js`의 `// AI 채팅` 블록 아래에 추가:
```javascript
// AI 운영자(AIOps) 제안/알림
export const getAiProposals     = (status)  => client.get('/ai/proposals', { params: status ? { status } : {} })
export const getAiProposal      = (id)      => client.get(`/ai/proposals/${id}`)
export const approveAiProposal  = (id)      => client.post(`/ai/proposals/${id}/approve`)
export const rejectAiProposal   = (id)      => client.post(`/ai/proposals/${id}/reject`)
export const getAiNotifications = ()        => client.get('/ai/notifications')
```

- [ ] **Step 2: 빌드 확인**

Run: `cd frontend && npm run build`
Expected: built 성공

- [ ] **Step 3: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add frontend/src/api/client.js
git commit -m "feat(aiops): 프론트 제안/알림 API 클라이언트"
```

---

### Task 11: AiPanel 제안 카드 + 승인/거부

**Files:**
- Modify: `frontend/src/components/dashboard/AiPanel.jsx`

**Interfaces:**
- Consumes: `getAiProposals`, `approveAiProposal`, `rejectAiProposal` (Task 10), `useAuth().isOperator`.
- Produces: 패널 하단에 PENDING 제안 카드 목록(진단·명령·riskLevel·confidence + [승인][거부], operator만 활성). 10초 폴링.

- [ ] **Step 1: import + 상태/폴링 추가**

`AiPanel.jsx` 상단 import 교체/추가:
```javascript
import { aiChat, getAiProposals, approveAiProposal, rejectAiProposal } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
```
컴포넌트 함수 본문 상단(`const navigate ...` 아래)에 추가:
```javascript
  const { isOperator } = useAuth()
  const [proposals, setProposals] = useState([])

  useEffect(() => {
    let alive = true
    const load = () => getAiProposals('PENDING')
      .then(r => { if (alive) setProposals(r.data) }).catch(() => {})
    load()
    const id = setInterval(load, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  async function decide(id, approve) {
    try {
      await (approve ? approveAiProposal(id) : rejectAiProposal(id))
      setHistory(h => [...h, { role: 'ai', text: `제안 ${approve ? '승인' : '거부'} 처리됨 (${id.slice(0,8)})` }])
    } catch (e) {
      setHistory(h => [...h, { role: 'ai', text: '처리 실패: ' + (e.response?.data?.error ?? e.message) }])
    } finally {
      getAiProposals('PENDING').then(r => setProposals(r.data)).catch(() => {})
    }
  }
```

- [ ] **Step 2: 제안 카드 렌더 추가**

`AiPanel.jsx`의 입력창 `<div className="relative">` **바로 위**에 삽입:
```jsx
      {proposals.length > 0 && (
        <div className="mb-3 space-y-2">
          {proposals.map(p => (
            <div key={p.id} className="rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-amber-400">⚠️ AI 조치 제안</span>
                <span className="text-gray-500">신뢰도 {Math.round((p.confidence ?? 0) * 100)}%</span>
              </div>
              <p className="text-gray-300 mb-1">{p.diagnosis}</p>
              {(p.proposedActions ?? []).map((a, i) => (
                <div key={i} className="text-gray-400">
                  • {a.description} <code className="text-blue-300">{a.command}</code>
                  <span className="ml-1 text-[10px] text-amber-300">[{a.riskLevel}]</span>
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <button disabled={!isOperator} onClick={() => decide(p.id, true)}
                  title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
                  className="px-3 py-1 rounded bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed">승인</button>
                <button disabled={!isOperator} onClick={() => decide(p.id, false)}
                  title={isOperator ? '' : 'operator 이상 권한이 필요합니다'}
                  className="px-3 py-1 rounded bg-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed">거부</button>
              </div>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd frontend && npm run build`
Expected: built 성공

- [ ] **Step 4: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add frontend/src/components/dashboard/AiPanel.jsx
git commit -m "feat(aiops): 대시보드 AI 패널 제안 카드 + 승인/거부(operator 게이트)"
```

---

### Task 12: 헤더 알림 벨 실데이터 연결

**Files:**
- Modify: `frontend/src/components/Navbar.jsx:69-74` (벨 블록)

**Interfaces:**
- Consumes: `getAiNotifications` (Task 10).
- Produces: 벨 배지 = PENDING 카운트(0이면 숨김), 클릭 시 최근 알림 드롭다운.

- [ ] **Step 1: import + 상태/폴링**

`Navbar.jsx` 상단에 추가:
```javascript
import { getAiNotifications } from '../api/client'
```
컴포넌트 본문 `const [now, setNow] = useState('')` 아래에 추가:
```javascript
  const [notif, setNotif] = useState({ pending: 0, recent: [] })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => getAiNotifications()
      .then(r => { if (alive) setNotif(r.data) }).catch(() => {})
    load()
    const id = setInterval(load, 10000)
    return () => { alive = false; clearInterval(id) }
  }, [])
```

- [ ] **Step 2: 벨 블록 교체**

기존 벨 `<div className="relative"> ... </div>`(Bell + 하드코딩 "3" 배지)를 교체:
```jsx
          <div className="relative">
            <button onClick={() => setOpen(o => !o)} className="relative p-1" aria-label="알림">
              <Bell className="w-5 h-5 text-gray-400" />
              {notif.pending > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                  {notif.pending}
                </span>
              )}
            </button>
            {open && (
              <div className="absolute right-0 mt-2 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 p-2 text-xs">
                <p className="text-gray-400 px-2 py-1">AI 알림 (대기 {notif.pending})</p>
                {notif.recent.length === 0 && <p className="text-gray-600 px-2 py-2">알림 없음</p>}
                {notif.recent.map(n => (
                  <div key={n.id} className="px-2 py-1.5 border-t border-gray-800 text-gray-300">
                    <span className="text-amber-400">[{n.status}]</span> {n.triggerReason}
                  </div>
                ))}
              </div>
            )}
          </div>
```

- [ ] **Step 3: 빌드 확인**

Run: `cd frontend && npm run build`
Expected: built 성공

- [ ] **Step 4: 커밋**

```bash
cd /var/www/html/Nemesis_v100
git add frontend/src/components/Navbar.jsx
git commit -m "feat(aiops): 헤더 알림 벨 실데이터(PENDING 카운트+드롭다운)"
```

---

## Phase 4 — 통합 검증 ("다 만들면 작동하는지 테스트")

### Task 13: 전체 빌드 + 단위 테스트 일괄

**Files:** (없음 — 검증 전용)

- [ ] **Step 1: aibot 전체 pytest**

Run: `cd /root/aibot && ./venv/bin/python -m pytest tests/ -v`
Expected: 전부 통과

- [ ] **Step 2: 백엔드 전체 테스트 (Docker)**

Run:
```bash
cd /var/www/html/Nemesis_v100/backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test
```
Expected: BUILD SUCCESSFUL, 회귀 0 (기존 + 신규 aiops 테스트 통과)

- [ ] **Step 3: 프론트 빌드**

Run: `cd /var/www/html/Nemesis_v100/frontend && npm run build`
Expected: built 성공

- [ ] **Step 4: 커밋(있으면)**

빌드 산출물 변경이 없으면 생략. 있으면:
```bash
cd /var/www/html/Nemesis_v100 && git add -A && git commit -m "chore(aiops): SP1 전체 빌드/테스트 그린"
```

---

### Task 14: end-to-end 스모크 (감지→제안→승인→실행→보고)

**Files:** (없음 — 런타임 검증)

**전제:** Docker compose 스택(백엔드+PostgreSQL+프론트) 기동, aibot 서비스 기동. `.env`에
`NEMESIS_AIOPS_ENABLED=true`, 양쪽 `NEMESIS_AIBOT_TOKEN` 동일. (실 노드 SSH가 없으면
`/ai/execute`는 mock 노드 대상으로 검증하거나 실패 경로(FAILED 보고)까지 확인.)

- [ ] **Step 1: aibot 서비스 기동 + 헬스**

Run:
```bash
cd /root/aibot && set -a && . ./.env && set +a
./venv/bin/uvicorn nemesis_service:app --host 127.0.0.1 --port 18900 &
sleep 3
curl -s -H "Authorization: Bearer $NEMESIS_AIBOT_TOKEN" http://127.0.0.1:18900/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 2: 백엔드 헬스에서 aibot 인식 확인 (chat 왕복)**

Run:
```bash
# 로그인 토큰 발급
TOKEN=$(curl -s -X POST http://localhost:18080/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST http://localhost:18080/api/ai/chat -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"message":"클러스터 상태 요약해줘"}'
```
Expected: `{"reply":"..."}` (aibot 경유 응답; aibot 끄면 LLM 폴백 응답)

- [ ] **Step 3: 조사 제안 생성 트리거 (수동 onFault 경로)**

장애를 직접 모의하기 어려우면 investigate를 직접 호출해 제안이 적재되는지 확인:
```bash
curl -s -H "Authorization: Bearer $NEMESIS_AIBOT_TOKEN" -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:18900/ai/investigate \
  -d '{"context":{"hostname":"db2","triggerReason":"PROCESS_DOWN: oracle"},
       "sshTarget":{"host":"127.0.0.1","port":22,"user":"root"}}'
```
실 장애 흐름은: 노드 에이전트를 멈춰 staleness→`NODE_FAULT`→자동 페일오버 후
`onFault("ROOT_CAUSE")`로 제안 적재. 그 후:
```bash
curl -s http://localhost:18080/api/ai/proposals?status=PENDING -H "Authorization: Bearer $TOKEN"
```
Expected: PENDING 제안 1건 이상(JSON 배열).

- [ ] **Step 4: 브라우저 e2e (대시보드 패널 + 헤더 벨)**

`/_gstack-command` 또는 browse 스킬로:
1. admin 로그인 → 대시보드 진입.
2. 헤더 벨 배지에 PENDING 카운트 표시, 클릭 시 드롭다운 알림.
3. AI 패널 하단 제안 카드 노출 → **[승인]** 클릭 → 상태가 SUCCEEDED/FAILED로 전이, 채팅에 결과 보고.
4. viewer 계정 로그인 → 승인/거부 버튼 비활성(툴팁 확인).

Expected: 위 4개 모두 관찰됨. (스크린샷 보관.)

- [ ] **Step 5: 결과 기록 + 커밋**

검증 결과를 `Nemesis_HA_Gap_Analysis_and_Plan.md` §7 진행현황에 1줄 추가(예: "SP1 AIOps:
감지→조사→제안→승인→실행→보고 e2e 통과(2026-06-..)"). 커밋:
```bash
cd /var/www/html/Nemesis_v100
git add Nemesis_HA_Gap_Analysis_and_Plan.md
git commit -m "docs: SP1 AIOps e2e 검증 결과 기록"
```

---

## Self-Review (작성자 점검 결과)

**Spec coverage:**
- §3.1 aibot 서비스(`/investigate`·`/execute`·`/chat`·`/health`) → Task 1~4 ✅
- §3.1 읽기전용 강제 → Task 3(READ_TOOLS, `run_investigation`) ✅
- §3.1 SSH 키 인증/sshTarget → Global Constraints + Task 3/7 ✅
- §3.2 AiProposal/Repository/Client/Service/Controller/Notification → Task 5~8 ✅
- §3.2 감지 연결(SELF_HEAL/ROOT_CAUSE) + AiChat 프록시 → Task 9 ✅
- §3.3 AiPanel 제안 카드, 헤더 벨, API → Task 10~12 ✅
- §4 데이터 흐름/상태머신 → AiOperatorService(approve/reject/expire), 페일오버 자동 유지(Task 9) ✅
- §6 폴백/만료/멱등/감사 → AiOperatorClient null 폴백, `expireStale`, PENDING 검증, `decidedBy` ✅
- §7 테스트(Java 단위·aibot pytest·e2e) → Task 5~9 단위 + Task 13~14 ✅
- 사용자 Goal "다 만들면 작동하는지 테스트" → Task 13(빌드/단위) + Task 14(e2e 스모크) ✅

**Placeholder scan:** 모든 코드 스텝에 실제 코드/명령/기대출력 기재. "TBD/적절히 처리" 없음. ✅

**Type consistency:** `InvestigateResponse`/`Action`/`ExecuteResponse` record 시그니처가 Client↔Service↔Test 전반 일치. `AiOperatorService(repo, client, props, nodeRepo, mapper)` 생성자 순서가 테스트(Task7 Step1)와 구현(Step3) 일치. `onFault(clusterId,nodeId,triggerType,reason)` 시그니처 Task7↔Task9 일치. 제안 상태 상수 명칭 일관(`AiProposal.PENDING` 등). ✅

**알려진 조정 포인트(구현 중 확인):**
- `TokenService.issue`/`Principal`/`verify` 실제 시그니처 → Task 8 Step2 주의대로 테스트만 맞춤.
- `RestTemplate` Bean 기존 존재 여부 → Task 6 Step4(중복 정의 금지).
- `User.Role` enum 값(`viewer` 등) 실제 명칭 확인 후 테스트 반영.
