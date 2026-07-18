"""
knowledge_base.py — 장애 지식베이스 로더 (RDF/OWL 온톨로지 기반, RAG 주입).

knowledge/{linux,docker,...}/*.xml 파일을 로드해 /ai/investigate 프롬프트에 주입할
컨텍스트 블록을 만든다. 각 파일은 RDF/XML(OWL 어휘) 온톨로지다 — 네임스페이스는
http://nemesis.local/kb#(prefix kb):

  <owl:NamedIndividual rdf:about="#Fault_ProcessDown">
    <rdf:type rdf:resource="#Fault"/>
    <rdfs:label>프로세스/서비스 다운</rdfs:label>
    <kb:has_fault_type>process_down</kb:has_fault_type>
    <kb:has_os>linux</kb:has_os>
    <kb:has_target_sw>service</kb:has_target_sw>
    <kb:has_severity>high</kb:has_severity>
    <kb:related_to rdf:resource="http://nemesis.local/kb#Fault_ContainerDown"/>
    <kb:has_symptom rdf:resource="#Symptom_ProcessDown_1"/>
    <kb:has_cause rdf:resource="#Cause_ProcessDown_1"/>
    <kb:diagnosed_by rdf:resource="#Diagnosis_ProcessDown_1"/>
    <kb:resolved_by rdf:resource="#Action_ProcessDown_1"/>
  </owl:NamedIndividual>

  <owl:NamedIndividual rdf:about="#Action_ProcessDown_1">
    <rdf:type rdf:resource="#Action"/>
    <kb:order rdf:datatype="xsd:integer">1</kb:order>
    <kb:has_risk>MEDIUM</kb:has_risk>
    <kb:has_command>control.sh svc-restart &lt;svc&gt;</kb:has_command>
    <rdfs:label>...</rdfs:label>
  </owl:NamedIndividual>

`kb:has_fault_type`/`has_os`/`has_target_sw`/`has_severity` 데이터속성이 메타데이터
(=매칭 키)이고, `kb:has_symptom`/`has_cause`/`diagnosed_by`/`resolved_by`/`has_caveat`로
연결된 개체들이 온톨로지 본문이다. 목록 순서는 트리플에 순서가 없으므로 각 개체에
`kb:order`(xsd:integer)를 붙여 복원한다. 주입 시에는 LLM 이 읽기 좋은 구조화 텍스트로
렌더한다(소스는 RDF/XML 유지).

Phase 1 은 매칭 기계 없이 linux/docker 지식 전체를 상시 주입한다. 규칙 매칭/이벤트
어댑터는 파일이 많아질 때 Phase 2 에서 도입한다.

설계: ~/.gstack/projects/Nemesis_v100/root-feat-aiops-sp3-design-*.md (Approach C, T1)
"""
import os
import re
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from rdflib import Graph, Namespace, RDF, RDFS

logger = logging.getLogger("knowledge_base")

KB = Namespace("http://nemesis.local/kb#")

# 기본 지식 디렉토리: 이 모듈과 같은 위치의 knowledge/ (사이드카 패키지에 동봉).
DEFAULT_KNOWLEDGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge")
# Phase 1 상시 주입 대상 도메인(현재 에이전트가 관측 가능한 영역).
DEFAULT_DOMAINS: Tuple[str, ...] = ("linux", "docker")
# 파일당 주입 상한(바이트, 렌더 후 기준). 초과 시 뒤에서 잘라내고 잘림 표시.
MAX_BYTES_PER_FILE = 8192


@dataclass
class KnowledgeDoc:
    path: str                 # 표시용 상대 경로 (예: "linux/process.xml")
    domain: str
    frontmatter: Dict         # 루트 속성(fault_type/os/target_sw/severity) + related[]
    body: str                 # 온톨로지 렌더 텍스트(주입용)
    truncated: bool = False


@dataclass
class KnowledgeLoadResult:
    docs: List[KnowledgeDoc] = field(default_factory=list)
    # 파싱 실패로 제외된 파일: [{"file": "linux/x.xml", "error": "..."}]
    skipped_files: List[Dict[str, str]] = field(default_factory=list)


def knowledge_dir() -> str:
    """KNOWLEDGE_DIR env 우선, 없으면 패키지 동봉 기본 경로."""
    return os.getenv("KNOWLEDGE_DIR", "").strip() or DEFAULT_KNOWLEDGE_DIR


def _env_disabled() -> bool:
    """전역 비활성 스위치. 평가 하네스가 OFF 모드 측정에 사용."""
    return os.getenv("NEMESIS_KNOWLEDGE_DISABLED", "").strip().lower() in ("1", "true", "yes", "on")


def parse_rdf(raw: str) -> Tuple[Dict, str]:
    """(metadata dict, 렌더된 온톨로지 본문) 반환. 잘못된 RDF/OWL/Fault 개체 수 이상이면 ValueError.

    metadata: kb:has_fault_type 등 4개 데이터속성 + related(kb:related_to 대상 개체명 목록).
    본문: 섹션별(증상/원인/진단/조치/주의)로 읽기 좋게 렌더한 텍스트(포맷은 구 스키마와 동일).
    """
    g = Graph()
    try:
        g.parse(data=raw, format="xml")
    except Exception as e:  # noqa: BLE001 — rdflib 예외 타입이 다양해 폭넓게 잡음
        raise ValueError(f"RDF 파싱 오류: {e}")

    faults = list(g.subjects(RDF.type, KB.Fault))
    if len(faults) != 1:
        raise ValueError(f"kb:Fault 개체가 정확히 1개 있어야 함(현재 {len(faults)}개)")
    fault = faults[0]

    def _lit(subj, pred) -> Optional[str]:
        v = g.value(subj, pred)
        return str(v) if v is not None else None

    meta: Dict = {k: v for k, v in {
        "fault_type": _lit(fault, KB.has_fault_type),
        "os": _lit(fault, KB.has_os),
        "target_sw": _lit(fault, KB.has_target_sw),
        "severity": _lit(fault, KB.has_severity),
    }.items() if v is not None}
    if not meta.get("fault_type"):
        raise ValueError("kb:Fault 개체에 kb:has_fault_type 데이터속성이 필요함")
    meta["related"] = [str(o).rsplit("#", 1)[-1] for o in g.objects(fault, KB.related_to)]

    def _ordered(pred) -> List:
        items = list(g.objects(fault, pred))
        return sorted(items, key=lambda n: int(g.value(n, KB.order) or 0))

    def _label(n) -> str:
        return " ".join(str(g.value(n, RDFS.label) or "").split()).strip()

    lines: List[str] = []
    title = _label(fault)
    if title:
        lines.append(f"### {title}")

    def section(header: str, items: List, with_attr: Optional[Tuple[str, object]] = None):
        if not items:
            return
        lines.append(f"- {header}:")
        for it in items:
            t = _label(it)
            if with_attr:
                label, pred = with_attr
                av = _lit(it, pred)
                if av:
                    t = f"[{label}={av}] {t}" if t else f"[{label}={av}]"
            if t:
                lines.append(f"  · {t}")

    symptoms = _ordered(KB.has_symptom)
    causes = _ordered(KB.has_cause)
    diagnosis = _ordered(KB.diagnosed_by)
    actions = _ordered(KB.resolved_by)
    caveats = _ordered(KB.has_caveat)

    section("증상", symptoms)
    section("원인 후보", causes)
    section("진단", diagnosis, with_attr=("cmd", KB.has_command))
    section("조치", actions, with_attr=("risk", KB.has_risk))
    # 조치의 cmd 도 노출(있으면)
    for a in actions:
        cmd = _lit(a, KB.has_command)
        if cmd:
            lines.append(f"    → cmd: {cmd}")
    section("주의", caveats)

    return meta, "\n".join(lines).strip()


def load_knowledge(kdir: Optional[str] = None,
                   domains: Tuple[str, ...] = DEFAULT_DOMAINS) -> KnowledgeLoadResult:
    """지식 디렉토리를 스캔해 XML 문서를 로드한다. 매 호출마다 디스크에서 읽어(캐시 없음)
    파일 수정이 재시작 없이 반영된다. 파일 하나의 파싱 실패가 로더 전체를 죽이지 않고,
    해당 파일만 skipped_files 에 기록한다."""
    kdir = kdir or knowledge_dir()
    result = KnowledgeLoadResult()
    if not os.path.isdir(kdir):
        logger.info("KNOWLEDGE_DIR 없음(%s) — 지식 주입 건너뜀", kdir)
        return result
    for domain in domains:
        ddir = os.path.join(kdir, domain)
        if not os.path.isdir(ddir):
            continue
        for name in sorted(os.listdir(ddir)):
            if not name.endswith(".xml"):
                continue
            rel = f"{domain}/{name}"
            fpath = os.path.join(ddir, name)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    raw = f.read()
                meta, body = parse_rdf(raw)
            except Exception as e:  # noqa: BLE001 — 파일 하나 실패가 전체를 막지 않게
                logger.warning("지식 파일 로드/파싱 실패 — 건너뜀: %s (%s)", rel, e)
                result.skipped_files.append({"file": rel, "error": str(e)})
                continue
            truncated = False
            encoded = body.encode("utf-8")
            if len(encoded) > MAX_BYTES_PER_FILE:
                body = encoded[:MAX_BYTES_PER_FILE].decode("utf-8", "ignore") + "\n…(이하 생략)"
                truncated = True
            result.docs.append(KnowledgeDoc(
                path=rel, domain=domain, frontmatter=meta, body=body, truncated=truncated))
    return result


_HEADER = (
    "# 장애 대응 지식베이스 (참고용)\n"
    "아래는 Nemesis HA 환경의 장애 유형별 지식(온톨로지)이다. 진단·조치 제안 시 참고하되, "
    "실제 관측(도구 결과)과 충돌하면 관측을 우선하라. "
    "아래 '조치'는 제안 텍스트이며 자동 실행 입력이 아니다.\n"
)


def build_knowledge_context(kdir: Optional[str] = None,
                            domains: Tuple[str, ...] = DEFAULT_DOMAINS,
                            request_enabled: bool = True
                            ) -> Tuple[str, List[Dict[str, str]]]:
    """조사관 시스템 프롬프트에 붙일 지식 컨텍스트 텍스트와 skipped_files 를 반환.
    비활성(전역 env 또는 요청 플래그)이면 ("", []). 문서 0건/디렉토리 없음이면 본문은 "".
    """
    if not request_enabled or _env_disabled():
        return "", []
    result = load_knowledge(kdir, domains)
    if not result.docs:
        return "", result.skipped_files
    parts = [_HEADER]
    for d in result.docs:
        ft = d.frontmatter.get("fault_type", d.path)
        parts.append(f"## [{ft}] ({d.path})\n{d.body}\n")
    return "\n".join(parts), result.skipped_files


# ── 편집 CRUD (시스템 설정 UI 용) ────────────────────────────────────────────
# 지식 파일은 웹 UI(백엔드 프록시 경유)에서 편집한다. 파일이 LLM 분석 프롬프트로
# 흘러가므로 쓰기 표면을 엄격히 제한한다: 경로는 반드시 knowledge 디렉토리 안의
# `<domain>/<name>.xml` 형태여야 하고(경로 탈출·심링크 차단), 저장 전 RDF/OWL 을 검증한다.

# 도메인/파일명은 소문자 슬러그 + .xml 만 허용(traversal·이상 문자 차단).
_REL_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9._-]*\.xml$")


class KnowledgeIOError(Exception):
    """편집 CRUD 의 사용자 대상 오류(400 매핑용)."""


def _safe_target(rel_path: str, kdir: Optional[str] = None) -> Tuple[str, str]:
    """(kdir_abs, target_abs) 반환. 형식 위반/디렉토리 밖 경로는 KnowledgeIOError."""
    kdir_abs = os.path.abspath(kdir or knowledge_dir())
    if not _REL_RE.match(rel_path or ""):
        raise KnowledgeIOError(
            f"허용되지 않는 경로 형식: {rel_path!r} (예: linux/process.xml — "
            "<도메인>/<파일>.xml, 소문자/숫자/._- 만)")
    target = os.path.abspath(os.path.join(kdir_abs, rel_path))
    if os.path.commonpath([kdir_abs, target]) != kdir_abs:
        raise KnowledgeIOError("지식 디렉토리 밖 경로는 거부됩니다")
    return kdir_abs, target


def list_files(kdir: Optional[str] = None) -> List[Dict]:
    """편집 UI 용 전체 .xml 파일 목록(aix/oracle 포함). 각 파일 파싱 유효성·주입 여부 포함."""
    kdir = kdir or knowledge_dir()
    out: List[Dict] = []
    if not os.path.isdir(kdir):
        return out
    for domain in sorted(os.listdir(kdir)):
        ddir = os.path.join(kdir, domain)
        if not os.path.isdir(ddir):
            continue
        for name in sorted(os.listdir(ddir)):
            if not name.endswith(".xml"):
                continue
            rel = f"{domain}/{name}"
            info: Dict = {
                "path": rel, "domain": domain, "name": name,
                "injected": domain in DEFAULT_DOMAINS,
            }
            try:
                with open(os.path.join(ddir, name), "r", encoding="utf-8") as f:
                    meta, _ = parse_rdf(f.read())
                info["fault_type"] = meta.get("fault_type")
                info["valid"] = True
            except Exception as e:  # noqa: BLE001
                info["valid"] = False
                info["error"] = str(e)
            out.append(info)
    return out


def read_file(rel_path: str, kdir: Optional[str] = None) -> str:
    _, target = _safe_target(rel_path, kdir)
    if not os.path.isfile(target):
        raise KnowledgeIOError(f"파일이 없습니다: {rel_path}")
    with open(target, "r", encoding="utf-8") as f:
        return f.read()


def validate_content(content: str) -> Tuple[bool, Optional[str]]:
    """RDF/OWL 파싱/스키마 가능 여부."""
    try:
        parse_rdf(content or "")
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def save_file(rel_path: str, content: str, kdir: Optional[str] = None) -> str:
    """검증 통과 시 원자적 저장(tmp+replace). 실패 시 KnowledgeIOError."""
    _, target = _safe_target(rel_path, kdir)
    ok, err = validate_content(content)
    if not ok:
        raise KnowledgeIOError(f"XML 검증 실패: {err}")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, target)  # 원자적 교체(부분 쓰기 노출 방지)
    return rel_path


def delete_file(rel_path: str, kdir: Optional[str] = None) -> str:
    _, target = _safe_target(rel_path, kdir)
    if not os.path.isfile(target):
        raise KnowledgeIOError(f"파일이 없습니다: {rel_path}")
    os.remove(target)
    return rel_path
