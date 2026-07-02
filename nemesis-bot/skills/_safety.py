"""공유 보안 가드: 셸/코드 실행 전 치명적 패턴 차단 + 감사 로그."""
import re
import logging

logger = logging.getLogger(__name__)

# LLM 오판/명령 주입으로 인한 치명적 동작을 막기 위한 거부 목록(best-effort).
_DANGEROUS_PATTERNS = [
    re.compile(r"\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*f[a-zA-Z]*\b.*\s(/|/\*|~|\$HOME)(\W|$)"),
    re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"),   # fork bomb
    re.compile(r"\bmkfs(\.\w+)?\b"),
    re.compile(r"\bdd\b.*\bof=/dev/(sd|nvme|vd|hd)"),
    re.compile(r">\s*/dev/(sd|nvme|vd|hd)"),
    re.compile(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+/(\W|$)"),
]


def is_dangerous(text) -> bool:
    """문자열(셸 명령 또는 코드)에 명백한 파괴 패턴이 있으면 True."""
    if not text:
        return False
    if isinstance(text, (list, tuple)):
        text = " ".join(str(p) for p in text)
    return any(p.search(text) for p in _DANGEROUS_PATTERNS)


def audit(source: str, payload) -> None:
    """실행 감사 로그(한 줄). payload는 repr로 안전 출력."""
    logger.warning("AUDIT %s exec: %r", source, payload)
