
import logging
import os
import stat
from pathlib import Path
from typing import List, Dict

logger = logging.getLogger(__name__)

# 허용된 서브디렉토리 목록 (BASE_DIR 기준 상대 경로)
# 비어 있으면 BASE_DIR 전체 허용
ALLOWED_SUBDIRS = []  # 제한 없음 — BASE_DIR 내 어디든 저장 가능

class FileSkill:
    """파일 관리 스킬 — 읽기/쓰기/스크립트 생성 및 실행권한 부여"""

    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir).resolve()

    # ------------------------------------------------------------------ #
    #  내부 헬퍼                                                           #
    # ------------------------------------------------------------------ #
    def _resolve(self, path: str) -> Path | None:
        """path → BASE_DIR 내 절대 경로. 외부 경로는 None 반환."""
        try:
            target = (self.base_dir / path).resolve()
            if str(target).startswith(str(self.base_dir)):
                return target
            logger.warning(f"Access denied: {path} is outside workspace")
            return None
        except Exception as e:
            logger.error(f"Path resolution error: {e}")
            return None

    @staticmethod
    def _set_executable(path: Path):
        """Linux/macOS 에서 .sh/.py 파일에 실행권한(chmod +x) 부여."""
        if os.name != 'nt':
            try:
                current = path.stat().st_mode
                path.chmod(current | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                logger.info(f"chmod +x applied: {path}")
            except Exception as e:
                logger.warning(f"chmod failed for {path}: {e}")

    # ------------------------------------------------------------------ #
    #  공개 메서드                                                          #
    # ------------------------------------------------------------------ #
    def list_files(self, path: str = ".") -> List[str]:
        """디렉토리 파일 목록 조회"""
        target = self._resolve(path)
        if target is None:
            return ["Error: Access denied (outside workspace)"]
        if not target.exists():
            return [f"Error: Path not found — {path}"]
        try:
            result = []
            for p in sorted(target.iterdir()):
                prefix = "[DIR]  " if p.is_dir() else "[FILE] "
                result.append(f"{prefix}{p.name}")
            return result
        except Exception as e:
            return [f"Error: {e}"]

    def read_file(self, path: str) -> str:
        """파일 내용 읽기"""
        target = self._resolve(path)
        if target is None:
            return "Error: Access denied"
        if not target.exists() or not target.is_file():
            return "Error: File not found"
        try:
            return target.read_text(encoding='utf-8')
        except Exception as e:
            return f"Error reading file: {e}"

    def write_file(self, path: str, content: str) -> str:
        """
        파일 저장 (BASE_DIR 내 어느 경로든 가능).
        .sh / .py 파일은 자동으로 실행권한(chmod +x)을 부여합니다.
        """
        target = self._resolve(path)
        if target is None:
            return "Error: Access denied"
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf-8')
            # 스크립트 파일이면 실행권한 자동 부여
            if target.suffix in ('.sh', '.py', '.bash'):
                self._set_executable(target)
            logger.info(f"File written: {target}")
            return f"OK: 파일 저장 완료 — {path}"
        except Exception as e:
            return f"Error writing file: {e}"

    def delete_file(self, path: str) -> str:
        """파일 삭제"""
        target = self._resolve(path)
        if target is None:
            return "Error: Access denied"
        if not target.exists():
            return "Error: File not found"
        try:
            target.unlink()
            return f"OK: 삭제 완료 — {path}"
        except Exception as e:
            return f"Error deleting file: {e}"

    # ------------------------------------------------------------------ #
    #  Tool definitions                                                    #
    # ------------------------------------------------------------------ #
    def get_tool_definitions(self) -> List[dict]:
        return [
            {
                "name": "list_files",
                "description": "지정된 디렉토리의 파일/폴더 목록을 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "조회할 경로 (기본값: '.'). 예: 'scripts/', 'data/', 'memory/'"
                        }
                    }
                }
            },
            {
                "name": "read_file",
                "description": "파일 내용을 읽습니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "읽을 파일 경로"}
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "write_file",
                "description": (
                    "서버에 파일을 생성하거나 덮어씁니다. "
                    "scripts/, data/, memory/ 등 BASE_DIR 내 어느 경로든 저장 가능합니다. "
                    ".sh 또는 .py 파일은 저장 즉시 실행권한(chmod +x)이 자동 부여됩니다. "
                    "스크립트를 만든 뒤 run_shell_command로 바로 실행할 수 있습니다."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": (
                                "저장할 파일 경로. 예: "
                                "'scripts/backup.sh', 'data/check.py', 'memory/note.md'"
                            )
                        },
                        "content": {
                            "type": "string",
                            "description": "파일에 저장할 내용"
                        }
                    },
                    "required": ["path", "content"]
                }
            },
            {
                "name": "delete_file",
                "description": "파일을 삭제합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "삭제할 파일 경로"}
                    },
                    "required": ["path"]
                }
            }
        ]

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "list_files":
            return {"files": self.list_files(args.get("path", "."))}
        elif tool_name == "read_file":
            return {"content": self.read_file(args.get("path", ""))}
        elif tool_name == "write_file":
            return {"result": self.write_file(args.get("path", ""), args.get("content", ""))}
        elif tool_name == "delete_file":
            return {"result": self.delete_file(args.get("path", ""))}
        return {"error": "Unknown tool"}
