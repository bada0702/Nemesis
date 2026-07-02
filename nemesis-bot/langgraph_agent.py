"""
langgraph_agent.py
Simple ReAct-style LangGraph Agent (Hermes-style pipeline).
Flow: agent → tools → agent → ... → END
"""

import asyncio
import logging
import json
from datetime import datetime
from typing import Annotated, List
import operator

from langchain_openai import ChatOpenAI
from langchain_core.messages import (
    HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage
)
from langgraph.graph import StateGraph, END
from typing import TypedDict

from config import (
    AI_PROVIDER,
    OLLAMA_BASE_URL, OLLAMA_MODEL,
    OPENROUTER_BASE_URL, OPENROUTER_MODEL,
    GEMINI_MODEL, OPENAI_MODEL,
    get_ollama_api_key, get_openrouter_api_key,
    get_gemini_api_key, get_openai_api_key,
    AGENT_MAX_TURNS,
    CHAT_HISTORY_DIR, BASE_DIR
)
from langgraph_tools import ALL_TOOLS, init_tools
from langgraph_tools_distribution import (
    get_specialist_tools, classify_intent,
    SPECIALIST_SYSTEM_PROMPTS,
)

logger = logging.getLogger(__name__)


def _is_error_content(content: str) -> bool:
    """True only for genuine tool *failures* / denials.

    Tools in this codebase mark failure with a leading ❌ (success=✅, warning=⚠️),
    and the guarded-tools node wraps every exception/denial as ❌ too. We key off
    that marker rather than scanning for words like 'error'/'failed', which appear
    legitimately in *successful* output — e.g. a security report listing 'Failed
    password' lines. That substring match used to misclassify a successful audit
    as a failure, driving an endless reflexion ERROR_LOOP."""
    return str(content).lstrip().startswith("❌")


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]
    user_id: int
    chat_id: int
    system_prompt: str
    turn_count: int
    reflexion_notes: Annotated[list[str], operator.add]  # 성찰 메모 누적
    error_logs: Annotated[list[str], operator.add]    # 오류 로그 및 원인 분석 기록


class LangGraphAgent:

    def __init__(self, skills_manager, memory_manager=None,
                 cron_scheduler=None, reminder_manager=None, calendar_skill=None,
                 skill_generator=None, tool_manager=None):
        self.skills = skills_manager
        self.memory_manager = memory_manager
        self.cron_scheduler = cron_scheduler
        self.reminder_manager = reminder_manager
        self.calendar_skill = calendar_skill
        self.skill_generator = skill_generator
        self.tool_manager = tool_manager

        init_tools(
            skills_manager=skills_manager,
            cron_scheduler=cron_scheduler,
            reminder_manager=reminder_manager,
            calendar_skill=calendar_skill,
            skill_generator=skill_generator,
            tool_manager=tool_manager,
        )

        if AI_PROVIDER == "openrouter":
            api_key = get_openrouter_api_key()
            base_llm = ChatOpenAI(
                model=OPENROUTER_MODEL,
                base_url=OPENROUTER_BASE_URL,
                api_key=api_key,
                temperature=0.3,
                max_tokens=4096,
                default_headers={"HTTP-Referer": "https://github.com/aibot", "X-Title": "AIBot"}
            )
        elif AI_PROVIDER == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI
            api_key = get_gemini_api_key()
            base_llm = ChatGoogleGenerativeAI(
                model=GEMINI_MODEL,
                api_key=api_key,
                temperature=0.0,
                max_tokens=4096,
            )
        elif AI_PROVIDER == "openai":
            api_key = get_openai_api_key()
            base_llm = ChatOpenAI(
                model=OPENAI_MODEL,
                api_key=api_key,
                temperature=0.3,
                max_tokens=4096,
            )
        else:
            api_key = get_ollama_api_key() or "ollama"
            base_llm = ChatOpenAI(
                model=OLLAMA_MODEL,
                base_url=f"{OLLAMA_BASE_URL}/v1",
                api_key=api_key,
                temperature=0.7,
                max_tokens=4096,
            )

        self.llm_base = base_llm
        self.llm = base_llm.bind_tools(ALL_TOOLS)
        self._histories: dict[int, list[BaseMessage]] = {}
        self._graph = self._build_graph(ALL_TOOLS, self.llm, base_llm)

        # ── 전문 에이전트 초기화 (도구 등록 완료 후) ──
        self._specialist_graphs: dict[str, object] = {}
        self._init_specialists(base_llm)

    # ── 컨텍스트 압축 (Hermes: trigger by count or total length) ──────────
    COMPRESS_THRESHOLD = 24   # 메시지 수가 이 이상이면 압축
    COMPRESS_LENGTH_THRESHOLD = 150000 # 총 글자 수가 이 이상이면 압축
    COMPRESS_PROTECT_LAST = 8 # 최근 N개는 압축하지 않고 보존
    COMPRESS_SUMMARIZER_MAX = 100000 # 요약기에 보내는 텍스트 최대 길이 (Safety Truncation)

    def _compress_messages(self, messages: list[BaseMessage]) -> list[BaseMessage]:
        total_len = sum(len(str(m.content)) for m in messages)
        if len(messages) <= self.COMPRESS_THRESHOLD and total_len <= self.COMPRESS_LENGTH_THRESHOLD:
            return messages

        to_compress = messages[:-self.COMPRESS_PROTECT_LAST]
        keep_end = messages[-self.COMPRESS_PROTECT_LAST:]

        lines = []
        for m in to_compress:
            tag = type(m).__name__
            content = str(m.content)
            # ToolMessage 등 매우 긴 결과는 요약 효율을 위해 일차적으로 컷오프
            if len(content) > 2000:
                content = content[:2000] + "...[truncated]"
            lines.append(f"[{tag}]: {content}")

        summary_input = "\n".join(lines)
        # Safety truncation: LLM 호출 자체가 실패하는 것을 방지
        if len(summary_input) > self.COMPRESS_SUMMARIZER_MAX:
            logger.warning(f"Summary input too long ({len(summary_input)} chars), truncating to {self.COMPRESS_SUMMARIZER_MAX}")
            summary_input = summary_input[:self.COMPRESS_SUMMARIZER_MAX]

        try:
            resp = self.llm_base.invoke([
                SystemMessage(content="아래 대화를 핵심 사실·결정·실행결과 위주로 간결하게 요약하라. 중요한 수치·경로·오류메시지는 그대로 보존하라."),
                HumanMessage(content=summary_input),
            ])
            summary = SystemMessage(content=f"[이전 대화 요약]\n{resp.content}")
            logger.info(f"Compressed {len(to_compress)} messages ({total_len} chars) → summary")
            return [summary] + keep_end
        except Exception as e:
            logger.warning(f"Compression failed: {e}")
            return keep_end  # fallback: 최근 메시지만 유지

    # ── 도구 루프 가드레일 (Hermes: same_tool_failure hard_stop=8) ──────
    GUARDRAIL_SAME_TOOL_STOP = 5   # 같은 도구 연속 실패 → 하드스톱
    GUARDRAIL_EXACT_REPEAT_STOP = 3 # 완전히 동일한 호출 반복 → 하드스톱
    GUARDRAIL_SAME_TOOL_TOTAL = 4  # 같은 도구 총 호출 횟수 초과 → 하드스톱

    def _check_tool_call_guardrail(
        self, tool_name: str, args: dict, history: list[BaseMessage]
    ) -> str | None:
        """Decide whether a single tool call should be denied.

        Returns a denial message (containing ❌) if the call should be blocked,
        or None to allow it. `history` already includes the AIMessage whose
        tool_calls are being processed, so the current batch is counted too.
        """
        recent = history[-30:]

        # 1) repeated failures of this tool in the recent window
        fail_count = sum(
            1 for m in recent
            if isinstance(m, ToolMessage)
            and m.name == tool_name
            and _is_error_content(str(m.content))
        )
        if fail_count >= self.GUARDRAIL_SAME_TOOL_STOP:
            return (
                f"❌ [가드레일] '{tool_name}' 도구가 {fail_count}회 실패했습니다. "
                f"같은 방식을 반복하지 말고 다른 접근 방식을 시도하십시오."
            )

        # 2) exact same (name + args) repeated, and 3) total calls of this tool
        sig = json.dumps(
            [tool_name, json.dumps(args, sort_keys=True, ensure_ascii=False)],
            ensure_ascii=False,
        )
        exact_count = 0
        total_count = 0
        for m in recent:
            if isinstance(m, AIMessage) and m.tool_calls:
                for tc in m.tool_calls:
                    if tc.get("name") != tool_name:
                        continue
                    total_count += 1
                    tc_sig = json.dumps(
                        [tc["name"], json.dumps(tc.get("args", {}) or {}, sort_keys=True, ensure_ascii=False)],
                        ensure_ascii=False,
                    )
                    if tc_sig == sig:
                        exact_count += 1

        if exact_count >= self.GUARDRAIL_EXACT_REPEAT_STOP:
            return (
                f"❌ [가드레일] 동일한 도구 호출이 {exact_count}회 반복되어 거부했습니다. "
                f"다른 방법을 시도하거나 지금까지 수집한 정보로 답변하십시오."
            )
        if total_count >= self.GUARDRAIL_SAME_TOOL_TOTAL:
            return (
                f"❌ [가드레일] '{tool_name}' 도구가 {total_count}회 호출되었습니다. "
                f"더 호출하지 말고 지금까지 수집한 정보로 최종 답변을 작성하십시오."
            )
        return None

    def _make_guarded_tools_node(self, tools):
        """Return an async node that runs tool calls one-by-one through the
        guardrail, denying or executing each and always emitting exactly one
        ToolMessage per tool_call_id (keeps OpenAI-compatible APIs happy)."""
        tool_map = {t.name: t for t in tools}

        async def guarded_tools_node(state: AgentState) -> dict:
            last = state["messages"][-1]
            history = state["messages"]
            results: list[ToolMessage] = []
            for tc in last.tool_calls:
                name = tc["name"]
                args = tc.get("args", {}) or {}
                call_id = tc["id"]

                deny = self._check_tool_call_guardrail(name, args, history)
                if deny:
                    logger.warning(f"Guardrail denied tool '{name}': {deny}")
                    results.append(ToolMessage(content=deny, name=name, tool_call_id=call_id))
                    continue

                tool = tool_map.get(name)
                if tool is None:
                    results.append(ToolMessage(
                        content=f"❌ 알 수 없는 도구: {name}", name=name, tool_call_id=call_id))
                    continue
                try:
                    if hasattr(tool, "ainvoke"):
                        output = await tool.ainvoke(args)
                    else:
                        output = tool.invoke(args)
                    results.append(ToolMessage(content=str(output), name=name, tool_call_id=call_id))
                except Exception as e:
                    logger.error(f"Tool '{name}' failed: {e}")
                    results.append(ToolMessage(content=f"❌ 도구 오류: {e}", name=name, tool_call_id=call_id))
            return {"messages": results}

        return guarded_tools_node

    def _route_after_tools(self, state: AgentState) -> str:
        """After tools run, go to error_analysis only if a fresh result/denial
        contains an error; otherwise return straight to the agent."""
        last_ai = next(
            (m for m in reversed(state["messages"])
             if isinstance(m, AIMessage) and m.tool_calls),
            None,
        )
        n = len(last_ai.tool_calls) if last_ai else 1
        recent_tool_msgs = [m for m in state["messages"] if isinstance(m, ToolMessage)][-n:]
        has_error = any(_is_error_content(str(m.content)) for m in recent_tool_msgs)
        return "error_analysis" if has_error else "agent"

    def _should_continue(self, state: AgentState) -> str:
        if state.get("turn_count", 0) >= AGENT_MAX_TURNS:
            logger.warning(f"Max turns ({AGENT_MAX_TURNS}) reached → force final answer.")
            return "force_final_answer"
        last = state["messages"][-1]
        if not (isinstance(last, AIMessage) and last.tool_calls):
            return END
        return "guarded_tools"

    def _make_force_final_answer_node(self, llm_base):
        """At max turns, ask the tool-UNBOUND LLM for a text-only final answer
        so the user never receives an empty / tool-call-only response."""
        def force_final_answer_node(state: AgentState) -> dict:
            system_content = state["system_prompt"] + (
                "\n\n[알림] 더 이상 도구를 사용할 수 없습니다. "
                "지금까지 수집한 정보로 최종 답변만 작성하십시오. 도구를 호출하지 마십시오."
            )
            working = self._compress_messages(state["messages"])
            try:
                response = llm_base.invoke([SystemMessage(content=system_content)] + working)
            except Exception as e:
                logger.error(f"force_final_answer LLM error: {e}")
                response = AIMessage(content="⚠️ 최대 시도 횟수에 도달했지만 최종 답변 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.")
            return {"messages": [response]}
        return force_final_answer_node

    def _init_specialists(self, base_llm):
        """전문 에이전트 그래프를 초기화합니다."""
        try:
            specialist_tools = get_specialist_tools()
            logger.info(f"Specialist tool counts: { {k: len(v) for k, v in specialist_tools.items()} }")
            for name, tools in specialist_tools.items():
                if not tools:
                    logger.warning(f"Specialist '{name}' has no tools, skipping.")
                    continue
                try:
                    llm = base_llm.bind_tools(tools)
                    self._specialist_graphs[name] = self._build_graph(tools, llm, base_llm)
                    logger.info(f"Specialist '{name}' OK: {len(tools)} tools")
                except Exception as e:
                    logger.error(f"Specialist '{name}' build failed: {e}")
            logger.info(f"Loaded specialists: {list(self._specialist_graphs.keys())}")
        except Exception as e:
            logger.error(f"Specialist init failed: {e}", exc_info=True)

    def _build_graph(self, tools, llm, llm_base):
        def call_model(state: AgentState) -> dict:
            messages = state["messages"]
            system_content = state["system_prompt"]

            # RAG context injection on first call (no tool messages yet)
            if self.memory_manager and not any(isinstance(m, ToolMessage) for m in messages):
                try:
                    last_human = next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)
                    if last_human:
                        rag = self.memory_manager.get_rag_context(str(last_human.content), top_k=4)
                        if rag:
                            split = "\n\n현재 시간:"
                            if split in system_content:
                                system_content = rag + system_content[system_content.index(split):]
                except Exception as e:
                    logger.warning(f"RAG failed: {e}")

            working_messages = self._compress_messages(messages)
            full_messages = [SystemMessage(content=system_content)] + working_messages

            try:
                response = llm.invoke(full_messages)
                return {"messages": [response], "turn_count": state.get("turn_count", 0) + 1}
            except Exception as e:
                logger.error(f"LLM error: {e}")
                return {"messages": [AIMessage(content=f"⚠️ LLM 오류: {e}")], "turn_count": state.get("turn_count", 0) + 1}

        def error_analysis_node(state: AgentState) -> dict:
            """오류 분석 노드: ToolMessage에서 에러를 추출하고 원인을 분석하여 기록함."""
            messages = state["messages"]
            recent_results = []
            for m in reversed(messages[-5:]):
                if isinstance(m, ToolMessage):
                    recent_results.append(m)
                elif isinstance(m, AIMessage) and m.tool_calls:
                    break
            
            if not recent_results:
                return {}

            last_content = str(recent_results[0].content)
            has_error = _is_error_content(last_content)

            if has_error:
                error_note = f"[오류 감지] {last_content[:500]}..."
                logger.info(f"ErrorAnalysisNode: Detected error, adding to state.")
                return {"error_logs": [error_note]}
            
            return {}

        def reflexion_node(state: AgentState) -> dict:
            """성찰 노드: 분석된 오류 로그를 바탕으로 구체적인 해결 지침을 하달함.
            (에러가 감지된 경로에서만 도달하므로 '에러 없음' 분기는 제거됨.)"""
            turn_count = state.get("turn_count", 0)
            error_logs = state.get("error_logs", [])

            last_error = error_logs[-1] if error_logs else "(원인 불명 오류)"
            directive = (
                f"⚠️ [루프 엔지니어링 활성화] 다음 오류가 발생했습니다: {last_error}\n"
                f"지금까지의 시도가 실패했음을 인정하십시오. 사과하지 말고, \n"
                f"1. 오류 메시지의 정확한 원인을 분석하고\n"
                f"2. 기존 접근법이 왜 틀렸는지 파악한 뒤\n"
                f"3. 완전히 새로운 대체 수단(다른 도구, 다른 명령어, 파일 재검색 등)을 사용하여 즉시 해결하십시오.\n"
                f"'해볼까요?'라고 묻지 말고 지금 즉시 실행하십시오."
            )
            
            logger.info(f"Reflexion turn={turn_count}: ERROR_LOOP ({len(error_logs)} attempts)")
            return {
                "messages": [HumanMessage(content=f"[성찰: ERROR_LOOP] {directive}")],
                "reflexion_notes": [f"ERROR_LOOP: {len(error_logs)}次 시도 중"],
            }

        guarded_tools_node = self._make_guarded_tools_node(tools)
        force_final_answer_node = self._make_force_final_answer_node(llm_base)

        builder = StateGraph(AgentState)
        builder.add_node("agent", call_model)
        builder.add_node("guarded_tools", guarded_tools_node)
        builder.add_node("error_analysis", error_analysis_node)
        builder.add_node("reflexion", reflexion_node)
        builder.add_node("force_final_answer", force_final_answer_node)

        builder.set_entry_point("agent")
        builder.add_conditional_edges(
            "agent",
            self._should_continue,
            {
                "guarded_tools": "guarded_tools",
                "force_final_answer": "force_final_answer",
                END: END,
            },
        )
        builder.add_conditional_edges(
            "guarded_tools",
            self._route_after_tools,
            {"error_analysis": "error_analysis", "agent": "agent"},
        )
        builder.add_edge("error_analysis", "reflexion")
        builder.add_edge("reflexion", "agent")
        builder.add_edge("force_final_answer", END)

        return builder.compile()

    def _build_system_prompt(self, user_id: int, chat_id: int = 0, message: str = "") -> str:
        now = datetime.now()
        weekdays = ["월", "화", "수", "목", "금", "토", "일"]
        wd = weekdays[now.weekday()]
        now_str = f"{now.strftime('%Y년 %m월 %d일')} ({wd}요일) {now.strftime('%H:%M:%S')}"

        rag_context = ""
        if self.memory_manager:
            try:
                if message:
                    rag_context = self.memory_manager.get_rag_context(message, top_k=4) or ""
                else:
                    rag_context = self.memory_manager.get_memory_context() or ""
            except Exception as e:
                logger.warning(f"Memory load fail: {e}")

        return f"""{rag_context}

현재 시간: {now_str}
**[현재 세션 컨텍스트]** user_id={user_id}, chat_id={chat_id}
→ create_schedule / delete_schedule 호출 시 반드시 user_id={user_id}, chat_id={chat_id} 를 인자로 전달할 것.

---
**[신원]** 당신은 자기진화형 AI 비서입니다. 주인님(사용자)을 보좌하며, 스스로 능력을 확장하고 개선합니다.

**[도구 사용 및 대응 규칙]**
1. **파라미터 확인 (Slot Filling)**: 도구 호출 전, `required` 파라미터가 모두 있는지 확인하십시오. 누락된 정보가 있다면 추측하지 말고 사용자에게 정중히 요청하십시오.
2. **결과 검증 (Empty Set Handling)**: 도구 결과가 비어있거나, "결과 없음", "찾을 수 없음", "Error" 등의 내용을 포함한 경우, 단순히 "없다"고 하지 말고 다음을 수행하십시오:
   - 검색 조건(도시명, 날짜 등)이 정확했는지 확인하고, 필요시 다른 키워드로 재시도하십시오.
   - 도저히 찾을 수 없는 경우, "현재 [조건]으로는 정보를 찾을 수 없습니다. [대안/추천]을 확인해보시겠습니까?"와 같이 구체적이고 도움이 되는 대안을 제시하십시오.
3. 데이터 생성/수정/삭제 → 반드시 해당 도구 실제 호출. 호출 없이 완료 보고 = 거짓말. 금지.
4. 도구 결과(✅/❌) 확인 후 보고. 결과 없이 추측 금지.
5. 도구 오류(❌) → 즉시 그대로 보고. 숨기거나 성공한 척 금지.
6. [자동 스케줄 실행] 태그 → 설명 없이 도구 호출 후 결과만 보고.
7. 프로젝트 작업 추가: list_projects() → add_project_task() 순서 필수.
8. "만들겠습니다", "수정하겠습니다" 같은 약속 = 즉시 도구 호출로 이행. 계획 설명 후 멈추는 것 금지.
9. **"응", "해", "ㅇ", "해봐", "그렇게 해", "수정해" = 직전 대화에서 논의된 작업을 지금 즉시 도구 호출로 실행. 재확인·설명 금지.**
10. **"주인님께서 직접 하셔야", "터미널에서 실행하셔야" 같은 우회는 절대 금지.** 프로그래밍으로 해결 가능한 모든 작업은 비서가 직접 도구로 실행합니다. 방법을 못 찾겠으면 run_shell_command로 시도합니다.

**[자율 문제 해결 및 자가 교정 — 핵심 원칙]**
비서는 "모르겠습니다"를 먼저 말하지 않습니다. 반드시 아래 순서로 스스로 해결을 시도합니다:
① **현황 파악 (Exploration)**: 문제가 발생하면 즉시 관련 도구(`run_shell_command`, `read_file`, `web_search`)를 사용하여 문제의 원인을 정확히 분석하십시오. 추측은 절대 금물입니다.
② **단계적 시도 (Step-by-step)**: 해결책이 복잡하다면 작업을 작은 단계로 나누어 수행하고, 매 단계의 도구 실행 결과를 확인하며 진행하십시오.
③ **자가 교정 (Self-Correction)**:
   - 도구 실행 결과에 오류(`Error`, `Exception`, `Failed`, `❌`)가 포함되어 있다면, 해당 오류 메시지를 즉시 분석하십시오.
   - 메시지를 토대로 실패 원인(권한, 경로, 문법, 라이브러리 미비 등)을 판단하여 즉시 정정 작업을 수행하십시오.
   - 예: "파일이 없으면 -> 검색으로 위치 파악", "패키지가 없으면 -> `install_package` 실행", "구문 오류면 -> `help` 확인"
④ **전략 전환 (Strategy Switch)**:
   - 동일한 도구/명령어 방식이 2회 연속 실패하면, **현재 접근법이 틀렸음을 인정하고 전략을 완전히 바꾸십시오.**
   - 예: `run_shell_command` 실패 시 -> `run_python_code`로 직접 구현, 또는 `create_skill`로 능력 확장.
   - 동일한 작업을 3회 이상 반복(루프)하는 것은 엄격히 금지됩니다.
⑤ **최후 보고**: 위의 모든 단계(탐색, 시도, 교정, 전략 전환)를 다했음에도 해결이 안 될 때만, **지금까지의 시도 과정과 구체적인 실패 사유**를 포함하여 주인님께 보고하십시오.

**[데이터 무결성 및 호칭 원칙]**
- **숫자 데이터(주가, 잔고, 수익률 등)를 절대 추측하거나 이전 기억에 의존하여 보고하지 마십시오.** 반드시 도구 호출 결과값 그대로를 보고해야 합니다.
- **"전하", "소인", "~하옵소서" 등의 사극 말투는 엄격히 금지됩니다.** 이는 과거의 잘못된 패턴입니다.
- 오직 **"주인님"** 호칭과 현대적인 **"정중한 비서 말투"**(~합니다, ~입니다)만 사용하십시오. 
- 과거 대화 내용에 사극 말투가 있더라도 절대 따라하지 말고 현재의 원칙을 우선시하십시오.


**금지 표현 목록** (이 말이 나오면 즉시 취소하고 탐색·실행으로 대체):
- "직접 터미널에서 실행하셔야 합니다"
- "비서가 할 수 없는 작업입니다"
- "수동으로 설정하셔야 합니다"
- "어떤 방법으로 하시겠습니까?" (주인님이 물어보지 않은 경우)
- 방법을 2개 이상 나열하고 주인님께 선택을 넘기는 행위 (확정된 최선의 해결책만 보고)

**[자기진화 (Hermes Mode) — 절대 규칙]**
- "스킬 만들어", "기능 추가해", "~할 수 있게 해줘" → **즉시 `create_skill` 도구 호출**. 설명만 하거나 계획만 말하는 것은 금지.
- 스킬 생성 후 → `execute_registered_skill`로 즉시 테스트 실행.
- 기존 스킬 버그/개선 → `read_skill_code` 로 코드 확인 → `modify_skill`로 수정.
- 정기 점검 → `self_diagnose` 실행.

**[선언적 스킬 아키텍처 — SKILL.md 자가 학습]**
- 스킬 사용 전 제약사항 확인: `skill_read_doc(skill_name)` 호출로 실패 경험 참조.
- 도구 호출 실패 또는 예상치 못한 오류 발생 시: **즉시 `skill_log_failure` 호출**하여 경험 기록. 동일 실수 반복 방지.
- 스킬 생성 후 사용법·제약사항 파악되면: `skill_write_doc`으로 SKILL.md 보강.
- 특정 스킬이 자주 실패하면 SKILL.md를 먼저 읽어 원인 파악 후 접근.
- 스킬 생성 코드 필수 구조:
  ```python
  class XxxSkill:
      def execute_tool(self, tool_name, args): ...
      def get_tool_definitions(self): return [{{"name\":..., \"description\":..., \"parameters\":...}}]
  ```
- 학습/발견 사항 → `memory_append(\"MEMORY.md\", ...)` 즉시 기록.

**[도구 사용 가이드]**
- 날씨 현재: get_weather(location=\"서울\")
- 날씨 예보/주간: get_weather_forecast(location=\"서울\", days=3)
- 시장 개요(코스피/나스닥/환율): get_market_overview()
- 주식 개별: get_stock_price(symbol=\"047810.KS\")
  - 삼성전자=005930.KS, SK하이닉스=000660.KS, NAVER=035420.KS, 코스피=^KS11
- 뉴스: search_news(query=\"IT 뉴스\")
- 검색: web_search(query=\"...\")
- **YouTube 검색**: search_youtube(query=\"아이유 좋은날\")  ← 실제 DuckDuckGo 검색
- **동적 스킬 실행**: execute_registered_skill(skill_name=\"youtube\", tool_name=\"search_youtube\", params='{{\"query\":\"검색어\"}}')
  → create_skill로 만든 스킬을 즉시 실행할 때 사용
- **이미지·파일 생성 후 전송 필수**: 그래프/차트/파일을 생성했으면 반드시 응답 마지막에 `[SEND_FILE: /절대경로/파일명.png]` 마커를 포함시킬 것. 이 마커가 없으면 주인님께 파일이 전달되지 않는다.
  - 그래프는 항상 `/root/aibot/workspace/` 에 저장하고 `[SEND_FILE: /root/aibot/workspace/파일명.png]` 형식으로 전송.
  - "파일을 생성했습니다"라고만 말하고 마커 없이 끝내는 것 = 거짓말과 동일. 금지.
- **외부 경로 파일 접근** (workspace 밖: /var/www/html/, /etc/, /home/ 등):
  - 읽기: run_shell_command(command=\"cat /var/www/html/albert.html\")
  - 쓰기: run_shell_command(command=\"tee /var/www/html/albert.html << 'EOF'\\n[내용]\\nEOF\")
  - ⚠️ read_file/write_file은 workspace 내부 전용. 외부 경로면 무조건 run_shell_command 사용.
- **코딩 에이전트**:
  - run_python_code(code=\"print('hello')\") — Python 즉시 실행
  - save_and_run(filename=\"test.py\", code=\"...\") — 파일 저장 후 실행
  - install_package(package_name=\"requests\") — pip 설치
  - analyze_code(code=\"...\") — 문법 오류 분석
  - list_workspace() — workspace/ 파일 목록
- 스케줄 등록: create_schedule(time_expression=\"오전 7:00\", ai_task=\"서울 날씨 알려줘\")
- 스케줄 목록: list_all_reminders()
- 스케줄 삭제: delete_schedule(schedule_id=\"...\")
- 캘린더: list_calendar_events / add_calendar_event / update_calendar_event / delete_calendar_event
- 프로젝트: list_projects / list_project_tasks / add_project_task / update_project_task / delete_project_task
- 작업일지: get_project_tasks_detail() 먼저 → 실제 데이터만 사용
- 파일: list_files / read_file / write_file / delete_file
- 메모리: memory_read / memory_append / memory_replace / memory_delete_line / memory_list_files
- **스킬 활성화/비활성화**: set_skill_config(skill_name=\"gmail\", enabled=True)
  → .env의 SKILL_GMAIL_ENABLED 값을 직접 수정. \"gmail 활성화해\" 같은 요청에 즉시 사용.
  → 변경 후 봇 재시작 필요: run_shell_command(\"systemctl restart aibot 또는 pm2 restart aibot\")
- 스킬 생성: create_skill(skill_name, description, python_code, libraries)
- 스킬 수정: modify_skill(skill_name, python_code)
- 스킬 목록: list_available_skills()
- 스킬 코드 읽기: read_skill_code(skill_name)
- 자가진단: self_diagnose()
- 시스템: get_system_status() / run_shell_command(command)
- 주식 추천: get_stock_recommendations()
- 날짜: get_current_datetime()

**[응답 스타일 — OpenClaw 방식]**
- 정중한 말투 (비서: \"주인님\", \"~합니다\", \"~입니다\")
- 데이터: 이모지 + 마크다운 표/목록으로 깔끔하게
- 뉴스: 제목 + 요약 + 출처 + 링크
- 날씨: 현재 + 시간대별 + 주간 예보 풍성하게
- 주식: 현재가 + 변동률 + 이모지 방향
- 시장: 국내외 지수 + 환율 + 코멘트
- 모르는 것은 web_search로 검색 후 답변. 절대 지어내지 않음.
"""

    def _load_history(self, user_id: int) -> list[BaseMessage]:
        if user_id in self._histories:
            return self._histories[user_id]

        history_file = CHAT_HISTORY_DIR / f"{user_id}_lg.json"
        if history_file.exists():
            try:
                with open(history_file, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                messages = []
                for item in raw[-8:]:
                    role = item.get("role")
                    content = item.get("content", "")
                    if role == "human":
                        messages.append(HumanMessage(content=content))
                    elif role == "ai":
                        messages.append(AIMessage(content=content))
                self._histories[user_id] = messages
                return messages
            except Exception as e:
                logger.warning(f"History load failed: {e}")

        self._histories[user_id] = []
        return []

    def _save_history(self, user_id: int):
        try:
            CHAT_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
            history_file = CHAT_HISTORY_DIR / f"{user_id}_lg.json"
            messages = self._histories.get(user_id, [])
            raw = []
            for msg in messages[-10:]:
                if isinstance(msg, HumanMessage):
                    raw.append({"role": "human", "content": str(msg.content)})
                elif isinstance(msg, AIMessage):
                    content = str(msg.content)
                    raw.append({"role": "ai", "content": content[:300] + "..." if len(content) > 300 else content})
            with open(history_file, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"History save failed: {e}")

    async def run(self, message: str, user_id: int, chat_id: int, progress_callback=None) -> str:
        logger.info(f"Agent run: user={user_id}, msg='{message[:50]}'")
        history = self._load_history(user_id)
        current_messages = history + [HumanMessage(content=message)]
        system_prompt = self._build_system_prompt(user_id, chat_id, message)

        initial_state: AgentState = {
            "messages": current_messages,
            "user_id": user_id,
            "chat_id": chat_id,
            "system_prompt": system_prompt,
            "turn_count": 0,
            "reflexion_notes": [],
            "error_logs": [],
        }

        try:
            # recursion_limit must comfortably exceed AGENT_MAX_TURNS × super-steps
            # per turn (agent → guarded_tools → error_analysis → reflexion = 4) so the
            # max-turns force_final_answer guarantee is reached before LangGraph aborts.
            config = {"recursion_limit": AGENT_MAX_TURNS * 4 + 10}
            if progress_callback:
                accumulated = dict(initial_state)
                async for chunk in self._graph.astream(initial_state, config=config, stream_mode="updates"):
                    for node_name, node_output in chunk.items():
                        new_msgs = node_output.get("messages", [])
                        if new_msgs:
                            accumulated["messages"] = accumulated["messages"] + new_msgs
                        for k, v in node_output.items():
                            if k != "messages":
                                accumulated[k] = v

                        if node_name == "agent":
                            for msg in new_msgs:
                                if isinstance(msg, AIMessage) and msg.tool_calls:
                                    await progress_callback("calling", [tc["name"] for tc in msg.tool_calls])
                        elif node_name == "guarded_tools":
                            for msg in new_msgs:
                                if isinstance(msg, ToolMessage):
                                    await progress_callback("done", [msg.name])
                final_state = accumulated
            else:
                final_state = await self._graph.ainvoke(initial_state, config=config)

        except Exception as e:
            logger.error(f"Graph execution error: {e}")
            import traceback; traceback.print_exc()
            return f"⚠️ 에이전트 실행 중 오류가 발생했습니다: {e}"

        final_text = ""
        for msg in reversed(final_state["messages"]):
            if isinstance(msg, AIMessage) and msg.content:
                final_text = msg.content if isinstance(msg.content, str) else str(msg.content)
                break

        # 정상 종료 시 마지막 메시지는 항상 텍스트 답변이며(_should_continue가 도구
        # 호출 AIMessage 상태로는 END하지 않고, MAX_TURNS에서는 force_final_answer가
        # 텍스트를 보장한다), 이 분기는 LLM이 빈 응답을 낸 예외적 경우의 방어선이다.
        if not final_text:
            final_text = "죄송합니다, 응답을 생성하지 못했습니다."

        history.append(HumanMessage(content=message))
        history.append(AIMessage(content=final_text))
        self._histories[user_id] = history[-20:]
        self._save_history(user_id)

        if self.memory_manager:
            try:
                self.memory_manager.save_daily_log(message, final_text[:200])
            except Exception:
                logger.warning("save_daily_log 실패(무시하고 계속)", exc_info=True)

        return final_text

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
                logger.warning("조사 계획 JSON 파싱 실패, 폴백 사용", exc_info=True)
        return {"diagnosis": text[:1000], "rootCause": "", "proposedActions": [],
                "confidence": 0.0}
