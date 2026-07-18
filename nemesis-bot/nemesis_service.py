"""
nemesis_service.py — Nemesis ↔ aibot 사이드카 FastAPI 서비스.
127.0.0.1:18900 에 바인드, 공유 Bearer 토큰으로 인증.
엔드포인트: /health, /ai/chat, /ai/investigate, /ai/execute
"""
import os
import json
import time
import asyncio
import logging
import urllib.request
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


_agent = None

# ── 백엔드 LLM 설정 동기화(옵션 B) ─────────────────────────────────────────
# Nemesis 백엔드의 시스템 설정(/api/settings/system)에서 provider/모델을 읽어
# aibot 에이전트에 반영한다. 설정창에서 모델을 바꾸면 재기동 없이 적용된다.
# API 키는 백엔드 응답에서 마스킹되므로 aibot .env 의 키를 그대로 사용한다.
NEMESIS_BACKEND_URL = os.getenv("NEMESIS_BACKEND_URL", "http://localhost:18080").rstrip("/")
NEMESIS_AIBOT_TOKEN = os.getenv("NEMESIS_AIBOT_TOKEN", "")
_LLM_FETCH_TTL = 15.0                      # 초. 잦은 요청에서 매번 조회하지 않도록 캐시.
_llm_cache = {"ts": 0.0, "sig": None}


def _fetch_backend_llm():
    """Nemesis 시스템 설정에서 LLM provider/모델을 읽어온다. 실패 시 None(.env 유지).
    aibot 전용 /api/ai/llm-config 를 공유 토큰으로 호출(시크릿 제외 모델/provider만)."""
    try:
        url = f"{NEMESIS_BACKEND_URL}/api/ai/llm-config"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {NEMESIS_AIBOT_TOKEN}"})
        with urllib.request.urlopen(req, timeout=3) as r:
            d = json.loads(r.read().decode("utf-8"))
        return {
            "provider":      (d.get("llmProvider") or "").strip().lower(),
            "ollamaModel":   (d.get("llmOllamaModel") or "").strip(),
            "ollamaBaseUrl": (d.get("llmOllamaBaseUrl") or "").strip(),
            "openaiModel":   (d.get("llmOpenaiModel") or "").strip(),
            "geminiModel":   (d.get("llmGeminiModel") or "").strip(),
        }
    except Exception as e:
        logger.warning("백엔드 LLM 설정 조회 실패(.env 유지): %s", e)
        return None


def _apply_backend_llm(s):
    """백엔드 설정을 aibot 모듈 전역에 주입한다. 반영 시그니처 반환(미지원/무변경 시 None)."""
    import config
    import aibot as aibot_mod
    import langgraph_agent as lga

    provider = s["provider"]
    # 백엔드 provider(ollama|openai|anthropic|gemini) → aibot 매핑.
    # anthropic 은 langgraph 에이전트 미지원 → 경고 후 기존(.env) provider 유지.
    # gemini 는 langgraph 에이전트 지원(langchain_google_genai + 사이드카 .env 의 GEMINI_API_KEY 필요).
    if provider not in ("ollama", "openai", "gemini"):
        if provider:
            logger.warning("aibot 에이전트 미지원 provider '%s' → .env 설정 유지", provider)
        return None

    overrides = {"AI_PROVIDER": provider}
    if provider == "ollama":
        if s["ollamaModel"]:   overrides["OLLAMA_MODEL"] = s["ollamaModel"]
        if s["ollamaBaseUrl"]: overrides["OLLAMA_BASE_URL"] = s["ollamaBaseUrl"]
    elif provider == "openai":
        if s["openaiModel"]:   overrides["OPENAI_MODEL"] = s["openaiModel"]
    elif provider == "gemini":
        # 사이드카 investigate 에이전트의 gemini 경로는 langchain_google_genai 가 필요하다.
        # 미설치면 provider 전환을 건너뛰어(기존 provider 유지) investigate 회귀를 막는다.
        # (백엔드 LlmService 의 gemini 경로 — /ai/analysis·HA 판단 — 는 이 패키지 없이도 동작한다.)
        import importlib.util
        if importlib.util.find_spec("langchain_google_genai") is None:
            logger.warning("gemini 선택됨이나 사이드카에 langchain_google_genai 미설치 → "
                           "investigate 는 기존 provider 유지(백엔드 분석 경로는 gemini 사용). "
                           "사이드카 gemini 활성화: pip install langchain-google-genai + .env GEMINI_API_KEY")
            return None
        if s.get("geminiModel"): overrides["GEMINI_MODEL"] = s["geminiModel"]

    # langgraph_agent/aibot 은 import 시점에 config 값을 복사하므로 각 모듈에 직접 주입한다.
    for mod in (config, aibot_mod, lga):
        for k, v in overrides.items():
            setattr(mod, k, v)
    return json.dumps(overrides, sort_keys=True)


def _sync_backend_llm():
    """TTL 내 캐시. 설정이 바뀌면 _agent 를 무효화해 다음 빌드에서 새 모델을 반영."""
    global _agent
    now = time.time()
    if now - _llm_cache["ts"] < _LLM_FETCH_TTL:
        return
    _llm_cache["ts"] = now
    s = _fetch_backend_llm()
    if s is None:
        return
    sig = _apply_backend_llm(s)
    if sig is not None and sig != _llm_cache["sig"]:
        logger.info("LLM 설정 변경 감지 → 에이전트 재구성: %s", sig)
        _llm_cache["sig"] = sig
        _agent = None


def get_agent():
    """기존 bot.py 와 동일하게 LangGraphAgent 를 1회 구성(텔레그램 제외)."""
    global _agent
    _sync_backend_llm()        # 백엔드 설정 반영(변경 시 _agent 무효화)
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
    # 요청자(operator) 토큰을 운영 도구(페일오버 등)가 그대로 사용하도록 컨텍스트에 설정.
    import nemesis_ops_tools as ops
    ops.set_nemesis_auth(body.get("userToken"))
    try:
        agent = get_agent()
        reply = asyncio.run(agent.run(message, user_id=0, chat_id=0))
    finally:
        ops.set_nemesis_auth(None)   # 요청 종료 시 토큰 잔류 방지
    return {"reply": reply, "proposalId": None}


@app.post("/ai/investigate")
def investigate(body: dict, _: bool = Depends(require_token)):
    context = body.get("context") or {}
    ssh_target = body.get("sshTarget") or {}
    # 지식베이스 상시 주입 on/off (기본 on). 평가 하네스가 OFF 모드로 대조 측정한다.
    knowledge_enabled = bool(body.get("knowledge", True))
    return get_agent().run_investigation(context, ssh_target, knowledge_enabled)


@app.get("/ai/knowledge/files")
def knowledge_list(_: bool = Depends(require_token)):
    """지식 파일 목록(편집 UI 용). aix/oracle·README 포함, 각 파일 유효성/주입여부 포함."""
    import knowledge_base as kb
    return {"files": kb.list_files(),
            "knowledgeDir": kb.knowledge_dir(),
            "injectedDomains": list(kb.DEFAULT_DOMAINS)}


@app.get("/ai/knowledge/file")
def knowledge_read(path: str, _: bool = Depends(require_token)):
    import knowledge_base as kb
    try:
        return {"path": path, "content": kb.read_file(path)}
    except kb.KnowledgeIOError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/ai/knowledge/validate")
def knowledge_validate(body: dict, _: bool = Depends(require_token)):
    import knowledge_base as kb
    ok, err = kb.validate_content(body.get("content", ""))
    return {"valid": ok, "error": err}


@app.post("/ai/knowledge/file")
def knowledge_save(body: dict, _: bool = Depends(require_token)):
    """지식 파일 저장(생성/수정). 경로 형식·경로탈출·YAML 검증 통과 시에만 기록."""
    import knowledge_base as kb
    path = (body.get("path") or "").strip()
    content = body.get("content", "")
    try:
        kb.save_file(path, content)
        return {"status": "saved", "path": path}
    except kb.KnowledgeIOError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/ai/knowledge/file")
def knowledge_delete(path: str, _: bool = Depends(require_token)):
    import knowledge_base as kb
    try:
        kb.delete_file(path)
        return {"status": "deleted", "path": path}
    except kb.KnowledgeIOError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/ai/scan")
def scan(body: dict, _: bool = Depends(require_token)):
    """SP3 능동 모니터링: 의심 신호별로 읽기전용 조사 후 finding 목록 반환.
    severity HIGH/CRITICAL 만 조치안(proposedActions) 포함."""
    context = body.get("context") or {}
    ssh_target = body.get("sshTarget") or {}
    suspects = context.get("suspectSignals") or []
    agent = get_agent()
    findings = []
    for sig in suspects:
        sig_type = sig.get("signalType", "OTHER")
        sev = sig.get("severity") or "HIGH"
        inv = agent.run_investigation({**context, "focusSignal": sig_type}, ssh_target) or {}
        f = {
            "signalType": sig_type,
            "severity": sev,
            "summary": (inv.get("diagnosis") or "")[:200],
            "diagnosis": inv.get("diagnosis", ""),
            "rootCause": inv.get("rootCause", ""),
            "confidence": inv.get("confidence", 0.0),
        }
        if sev in ("HIGH", "CRITICAL"):
            f["proposedActions"] = inv.get("proposedActions", [])
        findings.append(f)
    return {"findings": findings}


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
