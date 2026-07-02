
import logging
import platform
import socket
import psutil
import subprocess
from typing import Dict
import shlex

logger = logging.getLogger(__name__)

from skills._safety import is_dangerous as _is_dangerous, _DANGEROUS_PATTERNS  # noqa: F401

class SystemSkill:
    """시스템 정보 및 제어 스킬"""
    
    def get_system_info(self):
        """시스템 기본 정보 조회"""
        try:
            info = {
                "os": platform.system(),
                "release": platform.release(),
                "version": platform.version(),
                "machine": platform.machine(),
                "processor": platform.processor(),
                "hostname": socket.gethostname(),
                "ip_address": socket.gethostbyname(socket.gethostname())
            }
            return info
        except Exception as e:
            logger.error(f"System info error: {e}")
            return {"error": str(e)}

    def execute_command(self, command: str):
        """셸 명령어 실행 (주의: 보안 위험)"""
        import os
        from pathlib import Path

        if _is_dangerous(command):
            logger.warning("BLOCKED dangerous command: %r", command)
            return {
                "stdout": "",
                "stderr": f"⛔ 차단된 명령: 파괴적 패턴이 감지되었습니다 ({command!r})",
                "returncode": 126,
            }
        logger.warning("AUDIT shell exec: %r", command)
        try:
            # BASE_DIR를 작업 디렉토리로 설정하여 상대 경로(./)가 올바르게 동작하게 함
            try:
                from config import BASE_DIR
                cwd = str(BASE_DIR)
            except Exception:
                cwd = None

            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=cwd
            )
            
            # [Self-healing] Permission denied handling
            if result.returncode != 0 and "Permission denied" in result.stderr:
                logger.warning(f"Permission denied for command: {command}. Attempting to fix permissions...")
                
                # Extract potential script path (simple heuristic)
                parts = command.split()
                if parts:
                    script_path = parts[0]
                    # If it looks like a script file
                    if script_path.endswith('.sh') or script_path.endswith('.py') or '/' in script_path:
                        try:
                            # Try to add execute permission
                            chmod_result = subprocess.run(
                                f"chmod +x {shlex.quote(script_path)}",
                                shell=True,
                                capture_output=True,
                                text=True
                            )
                            if chmod_result.returncode == 0:
                                logger.info(f"Fixed permissions for {script_path}. Retrying command...")
                                # Retry original command
                                result = subprocess.run(
                                    command,
                                    shell=True,
                                    capture_output=True,
                                    text=True,
                                    timeout=30
                                )
                            else:
                                logger.error(f"Failed to fix permissions: {chmod_result.stderr}")
                        except Exception as e:
                            logger.error(f"Error during permission fix: {e}")

            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            }
        except Exception as e:
            logger.error(f"Command execution error: {e}")
            return {"error": str(e)}

    # Alias for compatibility
    def run_command(self, command: str):
        return self.execute_command(command)

    def get_tool_definition(self) -> dict:
        return {
            "name": "run_shell_command",
            "description": "리눅스(Bash) 쉘 명령어를 실행합니다. 서버 관리, 프로세스 확인, 스크립트 실행 등이 필요할 때 사용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "실행할 쉘 명령어 (예: 'ls -la', 'ps aux', './script.sh')"
                    }
                },
                "required": ["command"]
            }
        }

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "run_shell_command":
            return self.execute_command(args.get("command"))
        return {"error": "Unknown tool"}
