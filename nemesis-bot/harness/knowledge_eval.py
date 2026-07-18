"""
knowledge_eval.py — 지식베이스 효과 평가 하네스 (T4).

각 시나리오를 지식 ON/OFF 두 모드로 사이드카 /ai/investigate 에 N회 호출하고,
응답을 JSONL 로 기록한 뒤 유형×모드 비교 테이블을 산출한다.

설계 근거 (root-feat-aiops-sp3-design-*.md, Approach C):
- 순환 오염 방지(교차검증 #2): held_out 시나리오만 확장/영업 근거로 사용한다.
  지식-저자가 쓴 시나리오는 회귀(regression) 확인용이며 별도로 집계·표기한다.
- 재현 가능성(교차검증 #5): mock=true 유형(실 상태와 불일치, 예: GPFS 메트릭 모킹)은
  조사관이 실 노드를 보고 '이상 없음'으로 수렴할 수 있어 품질 비교에서 제외하고
  '주입 확인'으로만 다룬다.
- 채점은 초기엔 수동이 원칙. 하네스는 러프 키워드 자동 채점을 보조로 제공하고 모든
  원자료(JSONL)를 남겨 수동 채점이 가능하게 한다.
- 측정 결과는 모델/provider 설정에 종속되므로 실행 시점 provider/model 을 기록한다.

사용:
  # 측정(사이드카 직호출, 실 노드 재현 없이 컨텍스트만 주입 — 기본 안전 모드)
  python harness/knowledge_eval.py run \\
      --scenarios harness/scenarios.yaml --runs 3 \\
      --sidecar http://127.0.0.1:18900 --token <AIBOT_TOKEN> \\
      --out results.jsonl

  # 기록된 JSONL 로 비교 테이블만 재출력
  python harness/knowledge_eval.py report results.jsonl
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from typing import Dict, List, Optional

import yaml


# ── 순수 로직 (네트워크 없음 — 단위 테스트 대상) ────────────────────────────

def load_scenarios(path: str) -> Dict:
    with open(path, "r", encoding="utf-8") as f:
        doc = yaml.safe_load(f) or {}
    doc.setdefault("defaults", {})
    doc.setdefault("scenarios", [])
    return doc


def _text_of(response: Dict) -> str:
    """응답에서 채점에 쓸 텍스트(진단+원인+조치 서술/명령)를 소문자로 모은다."""
    parts = [str(response.get("diagnosis", "")), str(response.get("rootCause", ""))]
    for a in response.get("proposedActions") or []:
        parts.append(str(a.get("description", "")))
        parts.append(str(a.get("command", "")))
    return "\n".join(parts).lower()


def score(response: Dict, expected: Dict) -> str:
    """러프 자동 채점(수동 채점 보조): "O" | "△" | "X".

    O = 기대 원인 키워드 전부 매칭 + 조치 키워드 하나 이상 매칭
    △ = 일부만 매칭
    X = 하나도 매칭 못함(또는 빈 응답)
    """
    text = _text_of(response)
    if not text.strip():
        return "X"
    rc = [k.lower() for k in (expected.get("root_cause_keywords") or [])]
    ac = [k.lower() for k in (expected.get("action_keywords") or [])]
    rc_hit = [k for k in rc if k in text]
    ac_hit = [k for k in ac if k in text]
    rc_all = bool(rc) and len(rc_hit) == len(rc)
    if rc_all and (not ac or ac_hit):
        return "O"
    if rc_hit or ac_hit:
        return "△"
    return "X"


def aggregate(records: List[Dict]) -> Dict:
    """(fault_type, held_out, mock) 별로 mode(on/off) 채점 분포와 평균 confidence 집계."""
    buckets: Dict = defaultdict(lambda: {
        "on": {"O": 0, "△": 0, "X": 0, "주입확인": 0, "conf": [], "n": 0},
        "off": {"O": 0, "△": 0, "X": 0, "주입확인": 0, "conf": [], "n": 0},
        "held_out": False, "mock": False,
    })
    for r in records:
        key = r["fault_type"]
        b = buckets[key]
        b["held_out"] = r.get("held_out", False)
        b["mock"] = r.get("mock", False)
        m = b[r["mode"]]
        m["n"] += 1
        sc = r.get("score", "X")
        # mock 유형은 O/△/X 대신 '주입확인'(품질비교 제외). 미지의 라벨도 안전하게 흡수.
        m[sc if sc in ("O", "△", "X", "주입확인") else "X"] += 1
        c = r.get("response", {}).get("confidence")
        if isinstance(c, (int, float)):
            m["conf"].append(float(c))
    return buckets


def _avg(xs: List[float]) -> Optional[float]:
    return round(sum(xs) / len(xs), 2) if xs else None


def _mode_cell(m: Dict) -> str:
    if m["n"] == 0:
        return "-"
    conf = _avg(m["conf"])
    conf_s = f"{conf:.2f}" if conf is not None else "n/a"
    if m.get("주입확인"):                       # mock 유형: 품질 채점 대신 주입확인 건수
        return f"주입확인 {m['주입확인']}/{m['n']} conf={conf_s}"
    return f"O{m['O']}/△{m['△']}/X{m['X']} conf={conf_s}"


def render_table(buckets: Dict) -> str:
    """held-out(확장 근거)과 지식-저자(회귀)와 mock(주입확인)을 구분한 비교 테이블."""
    lines = []
    order = [
        ("HELD-OUT (확장/영업 근거)", lambda b: b["held_out"] and not b["mock"]),
        ("지식-저자 시나리오 (회귀 확인용)", lambda b: not b["held_out"] and not b["mock"]),
        ("MOCK (주입확인만 — 품질비교 제외)", lambda b: b["mock"]),
    ]
    for title, pred in order:
        rows = [(ft, b) for ft, b in sorted(buckets.items()) if pred(b)]
        if not rows:
            continue
        lines.append(f"\n[{title}]")
        lines.append(f"  {'fault_type':<20} | {'지식 ON':<28} | {'지식 OFF':<28}")
        lines.append(f"  {'-'*20}-+-{'-'*28}-+-{'-'*28}")
        for ft, b in rows:
            lines.append(f"  {ft:<20} | {_mode_cell(b['on']):<28} | {_mode_cell(b['off']):<28}")
    lines.append("\n채점: O=기대 원인+조치 매칭, △=부분, X=미매칭(러프 자동채점 — 수동 검토 권장).")
    lines.append("HELD-OUT 행만 확장/영업 근거로 사용. 지식-저자 행은 회귀 확인용. MOCK 은 품질비교 제외.")
    return "\n".join(lines)


# ── 네트워크/실행 (하네스 러너) ─────────────────────────────────────────────

def call_investigate(sidecar: str, token: str, context: Dict, ssh_target: Dict,
                     knowledge: bool, timeout: float = 120.0) -> Dict:
    body = json.dumps({
        "context": context, "sshTarget": ssh_target, "knowledge": knowledge,
    }).encode("utf-8")
    req = urllib.request.Request(
        sidecar.rstrip("/") + "/ai/investigate", data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_llm_config(backend_url: str, token: str) -> Dict:
    """실행 시점 provider/model 기록용(측정 결과가 모델 설정에 종속되므로)."""
    try:
        req = urllib.request.Request(
            backend_url.rstrip("/") + "/api/ai/llm-config",
            headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=5) as r:
            d = json.loads(r.read().decode("utf-8"))
        return {"provider": d.get("llmProvider"),
                "ollamaModel": d.get("llmOllamaModel"),
                "openaiModel": d.get("llmOpenaiModel")}
    except Exception as e:  # noqa: BLE001
        return {"provider": None, "error": str(e)}


def run(args) -> int:
    doc = load_scenarios(args.scenarios)
    defaults = doc["defaults"]
    scenarios = doc["scenarios"]
    llm_cfg = fetch_llm_config(args.backend, args.token) if args.backend else {}
    records: List[Dict] = []
    with open(args.out, "w", encoding="utf-8") as out:
        for sc in scenarios:
            ssh_target = {**defaults.get("sshTarget", {}), **sc.get("sshTarget", {})}
            context = {**defaults.get("context", {}), **sc.get("context", {})}
            expected = sc.get("expected", {})
            mock = bool(sc.get("mock", False))
            held_out = bool(sc.get("held_out", False))
            for mode, kn in (("on", True), ("off", False)):
                for i in range(args.runs):
                    try:
                        resp = call_investigate(args.sidecar, args.token, context,
                                                ssh_target, kn, timeout=args.timeout)
                        err = None
                    except Exception as e:  # noqa: BLE001
                        resp, err = {}, str(e)
                    rec = {
                        "scenario": sc.get("id"),
                        "fault_type": sc.get("fault_type", sc.get("id")),
                        "mode": mode, "run": i, "held_out": held_out, "mock": mock,
                        "response": resp, "error": err,
                        # mock 은 품질비교 제외 → 채점 대신 주입확인 표기
                        "score": "주입확인" if mock else score(resp, expected),
                        "llm": llm_cfg,
                        "ts": int(time.time()),
                    }
                    records.append(rec)
                    out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    print(f"[{sc.get('id')}] {mode} run{i}: score={rec['score']} "
                          f"conf={resp.get('confidence')}"
                          + (f" ERR={err}" if err else ""))
    print("\n" + render_table(aggregate(records)))
    print(f"\n원자료: {args.out}  (모델설정: {llm_cfg})")
    return 0


def report(args) -> int:
    records = []
    with open(args.jsonl, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    print(render_table(aggregate(records)))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="지식베이스 효과 평가 하네스 (T4)")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="시나리오를 ON/OFF 로 측정하고 JSONL+테이블 산출")
    r.add_argument("--scenarios", required=True)
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--sidecar", default=os.getenv("NEMESIS_SIDECAR_URL", "http://127.0.0.1:18900"))
    r.add_argument("--backend", default=os.getenv("NEMESIS_BACKEND_URL", ""))
    r.add_argument("--token", default=os.getenv("NEMESIS_AIBOT_TOKEN", ""))
    r.add_argument("--timeout", type=float, default=120.0)
    r.add_argument("--out", default="knowledge_eval_results.jsonl")
    r.set_defaults(func=run)

    rp = sub.add_parser("report", help="기록된 JSONL 로 비교 테이블만 재출력")
    rp.add_argument("jsonl")
    rp.set_defaults(func=report)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
