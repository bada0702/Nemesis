"""
run_investigation 의 지식 주입 배선 통합 테스트 (T1).

LLM/SSH 없이, 그래프 ainvoke 로 넘어가는 system_prompt 를 가로채 지식이 실제로
시스템 프롬프트에 붙는지(그리고 OFF 시 안 붙는지)를 검증한다. run_investigation 이
self 에서 쓰는 것은 llm_base.bind_tools / _build_graph / _parse_plan 뿐이므로
경량 스텁으로 언바운드 호출한다.
"""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from langgraph_agent import LangGraphAgent  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402


class _CaptureGraph:
    """ainvoke 로 들어온 state 의 system_prompt 를 기록하고 캔드 응답을 돌려준다."""
    def __init__(self, sink):
        self.sink = sink

    async def ainvoke(self, state, config=None):
        self.sink["system_prompt"] = state["system_prompt"]
        return {"messages": [AIMessage(
            content='{"diagnosis":"테스트","rootCause":"","confidence":0.3}')]}


class _StubAgent:
    """run_investigation 이 참조하는 최소 표면만 구현."""
    def __init__(self, sink):
        self._sink = sink
        self.llm_base = types.SimpleNamespace(bind_tools=lambda tools: None)

    def _build_graph(self, tools, llm, llm_base):
        return _CaptureGraph(self._sink)

    _parse_plan = staticmethod(LangGraphAgent._parse_plan)


def _run(knowledge_enabled):
    sink = {}
    agent = _StubAgent(sink)
    plan = LangGraphAgent.run_investigation(
        agent,
        {"faultType": "process_down", "hostname": "bot-01"},
        {"host": "127.0.0.1", "port": 22, "user": "root"},
        knowledge_enabled=knowledge_enabled,
    )
    return sink["system_prompt"], plan


def test_knowledge_injected_when_enabled(monkeypatch):
    monkeypatch.delenv("NEMESIS_KNOWLEDGE_DISABLED", raising=False)
    prompt, plan = _run(knowledge_enabled=True)
    assert "장애 조사관" in prompt                 # 기존 프롬프트 유지
    assert "장애 대응 지식베이스" in prompt          # 지식 헤더 주입됨
    assert "process_down" in prompt                 # 실제 지식 내용 주입됨
    assert plan["diagnosis"] == "테스트"


def test_knowledge_not_injected_when_request_disabled(monkeypatch):
    monkeypatch.delenv("NEMESIS_KNOWLEDGE_DISABLED", raising=False)
    prompt, _ = _run(knowledge_enabled=False)
    assert "장애 조사관" in prompt                  # 기존 프롬프트는 그대로
    assert "장애 대응 지식베이스" not in prompt       # 지식은 미주입


def test_knowledge_not_injected_when_env_disabled(monkeypatch):
    monkeypatch.setenv("NEMESIS_KNOWLEDGE_DISABLED", "1")
    prompt, _ = _run(knowledge_enabled=True)         # 요청은 on 이어도
    assert "장애 대응 지식베이스" not in prompt        # env 가 전역 비활성
