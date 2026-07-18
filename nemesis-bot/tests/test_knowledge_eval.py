"""
평가 하네스 순수 로직 단위 테스트 (T4).
채점(score)·집계(aggregate)·테이블(render_table)·시나리오 로딩만 검증한다.
네트워크(사이드카 호출)는 대상 아님.

실행: cd nemesis-bot && python -m pytest tests/test_knowledge_eval.py -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "harness"))

import knowledge_eval as ke  # noqa: E402


# ── score ───────────────────────────────────────────────────────────────────
EXP = {"root_cause_keywords": ["디스크", "공간"], "action_keywords": ["정리", "확보"]}


def test_score_O_when_root_cause_all_and_action_hit():
    resp = {"rootCause": "디스크 공간 부족", "diagnosis": "",
            "proposedActions": [{"description": "로그 정리", "command": "rm"}],
            "confidence": 0.8}
    assert ke.score(resp, EXP) == "O"


def test_score_triangle_when_partial():
    resp = {"rootCause": "디스크 문제", "diagnosis": "",
            "proposedActions": [], "confidence": 0.5}
    assert ke.score(resp, EXP) == "△"


def test_score_X_when_no_match():
    resp = {"rootCause": "네트워크 지연", "diagnosis": "무관한 내용",
            "proposedActions": [], "confidence": 0.3}
    assert ke.score(resp, EXP) == "X"


def test_score_X_when_empty_response():
    assert ke.score({}, EXP) == "X"


def test_score_matches_in_diagnosis_and_command_text():
    # 원인 키워드는 diagnosis 에, 조치 키워드는 command 에 있어도 매칭돼야 함.
    resp = {"rootCause": "", "diagnosis": "디스크 공간 포화",
            "proposedActions": [{"description": "", "command": "cleanup 정리"}]}
    assert ke.score(resp, EXP) == "O"


def test_score_action_optional_when_no_action_keywords():
    exp = {"root_cause_keywords": ["vip"], "action_keywords": []}
    resp = {"rootCause": "vip 드리프트", "proposedActions": []}
    assert ke.score(resp, exp) == "O"


# ── aggregate + render_table ─────────────────────────────────────────────────
def _rec(ft, mode, sc, conf, held_out=False, mock=False):
    return {"fault_type": ft, "mode": mode, "score": sc, "held_out": held_out,
            "mock": mock, "response": {"confidence": conf}}


def test_aggregate_counts_by_type_and_mode():
    recs = [
        _rec("disk_full", "on", "O", 0.8),
        _rec("disk_full", "on", "O", 0.9),
        _rec("disk_full", "off", "X", 0.3),
    ]
    b = ke.aggregate(recs)
    assert b["disk_full"]["on"]["O"] == 2
    assert b["disk_full"]["on"]["n"] == 2
    assert b["disk_full"]["off"]["X"] == 1
    assert b["disk_full"]["on"]["conf"] == [0.8, 0.9]


def test_aggregate_preserves_held_out_and_mock_flags():
    recs = [_rec("gpfs_state", "on", "주입확인", 0.5, mock=True),
            _rec("process_down", "on", "O", 0.7, held_out=True)]
    b = ke.aggregate(recs)
    assert b["gpfs_state"]["mock"] is True
    assert b["process_down"]["held_out"] is True


def test_render_table_separates_held_out_and_mock_sections():
    recs = [
        _rec("disk_full", "on", "O", 0.8),                       # 지식-저자
        _rec("process_down", "on", "O", 0.7, held_out=True),      # held-out
        _rec("gpfs_state", "on", "주입확인", 0.5, mock=True),      # mock
    ]
    table = ke.render_table(ke.aggregate(recs))
    assert "HELD-OUT" in table
    assert "회귀 확인용" in table
    assert "MOCK" in table
    # held-out 행에 process_down 이, 회귀 섹션에 disk_full 이 위치
    assert "process_down" in table
    assert "disk_full" in table
    assert "gpfs_state" in table


def test_render_table_confidence_average():
    recs = [_rec("disk_full", "on", "O", 0.8), _rec("disk_full", "on", "O", 0.6)]
    table = ke.render_table(ke.aggregate(recs))
    assert "conf=0.70" in table


# ── 시나리오 YAML 로딩(동봉 파일 회귀) ────────────────────────────────────────
def test_shipped_scenarios_load_and_have_held_out():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "harness", "scenarios.yaml")
    doc = ke.load_scenarios(path)
    scs = doc["scenarios"]
    assert len(scs) >= 6
    fault_types = {s["fault_type"] for s in scs}
    # 6개 관측 가능 장애 유형 전부 존재
    assert {"process_down", "disk_full", "vip_drift",
            "dirsync_failure", "failover_failure", "gpfs_state"} <= fault_types
    # held-out 최소 1건, mock 최소 1건
    assert any(s.get("held_out") for s in scs), "held-out 시나리오 없음(순환 오염 방지 위반)"
    assert any(s.get("mock") for s in scs), "mock 시나리오 표기 없음"


def test_scenarios_defaults_merge():
    doc = ke.load_scenarios(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "harness", "scenarios.yaml"))
    assert "sshTarget" in doc["defaults"]
