"""
지식 파일 편집 CRUD 유닛 테스트 (RDF/OWL 온톨로지).
경로 탈출 차단·RDF 검증·저장/읽기 왕복·목록·삭제를 검증한다(네트워크 없음).

실행: cd nemesis-bot && python -m pytest tests/test_knowledge_crud.py -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import knowledge_base as kb  # noqa: E402


def _valid(fault_type="disk_full", os_="linux", title="디스크 풀"):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"\n'
        '         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"\n'
        '         xmlns:owl="http://www.w3.org/2002/07/owl#"\n'
        '         xmlns:xsd="http://www.w3.org/2001/XMLSchema#"\n'
        '         xmlns:kb="http://nemesis.local/kb#"\n'
        '         xml:base="http://nemesis.local/kb#">\n'
        '  <owl:NamedIndividual rdf:about="#Fault_X">\n'
        '    <rdf:type rdf:resource="#Fault"/>\n'
        f'    <rdfs:label>{title}</rdfs:label>\n'
        f'    <kb:has_fault_type>{fault_type}</kb:has_fault_type>\n'
        f'    <kb:has_os>{os_}</kb:has_os>\n'
        '    <kb:has_symptom rdf:resource="#Symptom_1"/>\n'
        '  </owl:NamedIndividual>\n'
        '  <owl:NamedIndividual rdf:about="#Symptom_1">\n'
        '    <rdf:type rdf:resource="#Symptom"/>\n'
        '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n'
        '    <rdfs:label>증상</rdfs:label>\n'
        '  </owl:NamedIndividual>\n'
        '</rdf:RDF>\n'
    )


VALID = _valid()
BROKEN = '<rdf:RDF><unclosed>'
NO_FAULT = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"\n'
    '         xmlns:owl="http://www.w3.org/2002/07/owl#">\n'
    '  <owl:NamedIndividual rdf:about="http://nemesis.local/kb#NotAFault"/>\n'
    '</rdf:RDF>\n'
)


@pytest.fixture
def kdir(tmp_path):
    root = tmp_path / "knowledge"
    (root / "linux").mkdir(parents=True)
    with open(root / "linux" / "process.xml", "w", encoding="utf-8") as f:
        f.write(_valid("process_down", "linux"))
    return str(root)


# ── 경로 가드 ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("bad", [
    "../etc/passwd.xml",           # 상위 탈출
    "linux/../../x.xml",           # 정규화 후 탈출
    "/etc/passwd.xml",            # 절대경로
    "linux/process.md",            # .xml 아님
    "process.xml",                 # 도메인 없음
    "Linux/Process.xml",           # 대문자
    "linux/",                      # 파일명 없음
    "",                            # 빈 값
])
def test_save_rejects_bad_paths(kdir, bad):
    with pytest.raises(kb.KnowledgeIOError):
        kb.save_file(bad, VALID, kdir=kdir)


@pytest.mark.parametrize("bad", ["../secrets.xml", "linux/../../x.xml", "/etc/x.xml"])
def test_read_rejects_bad_paths(kdir, bad):
    with pytest.raises(kb.KnowledgeIOError):
        kb.read_file(bad, kdir=kdir)


def test_save_does_not_escape(kdir):
    with pytest.raises(kb.KnowledgeIOError):
        kb.save_file("linux/../../../../tmp/evil.xml", VALID, kdir=kdir)


# ── 저장/읽기 왕복 ───────────────────────────────────────────────────────────
def test_save_then_read_roundtrip(kdir):
    kb.save_file("linux/storage.xml", VALID, kdir=kdir)
    assert kb.read_file("linux/storage.xml", kdir=kdir) == VALID


def test_save_creates_new_domain_dir(kdir):
    x = _valid("lvm", "aix")
    kb.save_file("aix/lvm.xml", x, kdir=kdir)
    assert os.path.isfile(os.path.join(kdir, "aix", "lvm.xml"))


def test_save_is_atomic_no_tmp_left(kdir):
    kb.save_file("linux/storage.xml", VALID, kdir=kdir)
    assert not os.path.exists(os.path.join(kdir, "linux", "storage.xml.tmp"))


def test_read_missing_file_raises(kdir):
    with pytest.raises(kb.KnowledgeIOError):
        kb.read_file("linux/nope.xml", kdir=kdir)


# ── 검증 ─────────────────────────────────────────────────────────────────────
def test_save_rejects_broken_rdf(kdir):
    with pytest.raises(kb.KnowledgeIOError):
        kb.save_file("linux/bad.xml", BROKEN, kdir=kdir)
    assert not os.path.exists(os.path.join(kdir, "linux", "bad.xml"))  # 미기록


def test_validate_content_ok_and_bad():
    ok, err = kb.validate_content(VALID)
    assert ok and err is None
    bad_ok, bad_err = kb.validate_content(BROKEN)
    assert not bad_ok and bad_err


def test_validate_rejects_no_fault_individual():
    ok, err = kb.validate_content(NO_FAULT)
    assert not ok and "Fault" in err


# ── 목록 / 삭제 ──────────────────────────────────────────────────────────────
def test_list_files_reports_validity_and_injected(kdir):
    os.makedirs(os.path.join(kdir, "aix"))
    with open(os.path.join(kdir, "aix", "lvm.xml"), "w", encoding="utf-8") as f:
        f.write(_valid("lvm", "aix"))
    with open(os.path.join(kdir, "linux", "broken.xml"), "w", encoding="utf-8") as f:
        f.write(BROKEN)
    files = {f["path"]: f for f in kb.list_files(kdir)}
    assert files["linux/process.xml"]["injected"] is True
    assert files["linux/process.xml"]["valid"] is True
    assert files["linux/process.xml"]["fault_type"] == "process_down"
    assert files["aix/lvm.xml"]["injected"] is False       # 비주입 도메인
    assert files["linux/broken.xml"]["valid"] is False       # 깨진 파일 표시
    assert "error" in files["linux/broken.xml"]


def test_delete_file(kdir):
    kb.save_file("linux/tmp.xml", VALID, kdir=kdir)
    kb.delete_file("linux/tmp.xml", kdir=kdir)
    assert not os.path.exists(os.path.join(kdir, "linux", "tmp.xml"))


def test_delete_missing_raises(kdir):
    with pytest.raises(kb.KnowledgeIOError):
        kb.delete_file("linux/nope.xml", kdir=kdir)
