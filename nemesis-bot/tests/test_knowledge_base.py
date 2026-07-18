"""
지식베이스 로더/주입 유닛 테스트 (RDF/OWL 온톨로지).
순수 함수 + 파일 IO 만 테스트하므로 LLM/네트워크 모킹 불필요.

실행: cd nemesis-bot && python -m pytest tests/test_knowledge_base.py -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import knowledge_base as kb  # noqa: E402

_RDF_PREAMBLE = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"\n'
    '         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"\n'
    '         xmlns:owl="http://www.w3.org/2002/07/owl#"\n'
    '         xmlns:xsd="http://www.w3.org/2001/XMLSchema#"\n'
    '         xmlns:kb="http://nemesis.local/kb#"\n'
    '         xml:base="http://nemesis.local/kb#">\n'
)


def _rdf(fault_type="process_down", os_="linux", extra_links="", extra_individuals="",
         title="제목", include_fault_type=True):
    ft_line = f"    <kb:has_fault_type>{fault_type}</kb:has_fault_type>\n" if include_fault_type else ""
    return (
        _RDF_PREAMBLE +
        '  <owl:NamedIndividual rdf:about="#Fault_X">\n'
        '    <rdf:type rdf:resource="#Fault"/>\n'
        f'    <rdfs:label>{title}</rdfs:label>\n'
        f'{ft_line}'
        f'    <kb:has_os>{os_}</kb:has_os>\n'
        '    <kb:has_symptom rdf:resource="#Symptom_1"/>\n'
        '    <kb:diagnosed_by rdf:resource="#Diagnosis_1"/>\n'
        f'{extra_links}'
        '  </owl:NamedIndividual>\n'
        '  <owl:NamedIndividual rdf:about="#Symptom_1">\n'
        '    <rdf:type rdf:resource="#Symptom"/>\n'
        '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n'
        '    <rdfs:label>서비스 무응답</rdfs:label>\n'
        '  </owl:NamedIndividual>\n'
        '  <owl:NamedIndividual rdf:about="#Diagnosis_1">\n'
        '    <rdf:type rdf:resource="#DiagnosisStep"/>\n'
        '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n'
        '    <kb:has_command>control.sh svc-status</kb:has_command>\n'
        '    <rdfs:label>유닛 확인</rdfs:label>\n'
        '  </owl:NamedIndividual>\n'
        f'{extra_individuals}'
        '</rdf:RDF>\n'
    )


def _rdf_no_fault():
    """Fault 타입 개체가 하나도 없는 유효한 RDF/XML(옛 '루트 태그 불일치' 케이스에 대응)."""
    return (
        _RDF_PREAMBLE +
        '  <owl:NamedIndividual rdf:about="#NotAFault">\n'
        '    <rdf:type rdf:resource="#Symptom"/>\n'
        '    <rdfs:label>장애 개체 아님</rdfs:label>\n'
        '  </owl:NamedIndividual>\n'
        '</rdf:RDF>\n'
    )


def _write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


@pytest.fixture
def kdir(tmp_path):
    root = tmp_path / "knowledge"
    _write(str(root / "linux" / "process.xml"), _rdf("process_down", "linux"))
    _write(str(root / "docker" / "runtime.xml"), _rdf("container_down", "linux", title="컨테이너"))
    # 주입 대상 아닌 도메인(oracle)은 무시돼야 함.
    _write(str(root / "oracle" / "listener.xml"), _rdf("listener_down", "linux"))
    return str(root)


# ── load_knowledge ──────────────────────────────────────────────────────────
def test_load_scans_default_domains_only(kdir):
    result = kb.load_knowledge(kdir)
    paths = {d.path for d in result.docs}
    assert paths == {"linux/process.xml", "docker/runtime.xml"}
    assert result.skipped_files == []


def test_load_parses_attributes_and_renders_body(kdir):
    result = kb.load_knowledge(kdir)
    proc = next(d for d in result.docs if d.path == "linux/process.xml")
    assert proc.frontmatter["fault_type"] == "process_down"
    assert proc.frontmatter["os"] == "linux"
    assert "서비스 무응답" in proc.body        # 증상 렌더됨
    assert "control.sh svc-status" in proc.body  # 진단 cmd 렌더됨


def test_missing_dir_returns_empty_not_error(tmp_path):
    result = kb.load_knowledge(str(tmp_path / "does-not-exist"))
    assert result.docs == []
    assert result.skipped_files == []


def test_broken_rdf_is_skipped_not_fatal(kdir):
    _write(os.path.join(kdir, "linux", "broken.xml"), "<rdf:RDF><unclosed>")
    result = kb.load_knowledge(kdir)
    good = {d.path for d in result.docs}
    assert "linux/process.xml" in good          # 정상 파일은 여전히 로드
    assert "linux/broken.xml" not in good        # 깨진 파일은 제외
    skipped = {s["file"] for s in result.skipped_files}
    assert "linux/broken.xml" in skipped
    assert all("error" in s for s in result.skipped_files)


def test_no_fault_individual_is_skipped(kdir):
    _write(os.path.join(kdir, "linux", "nofault.xml"), _rdf_no_fault())
    result = kb.load_knowledge(kdir)
    assert "linux/nofault.xml" in {s["file"] for s in result.skipped_files}


def test_missing_fault_type_is_skipped(kdir):
    _write(os.path.join(kdir, "linux", "noft.xml"), _rdf("x", "linux", include_fault_type=False))
    result = kb.load_knowledge(kdir)
    assert "linux/noft.xml" in {s["file"] for s in result.skipped_files}


def test_md_files_are_ignored(kdir):
    # README.md 등 .md 는 로더가 무시(RDF/OWL 온톨로지는 .xml 만).
    _write(os.path.join(kdir, "linux", "README.md"), "# not knowledge\n")
    result = kb.load_knowledge(kdir)
    assert not any(d.path.endswith(".md") for d in result.docs)


def test_oversized_file_is_truncated(kdir, monkeypatch):
    monkeypatch.setattr(kb, "MAX_BYTES_PER_FILE", 100)
    caveat_links = "".join(f'    <kb:has_caveat rdf:resource="#Caveat_{i}"/>\n' for i in range(40))
    caveat_individuals = "".join(
        '  <owl:NamedIndividual rdf:about="#Caveat_{i}">\n'
        '    <rdf:type rdf:resource="#Caveat"/>\n'
        '    <kb:order rdf:datatype="xsd:integer">{i}</kb:order>\n'
        '    <rdfs:label>가나다라마바사</rdfs:label>\n'
        '  </owl:NamedIndividual>\n'.format(i=i)
        for i in range(40)
    )
    big = _rdf("big", "linux", extra_links=caveat_links, extra_individuals=caveat_individuals)
    _write(os.path.join(kdir, "linux", "big.xml"), big)
    result = kb.load_knowledge(kdir)
    doc = next(d for d in result.docs if d.path == "linux/big.xml")
    assert doc.truncated is True
    assert "생략" in doc.body


# ── build_knowledge_context ──────────────────────────────────────────────────
def test_context_contains_fault_types_and_header(kdir):
    text, skipped = kb.build_knowledge_context(kdir=kdir)
    assert "장애 대응 지식베이스" in text
    assert "process_down" in text
    assert "container_down" in text
    assert skipped == []


def test_context_empty_when_request_disabled(kdir):
    text, skipped = kb.build_knowledge_context(kdir=kdir, request_enabled=False)
    assert text == ""
    assert skipped == []


def test_context_empty_when_env_disabled(kdir, monkeypatch):
    monkeypatch.setenv("NEMESIS_KNOWLEDGE_DISABLED", "1")
    text, _ = kb.build_knowledge_context(kdir=kdir, request_enabled=True)
    assert text == ""


def test_context_empty_when_no_docs(tmp_path):
    text, skipped = kb.build_knowledge_context(kdir=str(tmp_path / "nope"))
    assert text == ""
    assert skipped == []


def test_context_surfaces_skipped_files(kdir):
    _write(os.path.join(kdir, "linux", "broken.xml"), "<rdf:RDF><oops")
    text, skipped = kb.build_knowledge_context(kdir=kdir)
    assert text != ""                                  # 정상 파일은 주입됨
    assert "linux/broken.xml" in {s["file"] for s in skipped}


# ── env / dir 헬퍼 ──────────────────────────────────────────────────────────
def test_knowledge_dir_env_override(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_DIR", "/custom/path")
    assert kb.knowledge_dir() == "/custom/path"


def test_knowledge_dir_default_when_unset(monkeypatch):
    monkeypatch.delenv("KNOWLEDGE_DIR", raising=False)
    assert kb.knowledge_dir() == kb.DEFAULT_KNOWLEDGE_DIR


@pytest.mark.parametrize("val,expected", [
    ("1", True), ("true", True), ("YES", True), ("on", True),
    ("0", False), ("", False), ("no", False),
])
def test_env_disabled_parsing(monkeypatch, val, expected):
    monkeypatch.setenv("NEMESIS_KNOWLEDGE_DISABLED", val)
    assert kb._env_disabled() is expected


# ── 실제 동봉 지식 파일 검증(회귀) ───────────────────────────────────────────
def test_shipped_knowledge_files_all_valid():
    """패키지에 동봉된 knowledge/ RDF/XML 이 전부 파싱되고 fault_type 을 갖춘다."""
    result = kb.load_knowledge(kb.DEFAULT_KNOWLEDGE_DIR)
    assert result.skipped_files == [], f"깨진 지식 파일: {result.skipped_files}"
    assert len(result.docs) >= 6                       # linux 5 + docker 1
    for d in result.docs:
        assert d.frontmatter.get("fault_type"), f"{d.path} 에 fault_type 없음"
        assert d.frontmatter.get("os") == "linux"


def test_shipped_aix_oracle_skeletons_not_loaded():
    """aix/oracle 스켈레톤(README.md)은 비-기본 도메인 + 비-xml 이라 로드/주입되지 않는다."""
    result = kb.load_knowledge(kb.DEFAULT_KNOWLEDGE_DIR)
    paths = {d.path for d in result.docs}
    assert not any(p.startswith(("aix/", "oracle/")) for p in paths)
    assert not any(p.endswith(".md") for p in paths)
