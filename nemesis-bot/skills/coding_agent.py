"""
코딩 에이전트 스킬 — 코드 작성·실행·디버깅·패키지 설치를 수행하는 전문 스킬
"""
import subprocess
import sys
import os
import tempfile
import logging
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

from skills._safety import is_dangerous, audit

BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BASE_DIR / "workspace"
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)


class CodingAgentSkill:
    """코드 실행·저장·디버깅·패키지 설치를 지원하는 코딩 에이전트"""

    def _run_cmd(self, cmd: list, timeout: int = 30, cwd: str = None) -> Dict:
        """셸 명령 실행 후 결과 반환"""
        audit("coding_agent._run_cmd", cmd)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True,
                timeout=timeout,
                cwd=cwd or str(WORKSPACE_DIR),
            )
            return {
                "stdout": result.stdout.strip(),
                "stderr": result.stderr.strip(),
                "returncode": result.returncode,
                "success": result.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": f"⏱️ 실행 시간 초과 ({timeout}초)", "returncode": -1, "success": False}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "returncode": -1, "success": False}

    # ── 1. Python 코드 즉시 실행 ──────────────────────────────────────
    def run_python_code(self, code: str, timeout: int = 30) -> str:
        """Python 코드를 임시 파일로 실행하고 결과 반환"""
        if is_dangerous(code):
            logger.warning("BLOCKED dangerous run_python_code: %r", code[:200])
            return "❌ **차단됨**: 파괴적 패턴이 감지되어 실행을 거부했습니다."
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", dir=str(WORKSPACE_DIR),
            delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            tmp_path = f.name
        try:
            r = self._run_cmd([sys.executable, tmp_path], timeout=timeout)
            if r["success"]:
                out = r["stdout"] or "(출력 없음)"
                return f"✅ **실행 성공**\n```\n{out[:2000]}\n```"
            else:
                err = r["stderr"] or r["stdout"] or "알 수 없는 오류"
                return f"❌ **실행 오류**\n```\n{err[:2000]}\n```"
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    # ── 2. 파일로 저장 후 실행 ───────────────────────────────────────
    def save_and_run(self, filename: str, code: str, timeout: int = 30) -> str:
        """코드를 workspace/{filename}에 저장하고 실행"""
        if is_dangerous(code):
            logger.warning("BLOCKED dangerous save_and_run: %r %r", filename, code[:200])
            return "❌ **차단됨**: 파괴적 패턴이 감지되어 저장/실행을 거부했습니다."
        ext = Path(filename).suffix.lower()
        safe_name = Path(filename).name
        file_path = WORKSPACE_DIR / safe_name
        file_path.write_text(code, encoding="utf-8")
        if ext in (".sh",):
            file_path.chmod(0o755)

        if ext == ".py":
            r = self._run_cmd([sys.executable, str(file_path)], timeout=timeout)
        elif ext == ".sh":
            r = self._run_cmd(["bash", str(file_path)], timeout=timeout)
        else:
            return f"✅ 파일 저장 완료: `workspace/{safe_name}` (실행 미지원 형식)"

        if r["success"]:
            out = r["stdout"] or "(출력 없음)"
            return f"✅ **`{safe_name}` 저장 및 실행 성공**\n```\n{out[:2000]}\n```"
        else:
            err = r["stderr"] or r["stdout"]
            return f"✅ 저장: `workspace/{safe_name}`\n❌ **실행 오류**\n```\n{err[:2000]}\n```"

    # ── 3. pip 패키지 설치 ───────────────────────────────────────────
    def install_package(self, package_name: str) -> str:
        """pip으로 패키지 설치"""
        audit("install_package", package_name)
        r = self._run_cmd(
            [sys.executable, "-m", "pip", "install", package_name, "-q"],
            timeout=120
        )
        if r["success"]:
            return f"✅ **`{package_name}` 설치 완료**"
        return f"❌ **설치 실패**\n```\n{r['stderr'][:500]}\n```"

    # ── 4. 코드 문법 분석 ────────────────────────────────────────────
    def analyze_code(self, code: str, language: str = "python") -> str:
        """코드 문법 오류 분석 (Python py_compile 사용)"""
        if language.lower() != "python":
            return f"ℹ️ 현재 Python만 분석 지원합니다."
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", dir=str(WORKSPACE_DIR),
            delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            tmp_path = f.name
        try:
            r = self._run_cmd(
                [sys.executable, "-m", "py_compile", tmp_path], timeout=10
            )
            if r["success"]:
                return "✅ **문법 검사 통과** — 문법 오류 없음"
            return f"❌ **문법 오류 발견**\n```\n{r['stderr'].replace(tmp_path, '<code>')[:1000]}\n```"
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    # ── 5. workspace 파일 목록 ──────────────────────────────────────
    def list_workspace(self) -> str:
        """workspace/ 디렉토리 파일 목록 반환"""
        files = sorted(WORKSPACE_DIR.iterdir())
        if not files:
            return "📂 workspace/ 비어있습니다."
        lines = ["📂 **workspace/ 파일 목록:**"]
        for f in files:
            size = f.stat().st_size
            lines.append(f"• `{f.name}` ({size:,} bytes)")
        return "\n".join(lines)

    # ── LangGraph 인터페이스 ─────────────────────────────────────────
    def get_tool_definitions(self) -> List[Dict]:
        return [
            {
                "name": "run_python_code",
                "description": "Python 코드를 즉시 실행하고 결과를 반환합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "description": "실행할 Python 코드"},
                        "timeout": {"type": "integer", "description": "실행 제한 시간(초)", "default": 30},
                    },
                    "required": ["code"],
                },
            },
            {
                "name": "save_and_run",
                "description": "코드를 workspace/ 폴더에 저장하고 실행합니다. Python(.py)과 Shell(.sh) 지원.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "filename": {"type": "string", "description": "저장할 파일명 (예: hello.py, check.sh)"},
                        "code": {"type": "string", "description": "저장할 코드"},
                        "timeout": {"type": "integer", "description": "실행 제한 시간(초)", "default": 30},
                    },
                    "required": ["filename", "code"],
                },
            },
            {
                "name": "install_package",
                "description": "pip으로 Python 패키지를 설치합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "package_name": {"type": "string", "description": "설치할 패키지명 (예: requests, pandas)"},
                    },
                    "required": ["package_name"],
                },
            },
            {
                "name": "analyze_code",
                "description": "Python 코드의 문법 오류를 분석합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "description": "분석할 코드"},
                        "language": {"type": "string", "description": "언어 (현재 python만 지원)", "default": "python"},
                    },
                    "required": ["code"],
                },
            },
            {
                "name": "list_workspace",
                "description": "workspace/ 폴더의 파일 목록을 조회합니다.",
                "parameters": {"type": "object", "properties": {}},
            },
        ]

    def execute_tool(self, tool_name: str, args: Dict) -> str:
        if tool_name == "run_python_code":
            return self.run_python_code(args["code"], args.get("timeout", 30))
        elif tool_name == "save_and_run":
            return self.save_and_run(args["filename"], args["code"], args.get("timeout", 30))
        elif tool_name == "install_package":
            return self.install_package(args["package_name"])
        elif tool_name == "analyze_code":
            return self.analyze_code(args["code"], args.get("language", "python"))
        elif tool_name == "list_workspace":
            return self.list_workspace()
        return f"❌ 알 수 없는 도구: {tool_name}"
