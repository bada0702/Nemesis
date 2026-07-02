
from google.genai import types
import logging
from typing import Dict, Any, Optional, List
import datetime
from scheduler import parse_time_expression
from skill_generator import SkillGenerator

logger = logging.getLogger(__name__)

class ToolManager:
    """
    Manages tool definitions and execution for the AI Bot using a registry pattern.
    """

    def __init__(self, skills_manager=None, mcp_server=None, reminder_manager=None, cron_scheduler=None,
                 memory_manager=None, news_client=None, stock_client=None, weather_client=None, calendar_client=None):
        """
        Initialize the ToolManager with necessary dependencies.
        """
        self.skills_manager = skills_manager
        self.mcp_server = mcp_server
        self.reminder_manager = reminder_manager
        self.cron_scheduler = cron_scheduler
        self.memory_manager = memory_manager
        
        # Legacy/Direct clients (fallback)
        self.news_client = news_client
        self.stock_client = stock_client
        self.weather_client = weather_client
        self.calendar_client = calendar_client
        
        # Registry: tool_name -> (handler_instance, handler_method_name or callable)
        self.tool_registry = {}
        
        # Skill generator (AI 자체 스킬 생성용)
        from config import BASE_DIR
        self.skill_generator = SkillGenerator(base_dir=BASE_DIR)

        # Initialize tools
        self.tools = self._create_tool_definitions()

    def refresh_tools(self):
        """Regenerate tool definitions based on current state (e.g., when a scheduler is added)."""
        logger.info("Refreshing tool definitions...")
        self.tools = self._create_tool_definitions()

    def _create_tool_definitions(self) -> types.Tool:
        """
        Dynamically aggregate tool definitions from all available sources.
        """
        declarations = []
        
        # 1. Register Skills from SkillsManager
        if self.skills_manager:
            # List of attributes to check for skills
            skill_names = [
                'weather', 'search', 'news', 'stock', 'stock_recommendation',
                'currency', 'crypto', 'files', 'system', 'server', 'note', 'task', 'gmail', 'project'
            ]
            
            for name in skill_names:
                skill = getattr(self.skills_manager, name, None)
                if skill:
                    # Check for get_tool_definitions (plural) or get_tool_definition (singular)
                    defs = []
                    if hasattr(skill, 'get_tool_definitions'):
                        defs = skill.get_tool_definitions()
                    elif hasattr(skill, 'get_tool_definition'):
                        defs = [skill.get_tool_definition()]
                    
                    for d in defs:
                        # Convert dict to FunctionDeclaration if needed
                        if isinstance(d, dict):
                            declarations.append(types.FunctionDeclaration(**d))
                            self.tool_registry[d['name']] = skill
                        else:
                            # If it's already a FunctionDeclaration object (not implemented in skills yet, but for future)
                            declarations.append(d)
                            self.tool_registry[d.name] = skill

        # 2. Register Reminder/Schedule Tools (if manager available)
        if self.reminder_manager:
            declarations.extend([
                types.FunctionDeclaration(
                    name="set_reminder",
                    description="알림/스케줄을 설정합니다. 사용자가 특정 시간에 알림을 요청하면 이 도구를 사용하세요. 매일/매주 반복도 가능합니다.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "time_expression": {"type": "string", "description": "알림 시간 표현"},
                            "message": {"type": "string", "description": "알림 메시지 내용"},
                            "reminder_type": {"type": "string", "description": "알림 유형 (once, daily, weekly)", "enum": ["once", "daily", "weekly"]}
                        },
                        "required": ["time_expression", "message"]
                    }
                )
                ,
                types.FunctionDeclaration(
                    name="list_reminders",
                    description="등록된 일회성 알림 목록을 조회합니다.",
                    parameters={"type": "object", "properties": {}}
                ),
                types.FunctionDeclaration(
                    name="delete_reminder",
                    description="등록된 일회성 알림을 삭제합니다.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "reminder_id": {"type": "string", "description": "삭제할 알림의 ID"}
                        },
                        "required": ["reminder_id"]
                    }
                )
            ])
            # Register self as handler for these
            self.tool_registry["set_reminder"] = self
            self.tool_registry["list_reminders"] = self
            self.tool_registry["delete_reminder"] = self

        if self.cron_scheduler:
            declarations.extend([
                types.FunctionDeclaration(
                    name="create_schedule",
                    description="매일/매주 반복되는 작업을 스케줄링합니다.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "time_expression": {"type": "string", "description": "시간 표현"},
                            "ai_task": {"type": "string", "description": "실행할 AI 작업 내용"}
                        },
                        "required": ["time_expression", "ai_task"]
                    }
                ),
                types.FunctionDeclaration(
                    name="delete_schedule",
                    description="등록된 반복 스케줄(알림)을 삭제합니다.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "schedule_id": {"type": "string", "description": "삭제할 스케줄의 ID"}
                        },
                        "required": ["schedule_id"]
                    }
                ),
                types.FunctionDeclaration(
                    name="list_schedules",
                    description="등록된 모든 반복 스케줄(알림) 목록을 조회합니다.",
                    parameters={"type": "object", "properties": {}}
                )
            ])
            self.tool_registry["create_schedule"] = self
            self.tool_registry["delete_schedule"] = self
            self.tool_registry["list_schedules"] = self

        # 3. Register Memory Update Tool
        declarations.append(
            types.FunctionDeclaration(
                name="update_memory",
                description=(
                    "장기 기억(메모리 파일)을 읽거나 수정합니다. "
                    "사용자가 정보를 저장/기억/삭제/수정하도록 요청하면 이 도구를 사용하세요. "
                    "액션: append(추가), replace(특정 텍스트 교체), delete_line(특정 줄/항목 삭제), write(전체 덮어쓰기), read(읽기)."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "file": {
                            "type": "string",
                            "description": "메모리 파일 경로",
                            "enum": ["memory/USER.md", "memory/MEMORY.md", "memory/AGENTS.md", "memory/SOUL.md"]
                        },
                        "action": {
                            "type": "string",
                            "description": (
                                "수행할 작업: "
                                "append=텍스트 추가, "
                                "replace=old 텍스트를 new로 교체, "
                                "delete_line=old와 일치하는 줄(들) 삭제, "
                                "write=파일 전체 덮어쓰기, "
                                "read=파일 내용 읽기"
                            ),
                            "enum": ["append", "replace", "delete_line", "write", "read"]
                        },
                        "old": {"type": "string", "description": "replace/delete_line 작업시 찾을 기존 텍스트 (부분 일치 가능)"},
                        "new": {"type": "string", "description": "append/replace/write 작업시 새로운 텍스트"}
                    },
                    "required": ["file", "action"]
                }
            )
        )
        self.tool_registry["update_memory"] = self
        
        # 4. Register Calendar Tools (Legacy Wrapper)
        if self.calendar_client:
             declarations.extend([
                types.FunctionDeclaration(
                    name="list_calendar_events",
                    description="구글 캘린더에서 '개인적이고 일반적인 일정' 목록을 조회합니다. ⚠️ 주의: '프로젝트' 관련 일정은 절대 여기서 찾지 말고 반드시 프로젝트 전용 도구를 사용하세요.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "date": {
                                "type": "string",
                                "description": "조회할 날짜. '오늘'(today), '내일'(tomorrow), '어제'(yesterday), 또는 'YYYY-MM-DD' 형식. 생략 시 오늘."
                            },
                        }
                    }
                ),
                types.FunctionDeclaration(
                    name="search_calendar",
                    description="구글 캘린더에서 일정을 검색합니다.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "검색할 키워드"}
                        },
                        "required": ["query"]
                    }
                ),
                types.FunctionDeclaration(
                    name="add_calendar_event",
                    description="구글 캘린더에 새로운 일정을 등록합니다.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "summary": {"type": "string", "description": "일정 제목"},
                            "start_time": {"type": "string", "description": "시작 시간"},
                            "end_time": {"type": "string", "description": "종료 시간"},
                            "description": {"type": "string", "description": "일정 설명"}
                        },
                        "required": ["summary", "start_time"]
                    }
                ),
                types.FunctionDeclaration(
                    name="delete_calendar_event",
                    description="구글 캘린더에서 일정을 삭제합니다. 검색어로 찾거나, event_id를 직접 지정할 수 있습니다. 여러 일정이 검색되면 목록을 반환하므로 사용자에게 확인 후 event_id로 재호출하세요.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "삭제할 일정의 검색어 (event_id 없을 때 사용)"},
                            "day": {"type": "string", "description": "YYYY-MM-DD 형식 날짜 필터 (선택사항)"},
                            "event_id": {"type": "string", "description": "삭제할 일정의 Google Calendar event ID (목록 조회 후 확정된 경우 사용)"}
                        }
                    }
                )
             ])
             self.tool_registry["list_calendar_events"] = self
             self.tool_registry["search_calendar"] = self
             self.tool_registry["add_calendar_event"] = self
             self.tool_registry["delete_calendar_event"] = self

        # 5. WorkLog Tool — 업무일지 생성 (calendar_client 필요)
        if self.calendar_client:
            from skills.worklog import WorkLogSkill
            from config import BASE_DIR as _BASE_DIR
            self._worklog_skill = WorkLogSkill(
                calendar_client=self.calendar_client,
                base_dir=_BASE_DIR
            )
            for d in self._worklog_skill.get_tool_definitions():
                declarations.append(types.FunctionDeclaration(**d))
                self.tool_registry[d['name']] = self._worklog_skill

        # 6. create_skill — AI가 새 스킬을 직접 생성
        declarations.append(
            types.FunctionDeclaration(
                name="create_skill",
                description=(
                    "AI가 새로운 스킬(기능 모듈)을 Python 코드로 직접 작성하고 봇에 즉시 등록합니다. "
                    "스킬 코드는 get_tool_definitions()와 execute_tool()을 구현한 클래스여야 합니다. "
                    "등록 즉시 새 도구를 사용할 수 있으며, 봇 재시작 후에도 유지됩니다."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "skill_name": {
                            "type": "string",
                            "description": "스킬 이름 (예: 'YouTube', 'Translate', 'DiskMonitor')"
                        },
                        "description": {
                            "type": "string",
                            "description": "스킬이 하는 일에 대한 설명"
                        },
                        "python_code": {
                            "type": "string",
                            "description": (
                                "완전한 Python 클래스 코드. "
                                "get_tool_definitions() → List[dict] 와 "
                                "execute_tool(tool_name, args) → dict 를 반드시 구현해야 합니다."
                            )
                        },
                        "required_libraries": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "pip install 할 라이브러리 목록 (예: ['requests', 'beautifulsoup4'])"
                        }
                    },
                    "required": ["skill_name", "python_code"]
                }
            )
        )
        self.tool_registry["create_skill"] = self

        return types.Tool(function_declarations=declarations)

    # 스킬명 → SKILLS_CONFIG 키 매핑
    _SKILL_CONFIG_MAP = {
        "get_weather": "weather",
        "web_search": "search",
        "search_news": "news",
        "get_stock_price": "stock",
        "get_exchange_rate": "currency",
        "get_multiple_exchange_rates": "currency",
        "get_crypto_price": "crypto",
        "list_files": "file",
        "read_file": "file",
        "write_file": "file",
        "delete_file": "file",
        "run_shell_command": "system",
        "get_note": "note",
        "save_note": "note",
        "list_notes": "note",
        "get_tasks": "task",
        "add_task": "task",
        "complete_task": "task",
        "get_server_time": "server",
        "get_system_resources": "server",
        "get_stock_recommendations": "stock_recommendation",
        "check_gmail": "gmail",
        "send_gmail": "gmail",
        "read_gmail": "gmail",
        "ftp_upload": "ftp",
        "ftp_download": "ftp",
        "ftp_list": "ftp",
        "list_projects": "project",
        "get_project_detail": "project",
        "create_project": "project",
        "list_project_tasks": "project",
        "create_project_task": "project",
        "update_project_task": "project",
        "delete_project_task": "project",
        "delete_project": "project",
        "update_project": "project",
    }

    def execute_tool(self, tool_name: str, args: Dict[str, Any], user_id: int, chat_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Execute a tool by dispatching to the registered handler.
        비활성화된 스킬의 도구는 SKILLS_CONFIG 를 재확인하여 차단합니다.
        """
        logger.info(f"Executing tool: {tool_name} with args: {args}")

        # 비활성화 스킬 런타임 차단
        config_key = self._SKILL_CONFIG_MAP.get(tool_name)
        if config_key:
            from config import SKILLS_CONFIG
            if not SKILLS_CONFIG.get(config_key, True):
                logger.warning(f"Tool '{tool_name}' blocked: skill '{config_key}' is disabled in config.")
                return {"error": f"'{config_key}' 스킬이 비활성화되어 있습니다. ./aibot.sh config 에서 활성화하세요."}

        # OLLAMA FIX: Flatten args
        if args and len(args) == 1:
            key = list(args.keys())[0]
            if key in ('params', 'arguments') and isinstance(args[key], dict):
                args = args[key]
        if args is None:
             args = {}

        # 1. Dispatch to Registered Handler
        if tool_name in self.tool_registry:
            handler = self.tool_registry[tool_name]
            
            # If handler is self, call local method
            if handler == self:
                if tool_name == "set_reminder":
                     return self._handle_reminder(args, user_id, chat_id, "add")
                elif tool_name == "list_reminders":
                     return self._handle_reminder(args, user_id, chat_id, "list")
                elif tool_name == "delete_reminder":
                     return self._handle_reminder(args, user_id, chat_id, "delete")
                elif tool_name == "create_schedule":
                     return self._handle_input_schedule(args, user_id, chat_id, "add")
                elif tool_name == "delete_schedule":
                     return self._handle_input_schedule(args, user_id, chat_id, "delete")
                elif tool_name == "list_schedules":
                     return self._handle_input_schedule(args, user_id, chat_id, "list")
                elif tool_name == "update_memory":
                     return self._handle_memory_update(args)
                elif tool_name == "create_skill":
                     return self._handle_create_skill(args)
                elif tool_name == "list_calendar_events" or tool_name.endswith("_calendar_event") or tool_name == "search_calendar":
                     return self._handle_calendar(tool_name, args)
            
            # If handler is a Skill instance, call execute_tool
            elif hasattr(handler, 'execute_tool'):
                try:
                    return handler.execute_tool(tool_name, args)
                except Exception as e:
                    logger.error(f"Error executing skill tool {tool_name}: {e}")
                    return {"error": str(e)}
        
        return {"error": f"Tool '{tool_name}' not implemented or recognized"}

    # --- Internal Handlers for Non-Skill Tools ---

    def _handle_reminder(self, args, user_id, chat_id, action):
        if not self.reminder_manager:
            return {"error": "Reminder manager not available"}
        if action == "add":
            expr = args.get("time_expression")
            msg = args.get("message") or args.get("reminder_text")
            rtype = args.get("reminder_type", "once")
            trigger_time = parse_time_expression(expr)
            if not trigger_time:
                return {"error": f"시간 표현을 이해하지 못했습니다: '{expr}'"}
            rid = self.reminder_manager.add_reminder(user_id, chat_id, msg, trigger_time, rtype)
            return f"알림이 {trigger_time.strftime('%Y년 %m월 %d일 %H시 %M분')}으로 성공적으로 등록되었습니다. 내용: {msg} (ID: {rid})"
        elif action == "list":
            reminders = self.reminder_manager.get_user_reminders(user_id)
            if not reminders:
                return {"reminders": [], "message": "현재 등록된 알림이 없습니다."}
            result = []
            for i, r in enumerate(reminders, 1):
                dt = datetime.datetime.fromisoformat(r['trigger_time'])
                result.append({
                    "번호": i,
                    "reminder_id": r['id'],
                    "시간": dt.strftime('%Y-%m-%d %H:%M'),
                    "내용": r['message'],
                    "유형": r.get('type', 'once')
                })
            return {"reminders": result, "총개수": len(result), "삭제방법": "delete_reminder 도구에 reminder_id 값을 그대로 전달하세요."}
        elif action == "delete":
            rid = args.get("reminder_id")
            success = self.reminder_manager.remove_reminder(rid)
            return "알림이 삭제되었습니다." if success else "해당 ID의 알림을 찾을 수 없습니다."

    def _handle_input_schedule(self, args, user_id, chat_id, action):
        if not self.cron_scheduler:
            return {"error": "Cron scheduler not available"}
        if action == "add":
            expr = args.get("time_expression")
            task = args.get("ai_task")
            sid = self.cron_scheduler.add_schedule_natural(user_id, chat_id, expr, task)
            return {"success": True, "schedule_id": sid}
        elif action == "delete":
            sid = args.get("schedule_id")
            success = self.cron_scheduler.remove_schedule(sid)
            return {"success": success, "message": "삭제되었습니다." if success else "찾을 수 없습니다."}
        elif action == "list":
            schedules = self.cron_scheduler.get_user_schedules(user_id)
            if not schedules:
                return {"schedules": [], "message": "등록된 스케줄이 없습니다."}
            # AI가 삭제 시 schedule_id를 정확히 쓸 수 있도록 번호와 ID를 명시
            result = []
            for i, s in enumerate(schedules, 1):
                result.append({
                    "번호": i,
                    "schedule_id": s.get("id"),
                    "이름": s.get("name"),
                    "cron": s.get("cron"),
                    "작업": s.get("ai_task"),
                    "활성화": s.get("enabled", True)
                })
            return {"schedules": result, "삭제방법": "delete_schedule 도구에 schedule_id 값을 그대로 전달하세요."}

    def _handle_memory_update(self, args: dict) -> str:
        """Handle update_memory tool call"""
        if not self.memory_manager:
            return "Memory manager not available"
        try:
            action = args.get("action")
            # delete_line: 특정 줄(들) 삭제 — apply_json_patch는 replace로 처리
            if action == "delete_line":
                old_val = args.get("old", "")
                if not old_val:
                    return "❌ delete_line 작업에는 'old' 값이 필요합니다."
                file_path_str = args.get("file", "")
                file_name = file_path_str.replace("memory/", "")
                target_file = self.memory_manager.base_dir / file_name
                if not target_file.exists():
                    return f"❌ 파일을 찾을 수 없습니다: {file_path_str}"
                content = target_file.read_text(encoding='utf-8')
                # 해당 텍스트를 포함하는 줄 전체를 삭제
                lines = content.splitlines(keepends=True)
                new_lines = [l for l in lines if old_val not in l]
                if len(new_lines) == len(lines):
                    return f"❌ '{old_val}' 내용을 메모리에서 찾을 수 없습니다."
                target_file.write_text("".join(new_lines), encoding='utf-8')
                self.memory_manager.refresh_memory_cache()
                removed = len(lines) - len(new_lines)
                logger.info(f"Memory delete_line: {file_path_str}, removed {removed} lines")
                return f"✅ {removed}개 항목을 삭제했습니다."

            patch = {
                "file": args.get("file"),
                "action": action,
                "old": args.get("old"),
                "new": args.get("new")
            }
            result = self.memory_manager.apply_json_patch(patch)
            if result.get("success"):
                if action == "read":
                    return result.get("content", "")
                logger.info(f"Memory updated: {patch['file']} ({action})")
                return f"✅ 기억했습니다"
            else:
                return f"❌ 기억 저장 실패: {result.get('error')}"
        except Exception as e:
            return f"❌ 기억 저장 중 오류: {str(e)}"

    def _handle_calendar(self, tool_name, args):
        if not self.calendar_client:
             return {"error": "Calendar client not available"}

        if tool_name == "list_calendar_events":
            date = args.get("date") or "today"
            days = int(args.get("days") or 1)
            events = self.calendar_client.get_events_by_date(date=date, days=days)
            if isinstance(events, dict) and "error" in events:
                return events
            if not events:
                return {"message": f"{date} 날짜에 등록된 일정이 없습니다.", "events": []}
            return {"date": date, "count": len(events), "events": events}

        if tool_name == "search_calendar":
            return self.calendar_client.search_events(args.get("query"))
            
        elif tool_name == "add_calendar_event":
            return self.calendar_client.add_event(
                args.get("summary"), args.get("start_time"), 
                args.get("end_time"), args.get("description", "Created by AI Bot")
            )
            
        elif tool_name == "delete_calendar_event":
            query = args.get("query")
            day = args.get("day")
            event_id = args.get("event_id")  # 명시적 ID 삭제 지원

            # event_id 가 직접 전달된 경우 바로 삭제
            if event_id:
                if self.calendar_client.delete_event(event_id):
                    return {"success": True, "message": f"일정(ID: {event_id})이 삭제되었습니다."}
                return {"error": f"일정(ID: {event_id}) 삭제에 실패했습니다."}

            events = self.calendar_client.search_events(query, max_results=10, day=day)
            if not events:
                return {"error": f"'{query}' 일정을 찾을 수 없습니다."}
            if isinstance(events, list) and len(events) == 1:
                eid = events[0].get('id')
                if eid and self.calendar_client.delete_event(eid):
                    return {"success": True, "message": f"'{events[0].get('summary', query)}' 일정이 삭제되었습니다."}
                return {"error": "삭제 실패"}
            elif isinstance(events, list) and len(events) > 1:
                # 여러 개 검색 시 목록 반환 — AI가 event_id를 골라 재호출
                items = []
                for i, e in enumerate(events, 1):
                    start = e.get('start', {})
                    dt = start.get('dateTime') or start.get('date', '')
                    items.append({
                        "번호": i,
                        "event_id": e.get('id'),
                        "제목": e.get('summary', '(제목 없음)'),
                        "시작": dt
                    })
                return {
                    "multiple_results": True,
                    "events": items,
                    "안내": "여러 일정이 검색되었습니다. 사용자에게 목록을 보여주고 삭제할 일정의 번호를 확인한 뒤, 해당 event_id로 delete_calendar_event를 다시 호출하세요."
                }
            return {"error": "일정 검색 오류"}

    # ------------------------------------------------------------------ #
    #  Skill 생성 핸들러                                                   #
    # ------------------------------------------------------------------ #
    def _handle_create_skill(self, args: dict) -> dict:
        """AI가 새 스킬을 생성하고 hot-load 합니다."""
        skill_name = args.get("skill_name", "").strip()
        python_code = args.get("python_code", "").strip()
        description = args.get("description", "")
        libraries = args.get("required_libraries") or []

        if not skill_name:
            return {"error": "skill_name 이 필요합니다."}
        if not python_code:
            return {"error": "python_code 가 필요합니다."}

        return self.skill_generator.add_skill(
            skill_name=skill_name,
            description=description,
            python_code=python_code,
            required_libraries=libraries,
            tool_manager=self          # hot-load 용
        )

    # ------------------------------------------------------------------ #
    #  Hot-load 공개 메서드 (SkillGenerator 가 호출)                        #
    # ------------------------------------------------------------------ #
    def hot_register_skill(self, skill_instance) -> int:
        """
        실행 중에 새 스킬을 ToolManager 에 등록합니다.
        기존 self.tools 에 새 FunctionDeclaration 을 추가하고
        tool_registry 에도 핸들러를 등록합니다.

        Returns:
            등록된 도구 수
        """
        defs = []
        if hasattr(skill_instance, 'get_tool_definitions'):
            defs = skill_instance.get_tool_definitions()
        elif hasattr(skill_instance, 'get_tool_definition'):
            defs = [skill_instance.get_tool_definition()]

        if not defs:
            logger.warning("hot_register_skill: no tool definitions found")
            return 0

        existing_names = {d.name for d in self.tools.function_declarations}
        new_declarations = list(self.tools.function_declarations)

        for d in defs:
            if isinstance(d, dict):
                name = d['name']
                if name not in existing_names:
                    new_declarations.append(types.FunctionDeclaration(**d))
                    existing_names.add(name)
                self.tool_registry[name] = skill_instance
            else:
                name = d.name
                if name not in existing_names:
                    new_declarations.append(d)
                    existing_names.add(name)
                self.tool_registry[name] = skill_instance

        # Tool 객체 교체 (다음 API 호출부터 적용)
        self.tools = types.Tool(function_declarations=new_declarations)
        logger.info(f"hot_register_skill: tools total={len(new_declarations)}")
        return len(defs)
