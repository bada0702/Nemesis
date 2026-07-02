"""
Dynamic Skill Generator
AI가 자동으로 새로운 스킬을 skills/ 디렉토리에 생성하고
런타임 중 즉시 로드(hot-load)하는 모듈
"""

import importlib
import importlib.util
import logging
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class SkillGenerator:
    """
    AI가 생성한 코드를 skills/{name}.py 파일로 저장하고,
    skills/__init__.py 를 업데이트한 뒤, 즉시 ToolManager 에 hot-load 합니다.
    """

    def __init__(self, base_dir: Path = None):
        if base_dir is None:
            base_dir = Path(__file__).resolve().parent
        self.base_dir = Path(base_dir)
        self.skills_dir = self.base_dir / "skills"
        self.skills_init = self.skills_dir / "__init__.py"
        self.requirements_file = self.base_dir / "requirements.txt"

    # ------------------------------------------------------------------ #
    #  스킬 파일 생성                                                       #
    # ------------------------------------------------------------------ #
    def _module_name(self, skill_name: str) -> str:
        """SkillName → snake_case module name.  예: YouTubeSkill → youtube"""
        name = skill_name.replace("Skill", "").replace("skill", "")
        # CamelCase → snake_case
        name = re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()
        name = re.sub(r'[^a-z0-9_]', '_', name).strip('_')
        return name or "custom"

    def _class_name(self, skill_name: str) -> str:
        """스킬 클래스명 정규화.  예: youtube → YouTubeSkill"""
        if skill_name.endswith("Skill"):
            return skill_name
        # snake_case → CamelCase
        return "".join(p.capitalize() for p in skill_name.split("_")) + "Skill"

    def create_skill_file(self, module_name: str, class_name: str,
                          python_code: str) -> Path:
        """
        skills/{module_name}.py 파일을 생성합니다.

        python_code 는 완전한 클래스 코드여야 합니다.
        클래스가 없으면 기본 래퍼로 감쌉니다.
        """
        skill_file = self.skills_dir / f"{module_name}.py"

        # 코드에 클래스 정의가 없으면 자동 래핑
        if f"class {class_name}" not in python_code:
            python_code = f"""import logging
logger = logging.getLogger(__name__)

class {class_name}:
    \"\"\"동적으로 생성된 스킬\"\"\"

{python_code}
"""

        skill_file.write_text(python_code, encoding='utf-8')
        logger.info(f"Skill file created: {skill_file}")
        return skill_file

    # ------------------------------------------------------------------ #
    #  skills/__init__.py 업데이트                                         #
    # ------------------------------------------------------------------ #
    def _update_init(self, module_name: str, class_name: str,
                     var_name: str) -> bool:
        """
        skills/__init__.py 에 import 문과 SkillsManager 초기화 코드를 추가합니다.
        이미 등록되어 있으면 스킵합니다.
        """
        try:
            content = self.skills_init.read_text(encoding='utf-8')

            # 이미 등록된 경우 스킵
            if f"from .{module_name} import {class_name}" in content:
                logger.info(f"{class_name} already registered in __init__.py")
                return True

            # 1. import 추가 — 기존 import 블록 마지막 줄 뒤에 삽입
            import_line = f"from .{module_name} import {class_name}\n"
            # 마지막 'from .' 또는 'import' 줄 뒤에 추가
            lines = content.splitlines(keepends=True)
            last_import_idx = 0
            for i, line in enumerate(lines):
                if line.startswith("from .") or (
                        line.startswith("import ") and "logging" not in line):
                    last_import_idx = i
            lines.insert(last_import_idx + 1, import_line)
            content = "".join(lines)

            # 2. SkillsManager.__init__ 에 초기화 코드 추가
            #    'enabled_list = ...' 줄 바로 앞에 삽입
            init_line = f"        self.{var_name} = {class_name}()\n"
            marker = "        enabled_list = "
            if marker in content and init_line not in content:
                content = content.replace(marker, init_line + marker, 1)

            self.skills_init.write_text(content, encoding='utf-8')
            logger.info(f"skills/__init__.py updated for {class_name}")
            return True

        except Exception as e:
            logger.error(f"Failed to update __init__.py: {e}")
            return False

    # ------------------------------------------------------------------ #
    #  라이브러리 설치                                                      #
    # ------------------------------------------------------------------ #
    def install_libraries(self, libraries: List[str]) -> Dict:
        """pip install 실행 후 결과 반환"""
        results = {}
        for lib in libraries:
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "pip", "install", lib],
                    capture_output=True, text=True, timeout=120
                )
                ok = result.returncode == 0
                results[lib] = "installed" if ok else f"failed: {result.stderr[:200]}"
                if ok:
                    logger.info(f"Installed: {lib}")
                else:
                    logger.error(f"Failed to install {lib}: {result.stderr}")
            except Exception as e:
                results[lib] = f"error: {e}"
        return results

    def _update_requirements(self, libraries: List[str]):
        """requirements.txt 에 새 라이브러리 추가"""
        try:
            existing = set()
            if self.requirements_file.exists():
                for line in self.requirements_file.read_text().splitlines():
                    line = line.strip()
                    if line and not line.startswith('#'):
                        existing.add(re.split(r'[>=<!]', line)[0].strip())
            new_libs = [
                lib for lib in libraries
                if re.split(r'[>=<!]', lib)[0].strip() not in existing
            ]
            if new_libs:
                with self.requirements_file.open('a', encoding='utf-8') as f:
                    f.write("\n# Dynamic skill dependencies\n")
                    for lib in new_libs:
                        f.write(f"{lib}\n")
        except Exception as e:
            logger.warning(f"Could not update requirements.txt: {e}")

    # ------------------------------------------------------------------ #
    #  Hot-load                                                            #
    # ------------------------------------------------------------------ #
    def hot_load(self, skill_file: Path, class_name: str):
        """
        importlib 로 스킬 모듈을 즉시 로드하고 클래스 인스턴스를 반환합니다.
        """
        try:
            spec = importlib.util.spec_from_file_location(
                f"skills.{skill_file.stem}", skill_file)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            skill_cls = getattr(module, class_name, None)
            if skill_cls is None:
                raise AttributeError(
                    f"Class '{class_name}' not found in {skill_file}")
            instance = skill_cls()
            logger.info(f"Hot-loaded skill: {class_name}")
            return instance
        except Exception as e:
            logger.error(f"Hot-load failed for {class_name}: {e}")
            return None

    # ------------------------------------------------------------------ #
    #  메인 진입점                                                          #
    # ------------------------------------------------------------------ #
    def add_skill(self,
                  skill_name: str,
                  description: str,
                  python_code: str,
                  required_libraries: Optional[List[str]] = None,
                  tool_manager=None) -> Dict:
        """
        새 스킬 전체 등록 프로세스:
        1. 스킬 파일 생성 (skills/{module}.py)
        2. skills/__init__.py 업데이트
        3. 필요 라이브러리 설치
        4. hot-load → ToolManager 에 즉시 등록

        Args:
            skill_name: 스킬 이름 (예: 'YouTube', 'YouTubeSkill')
            description: 스킬 설명 (로그/응답용)
            python_code: 완전한 Python 클래스 코드
            required_libraries: pip 설치할 패키지 목록
            tool_manager: 실행 중인 ToolManager 인스턴스 (hot-load용)

        Returns:
            결과 딕셔너리
        """
        try:
            module_name = self._module_name(skill_name)
            class_name = self._class_name(skill_name)
            var_name = module_name  # self.youtube = YouTubeSkill()

            # 1. 스킬 파일 생성
            skill_file = self.create_skill_file(module_name, class_name,
                                                python_code)

            # 2. __init__.py 업데이트 (재시작 후에도 유지)
            self._update_init(module_name, class_name, var_name)

            # 3. 라이브러리 설치
            lib_results = {}
            if required_libraries:
                lib_results = self.install_libraries(required_libraries)
                self._update_requirements(required_libraries)

            # 4. Hot-load → ToolManager 즉시 등록
            registered_tools = []
            if tool_manager is not None:
                instance = self.hot_load(skill_file, class_name)
                if instance:
                    count = tool_manager.hot_register_skill(instance)
                    registered_tools = [
                        d.get('name', '') if isinstance(d, dict) else d.name
                        for d in (
                            instance.get_tool_definitions()
                            if hasattr(instance, 'get_tool_definitions')
                            else [instance.get_tool_definition()]
                        )
                    ]
                    logger.info(
                        f"Hot-registered {count} tools for {class_name}")

            return {
                "success": True,
                "skill_name": class_name,
                "module_file": str(skill_file.relative_to(self.base_dir)),
                "registered_tools": registered_tools,
                "libraries": lib_results,
                "message": (
                    f"스킬 '{class_name}' 생성 완료! "
                    f"등록된 도구: {registered_tools}. "
                    f"봇 재시작 없이 즉시 사용 가능합니다."
                )
            }

        except Exception as e:
            logger.error(f"add_skill failed: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
