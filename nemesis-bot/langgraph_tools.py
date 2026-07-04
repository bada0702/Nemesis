"""
langgraph_tools.py
기존 aibot 스킬들을 LangChain Tool 형식으로 래핑합니다.
LangGraph 에이전트는 LLM이 직접 판단하여 이 도구를 호출합니다.
"""

import logging
from datetime import datetime
from typing import Optional
from langchain_core.tools import tool

# Nemesis HA 운영 도구(채팅 에이전트 전용): 상태 조회 + 수동 페일오버
from nemesis_ops_tools import nemesis_state, nemesis_failover

logger = logging.getLogger(__name__)


def _normalize(s: str) -> str:
    """공백 정규화 + 소문자 변환 (프로젝트명 매칭용)"""
    import re
    return re.sub(r'\s+', ' ', s).strip().lower()


def _find_project(projects: list, query: str) -> tuple:
    """프로젝트 목록에서 이름으로 매칭. (project_id, matched_name) 반환, 없으면 (None, None)"""
    q = _normalize(query)
    # 1차: 정규화된 이름 완전 포함
    for p in projects:
        name = p.get("name", p.get("title", ""))
        n = _normalize(name)
        if q in n or n in q:
            return p.get("id"), name
    # 2차: 단어 단위 부분 일치 (모든 쿼리 단어가 이름에 포함)
    q_words = q.split()
    for p in projects:
        name = p.get("name", p.get("title", ""))
        n = _normalize(name)
        if all(w in n for w in q_words):
            return p.get("id"), name
    return None, None


# ── 전역 스킬 인스턴스 (초기화 후 주입) ──────────────────────────────
_skills = None
_cron_scheduler = None
_reminder_manager = None
_calendar_skill = None
_skill_generator = None
_tool_manager_ref = None

def init_tools(skills_manager, cron_scheduler=None, reminder_manager=None,
               calendar_skill=None, skill_generator=None, tool_manager=None):
    """스킬 인스턴스를 주입합니다. aibot.py의 초기화 이후 호출되어야 합니다."""
    global _skills, _cron_scheduler, _reminder_manager, _calendar_skill
    global _skill_generator, _tool_manager_ref
    _skills = skills_manager
    _cron_scheduler = cron_scheduler
    _reminder_manager = reminder_manager
    _calendar_skill = calendar_skill
    _skill_generator = skill_generator
    _tool_manager_ref = tool_manager
    logger.info("LangGraph tools initialized.")


# ── 1. 날씨 ──────────────────────────────────────────────────────────

@tool
def get_weather(location: str = "서울") -> str:
    """
    지정한 도시의 현재 날씨(기온, 습도, 풍속 등)를 조회합니다.
    날씨/기온/비/눈/미세먼지 관련 질문에 사용하세요.
    location: 도시명 (예: 서울, 부산, 대구). 기본값은 서울.
    """
    if not _skills or not _skills.weather:
        return "❌ 날씨 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.weather.get_weather(location)
        if "error" in result:
            return f"❌ 날씨 조회 실패: {result['error']}"
        if hasattr(_skills.weather, 'get_weather_context'):
            return _skills.weather.get_weather_context(result)
        return str(result)
    except Exception as e:
        logger.error(f"get_weather error: {e}")
        return f"❌ 날씨 조회 중 오류: {e}"


# ── 2. 주식 ──────────────────────────────────────────────────────────

@tool
def get_stock_price(symbol: str) -> str:
    """
    주식 현재가를 조회합니다.
    symbol: 야후 파이낸스 심볼 (예: 삼성전자=005930.KS, 한국항공우주=047810.KS,
             SK하이닉스=000660.KS, NAVER=035420.KS, 코스피=^KS11,
             AAPL, TSLA, NVDA 등 해외주식은 티커 그대로).
    한국 종목명을 심볼로 변환하는 것은 이 도구를 호출하기 전에 직접 변환하세요.
    """
    if not _skills or not _skills.stock:
        return "❌ 주식 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.stock.get_stock_price(symbol)
        if "error" in result:
            return f"❌ 주가 조회 실패: {result['error']}"
        price = result.get("price", 0)
        change = result.get("change", 0)
        change_pct = result.get("change_percent", 0)
        name = result.get("name", symbol)
        currency = result.get("currency", "KRW")
        emoji = "📈" if change > 0 else "📉" if change < 0 else "➡️"
        return (
            f"📊 **{name} ({symbol})**\n"
            f"• 현재가: {price:,.0f} {currency}\n"
            f"• 변동: {change:+,.2f} ({change_pct:+.2f}%) {emoji}"
        )
    except Exception as e:
        logger.error(f"get_stock_price error: {e}")
        return f"❌ 주가 조회 중 오류: {e}"


# ── 3. 프로젝트 ────────────────────────────────────────────────────────

@tool
def list_projects() -> str:
    """등록된 모든 프로젝트 목록을 조회합니다."""
    if not _skills or not _skills.project:
        return "❌ 프로젝트 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.project.get_projects()
        # 에러 발생 시 처리
        if isinstance(result, dict) and (not result.get("success", True) or "error" in result):
            return f"❌ 프로젝트 서버 연결 실패: {result.get('message', result.get('error', '알 수 없는 오류'))}"
            
        if not result:
            return "📂 등록된 프로젝트가 없습니다."
        projects = result if isinstance(result, list) else result.get("data", result.get("projects", []))
        if not projects:
            return "📂 등록된 프로젝트가 없습니다."
        lines = ["📋 **프로젝트 목록:**\n"]
        for i, p in enumerate(projects, 1):
            name = p.get("name", p.get("title", "이름없음"))
            pid = p.get("id", "N/A")
            start = p.get("startDate", p.get("start_date", ""))
            end = p.get("endDate", p.get("end_date", ""))
            status = p.get("status", "진행중")
            progress = p.get("progress", "")
            line = f"{i}. **{name}** (ID:{pid}) {start}~{end} [{status}]"
            if progress:
                line += f" {progress}%"
            lines.append(line)
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"list_projects error: {e}")
        return f"❌ 프로젝트 조회 오류: {e}"


@tool
def list_project_tasks(project_id: Optional[int] = None, date: Optional[str] = None) -> str:
    """
    프로젝트 작업(태스크) 목록을 조회합니다.
    project_id: 특정 프로젝트 ID (없으면 전체 조회)
    date: 특정 날짜 필터 (YYYY-MM-DD 형식, 없으면 전체)
    '오늘 프로젝트 작업', '프로젝트 일정 확인' 등의 요청에 사용하세요.
    """
    if not _skills or not _skills.project:
        return "❌ 프로젝트 스킬이 비활성화되어 있습니다."
    try:
        # 날짜가 'today'이면 오늘 날짜로 변환
        if date in ("today", "오늘"):
            date = datetime.now().strftime("%Y-%m-%d")

        result = _skills.project.get_tasks(project_id=project_id, date=date)
        
        # 에러 발생 시 
        if isinstance(result, dict) and (not result.get("success", True) or "error" in result):
            return f"❌ 프로젝트 서버 연결 실패: {result.get('message', result.get('error', '알 수 없는 오류'))}"
            
        if not result:
            return f"📂 {'오늘' if date == datetime.now().strftime('%Y-%m-%d') else ''}조회된 프로젝트 작업이 없습니다."

        tasks = result if isinstance(result, list) else result.get("data", result.get("tasks", []))
        if not tasks:
            return "📂 조회된 프로젝트 작업이 없습니다."

        lines = [f"📋 **프로젝트 작업 목록** ({date or '전체'}):\n"]
        for i, t in enumerate(tasks, 1):
            title = t.get("title", t.get("name", "제목없음"))
            tid = t.get("id", "")
            status = t.get("status", "")
            assignee = t.get("assignee", t.get("assigned_to", ""))
            start = t.get("startDate", t.get("start_date", ""))
            due = t.get("dueDate", t.get("due_date", t.get("end_date", "")))
            progress = t.get("progress", "")
            description = t.get("description", t.get("content", ""))
            project_name = t.get("projectName", t.get("project_name", t.get("project", "")))
            line = f"{i}. **{title}**"
            if tid:
                line += f" (ID:{tid})"
            if project_name:
                line += f" [프로젝트:{project_name}]"
            if status:
                line += f" [{status}]"
            if start:
                line += f" 시작:{start}"
            if due:
                line += f" 종료:{due}"
            if assignee:
                line += f" 담당:{assignee}"
            if progress:
                line += f" {progress}%"
            if description:
                line += f"\n   📝 내용: {description}"
            lines.append(line)
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"list_project_tasks error: {e}")
        return f"❌ 작업 조회 오류: {e}"


@tool
def add_project_task(project_id: int, task_name: str, start_date: str, end_date: str, assignee: str = "미배정") -> str:
    """
    프로젝트에 새로운 작업(태스크)을 추가합니다.
    반드시 먼저 list_projects()로 project_id를 확인한 후 이 도구를 호출하세요.

    project_id: list_projects()에서 확인한 숫자 ID (예: 29)
    task_name: 추가할 작업 이름 (예: '강화도함 장애지원')
    start_date: 시작 날짜 YYYY-MM-DD (예: '2026-04-29')
    end_date: 종료 날짜 YYYY-MM-DD (예: '2026-04-30')
    assignee: 담당자 이름 (예: '조정원, 최일영')
    """
    if not _skills or not _skills.project:
        return "❌ 프로젝트 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.project.create_task(
            name=task_name,
            project_id=project_id,
            start_date=start_date,
            end_date=end_date,
            assignee=assignee,
        )
        if isinstance(result, dict) and (result.get("success") or result.get("id")):
            tid = result.get("id", result.get("task_id", ""))
            return f"✅ 작업 추가 완료!\n- 프로젝트 ID: {project_id}\n- 작업명: {task_name}\n- 기간: {start_date} ~ {end_date}\n- 담당자: {assignee}\n- 작업 ID: {tid}"
        return f"❌ 작업 추가 실패: {result.get('message', result.get('error', str(result)))}"
    except Exception as e:
        logger.error(f"add_project_task error: {e}")
        return f"❌ 작업 추가 오류: {e}"


@tool
def update_project_task(task_id: int, task_name: Optional[str] = None,
                        start_date: Optional[str] = None, end_date: Optional[str] = None,
                        assignee: Optional[str] = None, status: Optional[str] = None,
                        progress: Optional[int] = None, description: Optional[str] = None) -> str:
    """
    프로젝트 작업(태스크)을 수정합니다.
    task_id: 수정할 작업의 ID (list_project_tasks로 조회한 ID)
    task_name: 새 작업명 (선택)
    start_date: 새 시작일 YYYY-MM-DD (선택)
    end_date: 새 종료일 YYYY-MM-DD (선택)
    assignee: 새 담당자 (선택)
    status: 새 상태 todo/in-progress/done/delayed (선택)
    progress: 진행률 0-100 (선택)
    description: 내용 (선택)
    """
    if not _skills or not _skills.project:
        return "❌ 프로젝트 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.project.update_task(
            task_id=task_id, name=task_name,
            start_date=start_date, end_date=end_date,
            assignee=assignee, status=status,
            progress=progress, description=description,
        )
        if isinstance(result, dict) and (result.get("success") or result.get("id")):
            return f"✅ 작업(ID:{task_id}) 수정 완료"
        return f"❌ 프로젝트 작업 수정 실패: {result.get('message', result.get('error', str(result)))}"
    except Exception as e:
        logger.error(f"update_project_task error: {e}")
        return f"❌ 프로젝트 작업 수정 오류: {e}"


@tool
def delete_project_task(task_id: int) -> str:
    """
    프로젝트 작업(태스크)을 삭제합니다.
    task_id: 삭제할 작업의 ID (list_project_tasks로 조회한 ID)
    """
    if not _skills or not _skills.project:
        return "❌ 프로젝트 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.project.delete_task(task_id)
        if isinstance(result, dict) and (result.get("success") or result.get("message")):
            return f"✅ 작업(ID:{task_id}) 삭제 완료: {result.get('message', '')}"
        return f"❌ 프로젝트 작업 삭제 실패: {result.get('message', result.get('error', str(result)))}"
    except Exception as e:
        logger.error(f"delete_project_task error: {e}")
        return f"❌ 프로젝트 작업 삭제 오류: {e}"


# ── 4. 알림/스케줄 목록 ────────────────────────────────────────────────

@tool
def list_all_reminders(user_id: Optional[int] = None) -> str:
    """
    등록된 모든 알림(일회성 + 반복 스케줄)을 조회합니다.
    '알림 목록', '스케줄 확인', '등록된 알림 보여줘' 등의 요청에 사용하세요.
    """
    result_parts = []

    # 반복 스케줄 (cron_scheduler)
    if _cron_scheduler:
        try:
            schedules = _cron_scheduler.get_user_schedules(user_id) if user_id else getattr(_cron_scheduler, "schedules", [])
            if schedules:
                result_parts.append("🔁 **반복 스케줄 목록:**\n")
                for i, s in enumerate(schedules, 1):
                    enabled = "✅" if s.get("enabled", True) else "❌"
                    result_parts.append(
                        f"{i}. {enabled} **{s.get('name', '이름없음')}** (ID:`{s.get('id')}`)\n"
                        f"   ⏰ cron:`{s.get('cron', 'N/A')}` | 작업:{s.get('ai_task', 'N/A')}"
                    )
            else:
                result_parts.append("🔁 등록된 반복 스케줄이 없습니다.")
        except Exception as e:
            logger.error(f"list_all_reminders cron error: {e}")
            result_parts.append(f"🔁 스케줄 조회 오류: {e}")

    # 일회성 알림 (reminder_manager)
    if _reminder_manager:
        try:
            reminders = _reminder_manager.get_reminders(user_id=user_id) if user_id else []
            if reminders:
                result_parts.append("\n⏰ **일회성 알림 목록:**\n")
                for i, r in enumerate(reminders, 1):
                    try:
                        dt = datetime.fromisoformat(r.get("trigger_time", ""))
                        time_str = dt.strftime("%Y-%m-%d %H:%M")
                    except Exception:
                        time_str = r.get("trigger_time", "N/A")
                    result_parts.append(
                        f"{i}. ⏰ **{r.get('message', '내용없음')}** - {time_str} (ID:`{r.get('id')}`)"
                    )
            else:
                result_parts.append("\n⏰ 등록된 일회성 알림이 없습니다.")
        except Exception as e:
            logger.error(f"list_all_reminders reminder error: {e}")

    if not result_parts:
        return "📭 등록된 알림 및 스케줄이 없습니다."
    return "\n".join(result_parts)


@tool
def create_schedule(time_expression: str, ai_task: str,
                    name: str = "", user_id: Optional[int] = None,
                    chat_id: Optional[int] = None) -> str:
    """
    반복 스케줄(cron)을 새로 등록합니다.
    time_expression: 사람이 쓴 시간 표현 (예: '오전 7:00', '매일 오전 7시', '평일 오전 9시')
    ai_task: 스케줄 실행 시 AI에게 시킬 작업 (예: '서울 날씨 알려줘', '주식 종목 추천해줘')
    name: 스케줄 이름 (없으면 ai_task 사용)
    '오전 7:00 날씨 알림 설정', '매일 알림 등록' 등의 요청에 사용하세요.
    """
    if not _cron_scheduler:
        return "❌ 스케줄러가 비활성화되어 있습니다."
    try:
        from cron_scheduler import parse_natural_cron
        cron_expr = parse_natural_cron(time_expression)
        if not cron_expr:
            return f"❌ 시간 표현을 파싱할 수 없습니다: '{time_expression}'\n예시: '오전 7:00', '매일 오전 7시', '평일 오전 9시'"

        schedule_name = name or ai_task
        sid = _cron_scheduler.add_schedule(
            user_id=user_id or 0,
            chat_id=chat_id or 0,
            ai_task=ai_task,
            cron_expression=cron_expr,
            name=schedule_name,
            description=f"{time_expression}마다 실행: {ai_task}"
        )
        return (
            f"✅ **스케줄이 등록되었습니다!**\n"
            f"📋 이름: {schedule_name}\n"
            f"⏰ 실행 주기: `{cron_expr}` ({time_expression})\n"
            f"🤖 실행 작업: {ai_task}\n"
            f"🆔 스케줄 ID: `{sid}`"
        )
    except Exception as e:
        logger.error(f"create_schedule error: {e}")
        return f"❌ 스케줄 등록 오류: {e}"


@tool
def delete_schedule(schedule_id: str) -> str:
    """
    반복 스케줄을 삭제합니다.
    schedule_id: list_all_reminders로 조회한 스케줄 ID (번호가 아닌 실제 ID 문자열)
    """
    if not _cron_scheduler:
        return "❌ 스케줄러가 비활성화되어 있습니다."
    try:
        success = _cron_scheduler.remove_schedule(schedule_id)
        if success:
            return f"✅ 스케줄 (ID:`{schedule_id}`)이 삭제되었습니다."
        else:
            return f"❌ 스케줄을 찾을 수 없습니다: `{schedule_id}`\n먼저 list_all_reminders로 목록을 조회하세요."
    except Exception as e:
        return f"❌ 스케줄 삭제 오류: {e}"


# ── 5. 구글 캘린더 ────────────────────────────────────────────────────

@tool
def list_calendar_events(query: str = "", day: str = "") -> str:
    """
    구글 캘린더 일정을 조회합니다.
    query: 검색어 (없으면 전체)
    day: 날짜 필터 ('today'=오늘, 'YYYY-MM-DD', 없으면 다가오는 이벤트)
    주의: 프로젝트 관련 일정은 이 도구가 아닌 list_project_tasks를 사용하세요.
    """
    if not _calendar_skill:
        return "❌ 캘린더 스킬이 비활성화되어 있습니다."
    try:
        if day in ("today", "오늘"):
            day = "today"
        events = _calendar_skill.search_events(query=query, day=day)
        if not events:
            return f"📅 {'오늘' if day == 'today' else ''}등록된 캘린더 일정이 없습니다."
        lines = [f"📅 **캘린더 일정** ({day or '다가오는 이벤트'}):\n"]
        for i, e in enumerate(events, 1):
            title = e.get("summary", "제목없음")
            # search_events()는 start를 이미 문자열로 반환
            start_val = e.get("start", "")
            start_str = start_val if isinstance(start_val, str) else start_val.get("dateTime", start_val.get("date", ""))
            eid = e.get("id", "")
            line = f"{i}. **{title}** - {start_str}"
            if eid:
                line += f" (ID:{eid})"
            lines.append(line)
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"list_calendar_events error: {e}")
        return f"❌ 캘린더 조회 오류: {e}"


@tool
def add_calendar_event(summary: str, start_time: str, end_time: Optional[str] = None, description: str = "Created by AI Bot") -> str:
    """
    구글 캘린더에 새로운 일정을 추가합니다.
    summary: 일정 제목 (예: '마산 출장')
    start_time: 시작 시간 (ISO 8601 형식 YYYY-MM-DDTHH:MM:SS 또는 YYYY-MM-DD)
    end_time: 종료 시간 (선택사항, ISO 8601 형식)
    description: 일정 설명
    """
    if not _calendar_skill:
        return "❌ 캘린더 스킬이 비활성화되어 있습니다."
    try:
        result = _calendar_skill.add_event(summary, start_time, end_time, description)
        if isinstance(result, dict) and result.get("success"):
            return f"✅ 캘린더 일정 추가 완료: {result.get('message')} (링크: {result.get('link')})"
        return f"❌ 캘린더 일정 추가 실패: {result.get('error', '알 수 없는 오류')}"
    except Exception as e:
        logger.error(f"add_calendar_event error: {e}")
        return f"❌ 캘린더 일정 추가 오류: {e}"


@tool
def update_calendar_event(event_id: str, summary: Optional[str] = None,
                          start_time: Optional[str] = None, end_time: Optional[str] = None,
                          description: Optional[str] = None) -> str:
    """
    구글 캘린더 일정을 수정합니다.
    event_id: 수정할 일정의 ID (list_calendar_events로 조회한 ID)
    summary: 새 제목 (선택)
    start_time: 새 시작 시간 ISO 8601 형식 YYYY-MM-DDTHH:MM:SS (선택)
    end_time: 새 종료 시간 ISO 8601 형식 (선택)
    description: 새 설명 (선택)
    """
    if not _calendar_skill:
        return "❌ 캘린더 스킬이 비활성화되어 있습니다."
    try:
        result = _calendar_skill.update_event(
            event_id=event_id, summary=summary,
            start_time=start_time, end_time=end_time,
            description=description,
        )
        if isinstance(result, dict) and result.get("success"):
            return f"✅ 캘린더 일정 수정 완료: {result.get('message')} (링크: {result.get('link')})"
        return f"❌ 캘린더 일정 수정 실패: {result.get('error', '알 수 없는 오류')}"
    except Exception as e:
        logger.error(f"update_calendar_event error: {e}")
        return f"❌ 캘린더 일정 수정 오류: {e}"


@tool
def delete_calendar_event(event_id: str) -> str:
    """
    구글 캘린더 일정을 삭제합니다.
    event_id: 삭제할 일정의 ID
    힌트: list_calendar_events 도구를 사용하여 일정 목록에서 ID를 검색하세요.
    """
    if not _calendar_skill:
        return "❌ 캘린더 스킬이 비활성화되어 있습니다."
    try:
        success = _calendar_skill.delete_event(event_id)
        if success:
            return f"✅ 캘린더 일정 (ID:{event_id}) 삭제 완료"
        return "❌ 캘린더 일정 삭제 실패 (ID를 확인해주세요)"
    except Exception as e:
        logger.error(f"delete_calendar_event error: {e}")
        return f"❌ 캘린더 일정 삭제 오류: {e}"


# ── 6. 뉴스 검색 ──────────────────────────────────────────────────────

@tool
def search_news(query: str) -> str:
    """
    최신 뉴스를 검색합니다. 반드시 이 도구를 호출해서 실제 기사를 가져와야 합니다.
    절대로 뉴스를 직접 만들어내거나 추측하지 마세요.
    query: 검색어 (예: 'AI', '반도체', 'IT 이슈', '삼성전자')
    IT/기술 뉴스 요청 시에는 query에 'IT' 또는 구체적인 기술 키워드를 넣으세요.
    """
    if not _skills:
        return "❌ 스킬 매니저가 초기화되지 않았습니다."
    try:
        news_skill = getattr(_skills, "news", None)
        search_skill = getattr(_skills, "search", None)

        result = []

        it_keywords = ["it", "ai", "인공지능", "반도체", "기술", "tech", "sw", "소프트웨어", "하드웨어", "스타트업", "앱", "플랫폼", "it뉴스"]
        economy_keywords = ["경제", "금융", "주식", "코스피", "환율", "증시", "시장", "재테크", "투자"]
        is_it_query = any(kw in query.lower() for kw in it_keywords)
        is_economy_query = any(kw in query.lower() for kw in economy_keywords)

        if news_skill and is_it_query and hasattr(news_skill, "get_it_news"):
            result = news_skill.get_it_news(limit=5)
            if not result and search_skill:
                sr = search_skill.search(query + " IT 뉴스 최신")
                web = sr.get("web", {}).get("results", []) if isinstance(sr, dict) else []
                result = [{"source": "웹검색", "title": r.get("title", ""), "link": r.get("link", ""), "summary": r.get("description", "")} for r in web[:5]]
        elif news_skill and is_economy_query and hasattr(news_skill, "get_economy_news"):
            result = news_skill.get_economy_news(limit=5)
        elif news_skill:
            result = news_skill.search_news(query)
        elif search_skill:
            sr = search_skill.search(query + " 뉴스")
            web = sr.get("web", {}).get("results", []) if isinstance(sr, dict) else []
            result = [{"source": "웹검색", "title": r.get("title", ""), "link": r.get("link", ""), "summary": r.get("description", "")} for r in web[:5]]
        else:
            return "❌ 뉴스/검색 스킬이 비활성화되어 있습니다."

        if not result:
            return f"📰 '{query}' 관련 뉴스를 찾을 수 없습니다. (RSS 피드 접속 실패 가능)"

        lines = [f"📰 **'{query}' 최신 뉴스** (실시간 RSS/검색 결과):\n"]
        for i, item in enumerate(result[:5], 1):
            title = item.get("title", "제목없음")
            source = item.get("source", "")
            url = item.get("url", item.get("link", ""))
            summary = item.get("summary", "")[:120]
            line = f"{i}. **[{source}]** {title}" if source else f"{i}. {title}"
            if summary:
                line += f"\n   {summary}"
            if url:
                line += f"\n   🔗 {url}"
            lines.append(line)
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"search_news error: {e}")
        return f"❌ 뉴스 검색 오류: {e}"


# ── 7. 웹 검색 ────────────────────────────────────────────────────────

@tool
def web_search(query: str) -> str:
    """
    인터넷에서 실시간 정보를 검색합니다.
    query: 검색어
    """
    if not _skills or not _skills.search:
        return "❌ 검색 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.search.search(query)
        if hasattr(_skills.search, 'get_search_context'):
            return _skills.search.get_search_context(result)
        # search()는 {"web": {"results": [...]}, "query": ...} 형태로 반환
        if isinstance(result, dict) and "web" in result:
            items = result["web"].get("results", [])
            lines = []
            for i, item in enumerate(items[:5], 1):
                title = item.get("title", "")
                snippet = item.get("snippet", item.get("description", ""))
                url = item.get("url", item.get("link", ""))
                lines.append(f"{i}. **{title}**\n   {snippet}" + (f"\n   🔗 {url}" if url else ""))
            return "\n".join(lines) if lines else "검색 결과가 없습니다."
        if isinstance(result, list):
            lines = []
            for i, item in enumerate(result[:5], 1):
                title = item.get("title", "")
                snippet = item.get("snippet", item.get("description", ""))
                url = item.get("url", item.get("link", ""))
                lines.append(f"{i}. **{title}**\n   {snippet}" + (f"\n   🔗 {url}" if url else ""))
            return "\n".join(lines) if lines else "검색 결과가 없습니다."
        return str(result)
    except Exception as e:
        logger.error(f"web_search error: {e}")
        return f"❌ 검색 오류: {e}"


# ── 8. 시스템 상태 ────────────────────────────────────────────────────

@tool
def get_system_status() -> str:
    """서버의 CPU, 메모리, 디스크 사용량 등 시스템 상태를 조회합니다."""
    if not _skills or not _skills.system:
        return "❌ 시스템 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.system.get_system_info()
        return str(result)
    except Exception as e:
        return f"❌ 시스템 상태 조회 오류: {e}"


# ── 9. 셸 명령 실행 ──────────────────────────────────────────────────

@tool
def run_shell_command(command: str) -> str:
    """
    셸 명령어를 실행하고 결과를 반환합니다.
    메모리에 저장된 스크립트 경로(예: bash data/security_check.sh)를 실행할 때 사용합니다.
    command: 실행할 명령어 (예: 'bash data/security_check.sh', 'ls data/')
    """
    if not _skills or not _skills.system:
        return "❌ 시스템 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.system.execute_tool("run_shell_command", {"command": command})
        if isinstance(result, dict):
            output = result.get("output", result.get("stdout", str(result)))
            error = result.get("error", result.get("stderr", ""))
            if error:
                return f"⚠️ 명령 출력:\n{output}\n오류:\n{error}"
            return f"✅ 실행 결과:\n{output}"
        return str(result)
    except Exception as e:
        logger.error(f"run_shell_command error: {e}")
        return f"❌ 명령 실행 오류: {e}"


# ── 10. 주식 추천 ──────────────────────────────────────────────────────

@tool
def get_stock_recommendations() -> str:
    """오늘의 주식 종목 추천 정보를 조회합니다."""
    if not _skills or not _skills.stock_recommendation:
        return "❌ 주식 추천 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.stock_recommendation.get_recommendation_context()
        return str(result)
    except Exception as e:
        return f"❌ 주식 추천 조회 오류: {e}"


# ── 11. 한국투자증권 실계좌 매매 ─────────────────────────────────────

@tool
def kis_get_balance() -> str:
    """한국투자증권 실계좌 잔고를 조회합니다. 예수금, 총평가금액, 보유종목 목록을 반환합니다."""
    if not _skills or not hasattr(_skills, 'stock_trader'):
        return "❌ KIS 매매 스킬이 비활성화되어 있습니다."
    try:
        # 1. 기본 잔고 조회
        balance_data = _skills.stock_trader.get_balance({})
        
        # API 데이터의 지연 가능성을 고려하여, 보고서에 주의사항을 추가합니다.
        return f"{balance_data}\n\n⚠️ **주의: API 시세는 실시간 화면보다 최대 15분 지연될 수 있습니다.**"
    except Exception as e:
        return f"❌ 잔고 조회 오류: {e}"


@tool
def kis_buy_stock(symbol: str, quantity: int, price: str = "0") -> str:
    """
    한국투자증권 실계좌로 주식을 매수합니다.
    symbol: 종목코드 6자리 (예: 005930)
    quantity: 매수 수량
    price: 매수 가격 (0 또는 생략 시 시장가)
    주의: 실제 돈이 사용됩니다. 신중하게 호출하세요.
    """
    if not _skills or not hasattr(_skills, 'stock_trader'):
        return "❌ KIS 매매 스킬이 비활성화되어 있습니다."
    try:
        return _skills.stock_trader.buy_stock({"symbol": symbol, "quantity": quantity, "price": price})
    except Exception as e:
        return f"❌ 매수 오류: {e}"


@tool
def kis_sell_stock(symbol: str, quantity: int) -> str:
    """
    한국투자증권 실계좌로 주식을 시장가 매도합니다.
    symbol: 종목코드 6자리 (예: 005930)
    quantity: 매도 수량
    주의: 실제 돈이 사용됩니다. 신중하게 호출하세요.
    """
    if not _skills or not hasattr(_skills, 'stock_trader'):
        return "❌ KIS 매매 스킬이 비활성화되어 있습니다."
    try:
        return _skills.stock_trader.sell_stock({"symbol": symbol, "quantity": quantity})
    except Exception as e:
        return f"❌ 매도 오류: {e}"


@tool
def kis_get_stock_price(symbol: str) -> str:
    """
    한국투자증권 API로 국내 주식 현재가를 실시간 조회합니다.
    symbol: 종목코드 6자리 (예: 005930=삼성전자, 247540=에코프로비엠)
    """
    if not _skills or not hasattr(_skills, 'stock_trader'):
        return "❌ KIS 매매 스킬이 비활성화되어 있습니다."
    try:
        import json
        from pathlib import Path
        import requests, os
        token_file = Path("/root/aibot/data/kis_token.json")
        if not token_file.exists():
            return "❌ KIS 토큰이 없습니다. 먼저 kis_get_balance를 호출하세요."
        token = json.loads(token_file.read_text())["token"]
        app_key = os.getenv("KIS_APP_KEY", "")
        app_secret = os.getenv("KIS_APP_SECRET", "")
        headers = {
            "Authorization": f"Bearer {token}",
            "appkey": app_key,
            "appsecret": app_secret,
            "tr_id": "FHKST01010100",
        }
        resp = requests.get(
            "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price",
            headers=headers,
            params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": symbol},
            timeout=10,
        )
        data = resp.json()
        if data.get("rt_cd") != "0":
            return f"❌ 조회 실패: {data.get('msg1','')}"
        def _safe_int(val):
            try:
                if val is None or str(val).strip() == "": return 0
                return int(float(val))
            except Exception:
                logger.debug("숫자 변환 실패, 0으로 폴백: %r", val)
                return 0

        out = data.get("output", {})
        price = _safe_int(out.get("stck_prpr", 0))
        change_pct = out.get("prdy_ctrt", "0")
        name = out.get("hts_kor_isnm", symbol)
        vol = _safe_int(out.get("acml_vol", 0))
        emoji = "📈" if float(change_pct) > 0 else "📉" if float(change_pct) < 0 else "➡️"
        return (
            f"📊 **{name} ({symbol})**\n"
            f"• 현재가: {price:,}원\n"
            f"• 등락률: {change_pct}% {emoji}\n"
            f"• 거래량: {vol:,}"
        )
    except Exception as e:
        return f"❌ 현재가 조회 오류: {e}"


# ── 현재 시간 ────────────────────────────────────────────────────

@tool
def get_current_datetime() -> str:
    """현재 날짜와 시간을 반환합니다."""
    now = datetime.now()
    weekdays = ["월", "화", "수", "목", "금", "토", "일"]
    wd = weekdays[now.weekday()]
    return f"{now.strftime('%Y년 %m월 %d일')} ({wd}요일) {now.strftime('%H시 %M분 %S초')}"


# ── 11. 파일 관리 (data/, memory/, scripts/ 등) ───────────────────────

@tool
def list_files(path: str = ".") -> str:
    """
    지정 디렉토리의 파일/폴더 목록을 조회합니다.
    path: 조회할 경로 (예: 'memory/', 'data/', '.' 은 전체 루트)
    memory 파일 목록 확인, data 파일 확인 등에 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        files = _skills.files.list_files(path)
        if not files:
            return f"📂 '{path}' 디렉토리가 비어 있습니다."
        return f"📂 **{path}** 목록:\n" + "\n".join(files)
    except Exception as e:
        return f"❌ 파일 목록 조회 오류: {e}"


@tool
def read_file(path: str) -> str:
    """
    파일 내용을 읽습니다.
    path: 읽을 파일 경로 (예: 'memory/SCRIPTS.md', 'data/security_check.sh')
    memory 파일 내용 확인, 스크립트 내용 확인 등에 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        content = _skills.files.read_file(path)
        return f"📄 **{path}** 내용:\n\n{content}"
    except Exception as e:
        return f"❌ 파일 읽기 오류: {e}"


@tool
def write_file(path: str, content: str) -> str:
    """
    파일을 생성하거나 내용을 덮어씁니다.
    path: 저장할 경로 (예: 'memory/SCRIPTS.md', 'data/report.txt', 'data/check.sh')
    content: 저장할 내용
    .sh/.py 파일은 저장 즉시 실행권한(chmod +x)이 자동 부여됩니다.
    memory/ 파일 수정, data/ 파일 생성, 스크립트 작성 등에 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.files.write_file(path, content)
        return f"✅ {result}"
    except Exception as e:
        return f"❌ 파일 쓰기 오류: {e}"


@tool
def delete_file(path: str) -> str:
    """
    파일을 삭제합니다.
    path: 삭제할 파일 경로 (예: 'memory/OLD.md', 'data/tmp.txt')
    memory 파일 삭제, data 파일 삭제 등에 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        result = _skills.files.delete_file(path)
        return f"✅ {result}"
    except Exception as e:
        return f"❌ 파일 삭제 오류: {e}"


# ── 12. 메모리 CRUD (memory/*.md 전용) ────────────────────────────────

@tool
def memory_read(file: str) -> str:
    """
    memory/ 폴더의 .md 파일 전체 내용을 읽습니다.
    file: 파일명 (예: 'MEMORY.md', 'SOUL.md', 'USER.md', 'SCRIPTS.md', 'AGENTS.md')
    사용자가 메모리 내용 확인, 기억 조회 등을 요청할 때 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        path = f"memory/{file}" if not file.startswith("memory/") else file
        content = _skills.files.read_file(path)
        return f"📄 **{path}**:\n\n{content}"
    except Exception as e:
        return f"❌ 메모리 읽기 오류: {e}"


@tool
def memory_append(file: str, content: str) -> str:
    """
    memory/ 폴더의 .md 파일에 내용을 추가(append)합니다.
    file: 파일명 (예: 'MEMORY.md', 'SCRIPTS.md')
    content: 추가할 내용
    사용자가 "기억해", "메모해", "추가해" 등을 요청할 때 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        path = f"memory/{file}" if not file.startswith("memory/") else file
        existing = _skills.files.read_file(path)
        if existing.startswith("Error"):
            existing = ""
        new_content = existing.rstrip() + "\n\n" + content.strip() + "\n"
        _skills.files.write_file(path, new_content)
        return f"✅ {path}에 내용 추가 완료"
    except Exception as e:
        return f"❌ 메모리 추가 오류: {e}"


@tool
def memory_replace(file: str, old_text: str, new_text: str) -> str:
    """
    memory/ 폴더의 .md 파일에서 특정 텍스트를 찾아 교체합니다.
    file: 파일명 (예: 'MEMORY.md')
    old_text: 찾을 기존 텍스트
    new_text: 교체할 새 텍스트
    사용자가 "수정해", "변경해", "바꿔" 등을 요청할 때 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        path = f"memory/{file}" if not file.startswith("memory/") else file
        content = _skills.files.read_file(path)
        if old_text not in content:
            return f"❌ '{old_text}' 텍스트를 {path}에서 찾을 수 없습니다."
        new_content = content.replace(old_text, new_text, 1)
        _skills.files.write_file(path, new_content)
        return f"✅ {path} 수정 완료"
    except Exception as e:
        return f"❌ 메모리 수정 오류: {e}"


@tool
def memory_delete_line(file: str, keyword: str) -> str:
    """
    memory/ 폴더의 .md 파일에서 특정 키워드가 포함된 줄(들)을 삭제합니다.
    file: 파일명 (예: 'MEMORY.md')
    keyword: 삭제할 줄에 포함된 텍스트
    사용자가 "삭제해", "지워줘", "없애줘" 등 메모리 항목 삭제를 요청할 때 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        path = f"memory/{file}" if not file.startswith("memory/") else file
        content = _skills.files.read_file(path)
        lines = content.splitlines(keepends=True)
        new_lines = [l for l in lines if keyword not in l]
        removed = len(lines) - len(new_lines)
        if removed == 0:
            return f"❌ '{keyword}' 키워드가 포함된 줄을 찾을 수 없습니다."
        _skills.files.write_file(path, "".join(new_lines))
        return f"✅ {removed}개 줄 삭제 완료 ({path})"
    except Exception as e:
        return f"❌ 메모리 삭제 오류: {e}"


@tool
def memory_list_files() -> str:
    """
    memory/ 폴더의 모든 .md 파일 목록을 조회합니다.
    사용자가 "메모리 파일 목록", "어떤 파일 있어" 등을 요청할 때 사용하세요.
    """
    if not _skills or not _skills.files:
        return "❌ 파일 스킬이 비활성화되어 있습니다."
    try:
        files = _skills.files.list_files("memory")
        return "📂 **memory/ 파일 목록:**\n" + "\n".join(files)
    except Exception as e:
        return f"❌ 메모리 목록 조회 오류: {e}"


# ── 13. 작업일지용 프로젝트 작업 상세 조회 ────────────────────────────

@tool
def get_project_tasks_detail(project_id: Optional[int] = None, date: Optional[str] = None) -> str:
    """
    작업일지 작성을 위한 프로젝트 작업 상세 정보를 조회합니다.
    description(작업내용), assignee(담당자), startDate, endDate, 프로젝트명 등 모든 필드를 포함합니다.
    '작업일지 작성', '업무 보고서 만들어' 등의 요청에 반드시 이 도구를 먼저 사용하세요.
    project_id: 특정 프로젝트 ID (없으면 전체 조회)
    date: 날짜 필터 (YYYY-MM-DD 형식 또는 'today'/'오늘')
    """
    if not _skills or not _skills.project:
        return "❌ 프로젝트 스킬이 비활성화되어 있습니다."
    try:
        if date in ("today", "오늘"):
            date = datetime.now().strftime("%Y-%m-%d")

        result = _skills.project.get_tasks(project_id=project_id)

        if isinstance(result, dict) and (not result.get("success", True) or "error" in result):
            return f"❌ 프로젝트 서버 연결 실패: {result.get('message', result.get('error', '알 수 없는 오류'))}"

        tasks = result if isinstance(result, list) else result.get("data", result.get("tasks", []))
        if not tasks:
            return "📂 조회된 프로젝트 작업이 없습니다."

        # 날짜 필터링
        if date:
            filtered = []
            for t in tasks:
                s = t.get("startDate", t.get("start_date", ""))
                e = t.get("endDate", t.get("due_date", t.get("end_date", "")))
                if (s and s <= date) and (not e or e >= date):
                    filtered.append(t)
                elif s == date or e == date:
                    filtered.append(t)
            if filtered:
                tasks = filtered

        lines = [f"📋 **작업일지용 프로젝트 작업 상세** ({date or '전체'}):\n",
                 "※ 아래 실제 데이터만 사용하여 작업일지를 작성하세요. 임의로 내용을 추가하지 마세요.\n"]

        for i, t in enumerate(tasks, 1):
            title = t.get("title", t.get("name", "제목없음"))
            tid = t.get("id", "")
            status = t.get("status", "")
            assignee = t.get("assignee", t.get("assigned_to", ""))
            start = t.get("startDate", t.get("start_date", ""))
            end = t.get("endDate", t.get("due_date", t.get("end_date", "")))
            progress = t.get("progress", "")
            description = t.get("description", t.get("content", ""))
            project_name = t.get("projectName", t.get("project_name", t.get("project", "")))
            location = t.get("location", "")

            lines.append(f"--- 작업 {i} ---")
            lines.append(f"  작업명: {title}")
            if tid:
                lines.append(f"  작업ID: {tid}")
            if project_name:
                lines.append(f"  프로젝트: {project_name}")
            if start or end:
                lines.append(f"  기간: {start} ~ {end}")
            if location:
                lines.append(f"  장소: {location}")
            if assignee:
                lines.append(f"  담당자(작업인원): {assignee}")
            if status:
                lines.append(f"  상태: {status}")
            if progress:
                lines.append(f"  진행률: {progress}%")
            if description:
                lines.append(f"  작업내용(description):\n{description}")
            else:
                lines.append(f"  작업내용(description): (없음)")
            lines.append("")

        lines.append("※ 위 데이터를 그대로 사용하세요. description 필드가 비어있으면 '내용 없음'으로 표기하세요.")
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"get_project_tasks_detail error: {e}")
        return f"❌ 작업 상세 조회 오류: {e}"


# ── 14. 코딩 에이전트 ────────────────────────────────────────────────

@tool
def run_python_code(code: str, timeout: int = 30) -> str:
    """
    Python 코드를 즉시 실행하고 출력 결과를 반환합니다.
    code: 실행할 Python 코드 (여러 줄 가능)
    timeout: 실행 제한 시간 (초, 기본 30)
    코드 테스트, 계산, 데이터 처리 등에 사용하세요.
    """
    try:
        from skills.coding_agent import CodingAgentSkill
        return CodingAgentSkill().run_python_code(code, timeout)
    except Exception as e:
        return f"❌ 코드 실행 오류: {e}"


@tool
def save_and_run(filename: str, code: str, timeout: int = 30) -> str:
    """
    코드를 workspace/ 폴더에 저장하고 실행합니다.
    filename: 저장할 파일명 (예: hello.py, check.sh)
    code: 저장할 코드 내용
    timeout: 실행 제한 시간 (초)
    Python(.py)과 Shell(.sh) 파일 지원.
    """
    try:
        from skills.coding_agent import CodingAgentSkill
        return CodingAgentSkill().save_and_run(filename, code, timeout)
    except Exception as e:
        return f"❌ 저장/실행 오류: {e}"


@tool
def install_package(package_name: str) -> str:
    """
    pip으로 Python 패키지를 설치합니다.
    package_name: 설치할 패키지명 (예: requests, pandas, beautifulsoup4)
    새 스킬 생성 전 필요한 라이브러리가 없을 때 사용하세요.
    """
    try:
        from skills.coding_agent import CodingAgentSkill
        return CodingAgentSkill().install_package(package_name)
    except Exception as e:
        return f"❌ 패키지 설치 오류: {e}"


@tool
def analyze_code(code: str, language: str = "python") -> str:
    """
    코드의 문법 오류를 분석합니다. 현재 Python만 지원.
    code: 분석할 코드
    language: 언어 (python)
    """
    try:
        from skills.coding_agent import CodingAgentSkill
        return CodingAgentSkill().analyze_code(code, language)
    except Exception as e:
        return f"❌ 코드 분석 오류: {e}"


@tool
def list_workspace() -> str:
    """workspace/ 폴더의 파일 목록을 조회합니다."""
    try:
        from skills.coding_agent import CodingAgentSkill
        return CodingAgentSkill().list_workspace()
    except Exception as e:
        return f"❌ 목록 조회 오류: {e}"


# ── 15. YouTube 검색 ────────────────────────────────────────────────

@tool
def search_youtube(query: str, max_results: int = 5) -> str:
    """
    YouTube에서 영상을 실제로 검색합니다. 제목, 요약, 링크를 반환합니다.
    query: 검색어 (예: '아이유 좋은날', '파이썬 튜토리얼', '삼성전자 뉴스')
    max_results: 최대 결과 수 (기본 5)
    유튜브 영상 검색, 유튜브에서 찾아줘 요청에 사용하세요.
    """
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS
        import re
        results = []
        with DDGS() as ddgs:
            raw = list(ddgs.text(f"site:youtube.com {query}", max_results=max_results * 2))
        for r in raw:
            url = r.get("href", "")
            if "youtube.com/watch" in url or "youtu.be/" in url:
                title = r.get("title", "").replace(" - YouTube", "").strip()
                desc = re.sub(r"\s+", " ", r.get("body", ""))[:200]
                results.append({"title": title, "url": url, "description": desc})
                if len(results) >= max_results:
                    break
        if not results:
            return f"❌ '{query}' YouTube 검색 결과가 없습니다."
        lines = [f"🎥 **YouTube 검색: {query}**\n"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. **{r['title']}**")
            if r.get("description"):
                lines.append(f"   {r['description'][:120]}")
            lines.append(f"   🔗 {r['url']}")
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"search_youtube error: {e}")
        return f"❌ YouTube 검색 오류: {e}"


# ── 15. 동적 스킬 실행 브리지 ────────────────────────────────────────

@tool
def execute_registered_skill(skill_name: str, tool_name: str, params: str = "{}") -> str:
    """
    create_skill로 생성한 신규 스킬의 도구를 즉시 실행합니다.
    skill_name: 스킬 파일명 (예: 'youtube', 'translate', 'rss')
    tool_name: 실행할 도구명 (예: 'search_youtube', 'translate_text')
    params: JSON 문자열 형태의 파라미터 (예: '{"query": "아이유"}')
    create_skill로 만든 스킬을 바로 테스트하거나 실행할 때 사용하세요.
    """
    import json
    from pathlib import Path
    import importlib.util
    try:
        args = json.loads(params) if params and params != "{}" else {}
    except json.JSONDecodeError:
        return f"❌ params가 올바른 JSON 형식이 아닙니다: {params}"
    try:
        skills_dir = Path(__file__).resolve().parent / "skills"
        module_name = skill_name.lower().replace("skill", "").strip("_")
        skill_file = skills_dir / f"{module_name}.py"
        if not skill_file.exists():
            return f"❌ 스킬 파일 없음: skills/{module_name}.py\nlist_available_skills()로 목록 확인하세요."
        spec = importlib.util.spec_from_file_location(f"skills.{module_name}", skill_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # 클래스 이름 찾기
        import inspect
        cls = None
        for name, obj in inspect.getmembers(module, inspect.isclass):
            if obj.__module__ == module.__name__:
                cls = obj
                break
        if not cls:
            return f"❌ skills/{module_name}.py 에서 클래스를 찾을 수 없습니다."
        instance = cls()
        if hasattr(instance, "execute_tool"):
            return instance.execute_tool(tool_name, args)
        return f"❌ {cls.__name__}에 execute_tool() 메서드가 없습니다."
    except Exception as e:
        logger.error(f"execute_registered_skill error: {e}")
        return f"❌ 스킬 실행 오류: {e}"


# ── 16. 자기진화: 스킬 생성/수정 ──────────────────────────────────────

# SKILL.md 문서 경로 헬퍼
def _skill_doc_path(skill_name: str):
    from pathlib import Path
    module_name = skill_name.lower().replace("skill", "").strip("_")
    docs_dir = Path(__file__).resolve().parent / "skills" / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    return docs_dir / f"{module_name}.md"


@tool
def skill_read_doc(skill_name: str) -> str:
    """
    스킬의 SKILL.md 문서를 읽습니다. (정의, 사용법, 제약사항, 실패 경험 포함)
    skill_name: 스킬 이름 (예: 'weather', 'project', 'stock')
    스킬 사용 전 제약사항이나 실패 경험을 확인할 때 사용하세요.
    """
    try:
        doc_path = _skill_doc_path(skill_name)
        if not doc_path.exists():
            return f"📄 `{skill_name}` 스킬 문서가 없습니다. skill_write_doc으로 생성하세요."
        return f"📄 **{skill_name} SKILL.md**:\n\n{doc_path.read_text(encoding='utf-8')}"
    except Exception as e:
        return f"❌ 스킬 문서 읽기 오류: {e}"


@tool
def skill_write_doc(skill_name: str, content: str) -> str:
    """
    스킬의 SKILL.md 문서를 작성하거나 덮어씁니다.
    skill_name: 스킬 이름
    content: 마크다운 형식의 전체 문서 내용
    스킬 생성·수정 후 또는 제약사항 발견 시 문서를 업데이트하세요.
    """
    try:
        doc_path = _skill_doc_path(skill_name)
        doc_path.write_text(content, encoding="utf-8")
        return f"✅ `{skill_name}` SKILL.md 저장 완료: {doc_path}"
    except Exception as e:
        return f"❌ 스킬 문서 쓰기 오류: {e}"


@tool
def skill_log_failure(skill_name: str, error: str, cause: str, fix: str) -> str:
    """
    스킬 실패 경험을 SKILL.md에 기록합니다. (자가 학습 핵심 도구)
    skill_name: 실패한 스킬 이름
    error: 발생한 오류 메시지 요약
    cause: 실패 원인 분석
    fix: 해결책 또는 회피 방법
    도구 호출 실패, 예상치 못한 오류, 잘못된 파라미터 사용 후 반드시 호출하세요.
    """
    try:
        from datetime import datetime
        doc_path = _skill_doc_path(skill_name)
        now = datetime.now().strftime("%Y-%m-%d")
        row = f"| {now} | {error} | {cause} | {fix} |"

        if doc_path.exists():
            content = doc_path.read_text(encoding="utf-8")
            if "## 실패 경험 기록" in content:
                # 테이블 마지막 행 뒤에 삽입
                lines = content.splitlines()
                insert_idx = len(lines)
                for i, line in enumerate(lines):
                    if "## 실패 경험 기록" in line:
                        # 헤더와 구분선 건너뛰고 테이블 끝 찾기
                        for j in range(i + 1, len(lines)):
                            if lines[j].startswith("|"):
                                insert_idx = j + 1
                            elif j > i + 2 and not lines[j].startswith("|"):
                                break
                        break
                lines.insert(insert_idx, row)
                doc_path.write_text("\n".join(lines), encoding="utf-8")
            else:
                content += f"\n\n## 실패 경험 기록\n| 날짜 | 오류 | 원인 | 해결책 |\n|------|------|------|--------|\n{row}\n"
                doc_path.write_text(content, encoding="utf-8")
        else:
            doc_path.write_text(
                f"# {skill_name}\n\n## 실패 경험 기록\n| 날짜 | 오류 | 원인 | 해결책 |\n|------|------|------|--------|\n{row}\n",
                encoding="utf-8"
            )
        return f"✅ `{skill_name}` 실패 경험 기록 완료."
    except Exception as e:
        return f"❌ 실패 기록 오류: {e}"


@tool
def create_skill(skill_name: str, description: str, python_code: str,
                 libraries: str = "") -> str:
    """
    새로운 스킬을 동적으로 생성하고 즉시 AI에 등록합니다. (자기진화 핵심 도구)
    skill_name: 스킬 이름 (예: 'YouTube', 'RSS', 'Translate')
    description: 스킬 설명
    python_code: 완전한 Python 클래스 코드 (get_tool_definitions() 메서드 포함)
    libraries: 설치할 pip 패키지 (쉼표로 구분, 예: 'requests,beautifulsoup4')
    새로운 기능이 필요하거나 사용자가 스킬 생성을 요청할 때 이 도구를 사용하세요.
    """
    if not _skill_generator:
        return "❌ 스킬 생성기가 초기화되지 않았습니다."
    try:
        lib_list = [l.strip() for l in libraries.split(",") if l.strip()] if libraries else []
        result = _skill_generator.add_skill(
            skill_name=skill_name,
            description=description,
            python_code=python_code,
            required_libraries=lib_list if lib_list else None,
            tool_manager=_tool_manager_ref,
        )
        if result.get("success"):
            tools = result.get("registered_tools", [])
            # SKILL.md 자동 생성
            try:
                from datetime import datetime
                doc_path = _skill_doc_path(skill_name)
                if not doc_path.exists():
                    tool_lines = "\n".join(f"- `{t}` — (설명 추가 필요)" for t in tools)
                    doc_content = f"""# {skill_name} — {description}

## 설명
{description}

## 도구 목록
{tool_lines}

## 사용 예시
(생성 후 직접 추가하세요)

## 제약사항
(발견된 제약사항을 기록하세요)

## 실패 경험 기록
| 날짜 | 오류 | 원인 | 해결책 |
|------|------|------|--------|
| {datetime.now().strftime('%Y-%m-%d')} | — | 신규 생성 | — |
"""
                    doc_path.write_text(doc_content, encoding="utf-8")
                    logger.info(f"SKILL.md auto-created: {doc_path}")
            except Exception as doc_err:
                logger.warning(f"SKILL.md auto-create failed: {doc_err}")

            return (
                f"✅ **스킬 '{result['skill_name']}' 생성 완료!**\n"
                f"📁 파일: `{result['module_file']}`\n"
                f"🔧 등록된 도구: {tools}\n"
                f"📦 설치된 라이브러리: {result.get('libraries', {})}\n"
                f"📄 SKILL.md 자동 생성: `skills/docs/{skill_name.lower()}.md`\n"
                f"💡 봇 재시작 없이 즉시 사용 가능합니다."
            )
        return f"❌ 스킬 생성 실패: {result.get('error', '알 수 없는 오류')}"
    except Exception as e:
        logger.error(f"create_skill error: {e}")
        return f"❌ 스킬 생성 오류: {e}"


@tool
def modify_skill(skill_name: str, python_code: str) -> str:
    """
    기존 스킬의 소스코드를 수정하고 즉시 재로드합니다. (자기진화 핵심 도구)
    skill_name: 수정할 스킬 이름 (예: 'weather', 'news', 'stock')
    python_code: 새로운 완전한 Python 클래스 코드
    기존 스킬의 버그를 수정하거나 기능을 개선할 때 사용하세요.
    """
    if not _skill_generator:
        return "❌ 스킬 생성기가 초기화되지 않았습니다."
    try:
        from pathlib import Path
        import importlib.util
        skills_dir = Path(__file__).resolve().parent / "skills"
        # 모듈명 정규화
        module_name = skill_name.lower().replace("skill", "").strip("_")
        skill_file = skills_dir / f"{module_name}.py"
        if not skill_file.exists():
            return f"❌ 스킬 파일을 찾을 수 없습니다: skills/{module_name}.py\n사용 가능한 스킬을 list_available_skills로 확인하세요."
        skill_file.write_text(python_code, encoding="utf-8")
        logger.info(f"Skill modified: {skill_file}")
        # hot-reload
        spec = importlib.util.spec_from_file_location(f"skills.{module_name}", skill_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # SKILL.md 수정 이력 자동 기록
        try:
            from datetime import datetime
            doc_path = _skill_doc_path(module_name)
            now = datetime.now().strftime("%Y-%m-%d %H:%M")
            note = f"\n> 🔄 [{now}] 코드 수정됨 (modify_skill 호출)\n"
            if doc_path.exists():
                doc_path.write_text(doc_path.read_text(encoding="utf-8") + note, encoding="utf-8")
        except Exception:
            logger.warning("스킬 변경 문서 노트 기록 실패(무시)", exc_info=True)

        return (
            f"✅ **스킬 '{module_name}' 수정 완료!**\n"
            f"📁 파일: `skills/{module_name}.py`\n"
            f"📄 SKILL.md 수정 이력 기록됨\n"
            f"🔄 핫리로드 완료. 즉시 적용됩니다."
        )
    except Exception as e:
        logger.error(f"modify_skill error: {e}")
        return f"❌ 스킬 수정 오류: {e}"


@tool
def list_available_skills() -> str:
    """
    현재 사용 가능한 모든 스킬과 등록된 도구 목록을 조회합니다.
    새 스킬 생성 전 중복 확인이나 현재 능력 파악에 사용하세요.
    """
    try:
        from pathlib import Path
        skills_dir = Path(__file__).resolve().parent / "skills"
        built_in = ["weather", "news", "stock", "search", "system", "files", "notes", "tasks", "ftp", "server"]
        lines = ["🤖 **AI 스킬 현황:**\n"]

        # skills/ 디렉토리 동적 스킬
        docs_dir = skills_dir / "docs"
        dynamic = []
        if skills_dir.exists():
            for f in sorted(skills_dir.glob("*.py")):
                if f.stem != "__init__":
                    tag = "✅ 기본" if f.stem in built_in else "⚡ 동적"
                    doc_tag = " 📄" if docs_dir.exists() and (docs_dir / f"{f.stem}.md").exists() else ""
                    dynamic.append(f"• `{f.stem}` [{tag}]{doc_tag}")
        if dynamic:
            lines.append("**스킬 파일:**")
            lines.extend(dynamic)

        # 현재 등록된 LangGraph 도구 목록
        lines.append("\n**등록된 LangGraph 도구:**")
        for t in ALL_TOOLS:
            lines.append(f"• `{t.name}` — {(t.description or '').splitlines()[0][:60]}")
        return "\n".join(lines)
    except Exception as e:
        return f"❌ 스킬 목록 조회 오류: {e}"


@tool
def read_skill_code(skill_name: str) -> str:
    """
    skills/ 디렉토리의 특정 스킬 소스코드를 읽습니다.
    skill_name: 스킬 파일명 (예: 'weather', 'news', 'stock', 'custom_skill')
    스킬 수정 전 기존 코드를 확인하거나 학습할 때 사용하세요.
    """
    try:
        from pathlib import Path
        skills_dir = Path(__file__).resolve().parent / "skills"
        module_name = skill_name.lower().replace("skill", "").strip("_")
        skill_file = skills_dir / f"{module_name}.py"
        if not skill_file.exists():
            # skills.py에서 해당 클래스 찾기
            main_skills = Path(__file__).resolve().parent / "skills.py"
            if main_skills.exists():
                return f"📄 **skills/{module_name}.py** 없음. 메인 skills.py 참조:\n{main_skills.read_text(encoding='utf-8')[:3000]}"
            return f"❌ '{module_name}' 스킬을 찾을 수 없습니다."
        code = skill_file.read_text(encoding="utf-8")
        return f"📄 **skills/{module_name}.py** ({len(code)} chars):\n\n```python\n{code}\n```"
    except Exception as e:
        return f"❌ 스킬 코드 읽기 오류: {e}"


@tool
def self_diagnose() -> str:
    """
    AI 시스템 자가진단: 스킬 상태, 스케줄 이상, 메모리 상태, 개선 필요사항을 분석합니다.
    시스템 점검이나 개선점 파악에 사용하세요.
    """
    try:
        import psutil
        from pathlib import Path
        from datetime import datetime
        issues = []
        suggestions = []
        report = ["🔍 **AI 자가진단 보고서**\n"]

        # 1. 스킬 상태
        skills_ok = []
        skills_fail = []
        if _skills:
            for attr in ["weather", "news", "stock", "search", "system", "files"]:
                if getattr(_skills, attr, None):
                    skills_ok.append(attr)
                else:
                    skills_fail.append(attr)
        report.append(f"**스킬 상태:** ✅ {skills_ok} / ❌ {skills_fail}")
        if skills_fail:
            issues.append(f"비활성 스킬: {skills_fail}")

        # 2. 스케줄 상태
        if _cron_scheduler:
            schedules = _cron_scheduler.schedules
            enabled = [s for s in schedules if s.get("enabled")]
            report.append(f"**스케줄:** {len(enabled)}개 활성 / {len(schedules)}개 전체")
            for s in enabled[:3]:
                report.append(f"  • {s.get('name','?')} [{s.get('cron','?')}] 마지막실행:{s.get('last_run','없음')}")

        # 3. 메모리 파일
        mem_dir = Path(__file__).resolve().parent / "memory"
        mem_files = list(mem_dir.glob("*.md")) if mem_dir.exists() else []
        report.append(f"**메모리 파일:** {len(mem_files)}개")

        # 4. 시스템 리소스
        cpu = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()
        report.append(f"**시스템:** CPU {cpu:.1f}% | RAM {mem.percent:.1f}% ({mem.used//1024//1024}MB/{mem.total//1024//1024}MB)")
        if mem.percent > 85:
            issues.append("메모리 사용량이 높습니다")

        # 5. 동적 스킬
        skills_dir = Path(__file__).resolve().parent / "skills"
        dynamic = [f.stem for f in skills_dir.glob("*.py") if f.stem != "__init__"] if skills_dir.exists() else []
        report.append(f"**동적 스킬 파일:** {len(dynamic)}개 — {dynamic}")

        # 6. 개선 제안
        if not getattr(_skills, "stock_recommendation", None):
            suggestions.append("주식 추천 스킬 미활성 → create_skill로 생성 가능")
        if len(enabled if _cron_scheduler else []) == 0:
            suggestions.append("활성 스케줄 없음 → create_schedule로 등록 가능")

        if issues:
            report.append(f"\n⚠️ **발견된 문제:** {issues}")
        if suggestions:
            report.append(f"\n💡 **개선 제안:** {suggestions}")

        report.append(f"\n🕐 진단 시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        return "\n".join(report)
    except Exception as e:
        return f"❌ 자가진단 오류: {e}"


# ── 15. 스킬 설정 변경 (.env 직접 수정) ─────────────────────────────

@tool
def set_skill_config(skill_name: str, enabled: bool) -> str:
    """
    .env 파일의 스킬 활성화/비활성화 설정을 직접 변경합니다.
    "gmail 활성화", "날씨 스킬 꺼줘" 같은 요청에 즉시 사용하세요.
    skill_name: 스킬 이름 (gmail, weather, news, stock, crypto 등)
    enabled: True=활성화, False=비활성화
    """
    import re
    from pathlib import Path
    env_file = Path(__file__).resolve().parent / ".env"
    if not env_file.exists():
        return "❌ .env 파일을 찾을 수 없습니다."

    key = f"SKILL_{skill_name.upper()}_ENABLED"
    value = "True" if enabled else "False"
    content = env_file.read_text(encoding="utf-8")
    pattern = re.compile(rf"^{key}=.*$", re.MULTILINE)

    if pattern.search(content):
        new_content = pattern.sub(f"{key}={value}", content)
    else:
        new_content = content.rstrip() + f"\n{key}={value}\n"

    env_file.write_text(new_content, encoding="utf-8")
    action = "활성화" if enabled else "비활성화"
    return (
        f"✅ {skill_name} 스킬 {action} 완료 ({key}={value})\n"
        "⚠️ 변경사항 적용을 위해 봇을 재시작해야 합니다. "
        "재시작: run_shell_command(\"systemctl restart aibot\" 또는 해당 서비스명)"
    )


# ── 16. 날씨 상세 예보 ────────────────────────────────────────────────

@tool
def get_weather_forecast(location: str = "서울", days: int = 3) -> str:
    """
    지정 도시의 상세 날씨 정보를 조회합니다: 현재 날씨 + 오늘 시간대별 예보 + 최대 7일 예보.
    location: 도시명 (예: 서울, 부산, 대구). 기본값 서울.
    days: 예보 일수 (1~7). 기본값 3.
    '이번주 날씨', '내일 날씨', '주간 예보' 요청 시 사용하세요.
    """
    import requests
    from datetime import datetime, timedelta

    location_map = {
        "서울": "Seoul", "부산": "Busan", "대구": "Daegu", "인천": "Incheon",
        "광주": "Gwangju", "대전": "Daejeon", "울산": "Ulsan", "제주": "Jeju",
        "수원": "Suwon", "창원": "Changwon", "전주": "Jeonju", "강릉": "Gangneung",
        "춘천": "Chuncheon", "청주": "Cheongju", "천안": "Cheonan",
    }
    search_loc = location_map.get(location, location)

    try:
        geo = requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": search_loc, "count": 1, "language": "en"},
            timeout=10
        ).json()
        if not geo.get("results"):
            return f"❌ '{location}' 위치를 찾을 수 없습니다."
        lat = geo["results"][0]["latitude"]
        lon = geo["results"][0]["longitude"]
    except Exception as e:
        return f"❌ 위치 조회 오류: {e}"

    days = max(1, min(days, 7))
    try:
        data = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
                "hourly": "temperature_2m,precipitation_probability,weather_code",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
                "timezone": "Asia/Seoul",
                "forecast_days": days,
            },
            timeout=10
        ).json()
    except Exception as e:
        return f"❌ 날씨 API 오류: {e}"

    wcode_map = {
        0: "☀️맑음", 1: "🌤️대체로맑음", 2: "⛅부분흐림", 3: "☁️흐림",
        45: "🌫️안개", 48: "🌫️안개",
        51: "🌦️이슬비", 53: "🌦️이슬비", 55: "🌦️이슬비",
        61: "🌧️비", 63: "🌧️비", 65: "🌧️강한비",
        71: "🌨️눈", 73: "🌨️눈", 75: "❄️강설",
        80: "⛈️소나기", 81: "⛈️소나기", 82: "⛈️강한소나기",
    }

    lines = [f"🌍 **{location} 날씨 상세 ({days}일 예보)**\n"]

    # 현재 날씨
    c = data.get("current", {})
    lines.append(
        f"**지금:** {wcode_map.get(c.get('weather_code',0), '?')} "
        f"{c.get('temperature_2m','?')}°C (체감 {c.get('apparent_temperature','?')}°C) "
        f"💧습도 {c.get('relative_humidity_2m','?')}% 💨{c.get('wind_speed_10m','?')}m/s"
    )

    # 오늘 시간대별 (6시간 간격, 6~21시)
    h = data.get("hourly", {})
    h_times = h.get("time", [])
    h_temps = h.get("temperature_2m", [])
    h_prec = h.get("precipitation_probability", [])
    h_codes = h.get("weather_code", [])
    today_str = datetime.now().strftime("%Y-%m-%d")
    hourly_lines = []
    for i, t in enumerate(h_times):
        if t.startswith(today_str):
            hour = int(t[11:13])
            if hour in (6, 9, 12, 15, 18, 21) and i < len(h_temps):
                w = wcode_map.get(h_codes[i] if i < len(h_codes) else 0, "?")
                pr = h_prec[i] if i < len(h_prec) else 0
                hourly_lines.append(f"  {hour:02d}시 {w} {h_temps[i]}°C 강수{pr}%")
    if hourly_lines:
        lines.append("\n**오늘 시간대별:**")
        lines.extend(hourly_lines)

    # 일별 예보
    d = data.get("daily", {})
    d_times = d.get("time", [])
    weekday_kr = ["월", "화", "수", "목", "금", "토", "일"]
    lines.append("\n**일별 예보:**")
    for i, day_str in enumerate(d_times):
        try:
            dt = datetime.strptime(day_str, "%Y-%m-%d")
            wd = weekday_kr[dt.weekday()]
            label = "오늘" if i == 0 else ("내일" if i == 1 else f"{dt.month}/{dt.day}({wd})")
        except Exception:
            label = day_str
        max_t = d.get("temperature_2m_max", [None]*10)[i]
        min_t = d.get("temperature_2m_min", [None]*10)[i]
        wc = d.get("weather_code", [0]*10)[i]
        prec = d.get("precipitation_sum", [0]*10)[i]
        wind = d.get("wind_speed_10m_max", [0]*10)[i]
        w_str = wcode_map.get(wc, "?")
        lines.append(
            f"  {label}: {w_str} 최고{max_t}°C/최저{min_t}°C "
            f"강수{prec}mm 바람{wind}m/s"
        )

    return "\n".join(lines)


# ── 16. 시장 개요 ─────────────────────────────────────────────────────

@tool
def get_market_overview() -> str:
    """
    국내외 주요 주가지수와 환율, 암호화폐 현황을 한번에 조회합니다.
    코스피, 코스닥, 나스닥, S&P500, 다우, 비트코인, 원달러 환율 포함.
    '시장 현황', '오늘 증시', '주요 지수' 요청 시 사용하세요.
    """
    lines = ["📊 **글로벌 시장 현황**\n"]
    try:
        import yfinance as yf
        symbols = {
            "🇰🇷 코스피": "^KS11", "🇰🇷 코스닥": "^KQ11",
            "🇺🇸 나스닥": "^IXIC", "🇺🇸 S&P500": "^GSPC", "🇺🇸 다우": "^DJI",
            "₿ 비트코인": "BTC-USD", "🏅 금": "GC=F", "🛢️ 원유(WTI)": "CL=F",
        }
        for name, sym in symbols.items():
            try:
                t = yf.Ticker(sym)
                info = t.fast_info
                price = info.last_price
                prev = info.previous_close
                if price and prev:
                    chg = price - prev
                    chg_pct = chg / prev * 100
                    arrow = "📈" if chg > 0 else ("📉" if chg < 0 else "➡️")
                    lines.append(f"{arrow} **{name}**: {price:,.2f} ({chg_pct:+.2f}%)")
            except Exception:
                logger.warning("시장 개요 종목 처리 실패(건너뜀)", exc_info=True)

        # 원달러 환율
        try:
            fx = yf.Ticker("USDKRW=X")
            rate = fx.fast_info.last_price
            if rate:
                lines.append(f"💱 **원/달러**: {rate:,.2f}원")
        except Exception:
            logger.warning("환율 조회 실패(무시)", exc_info=True)

    except ImportError:
        lines.append("❌ yfinance 미설치 (pip install yfinance)")
    except Exception as e:
        lines.append(f"❌ 시장 데이터 오류: {e}")

    from datetime import datetime
    lines.append(f"\n🕐 조회 시각: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    return "\n".join(lines)


# ── 도구 목록 (LangGraph에서 사용) ────────────────────────────────────

ALL_TOOLS = [
    get_weather,
    get_stock_price,
    list_projects,
    list_project_tasks,
    get_project_tasks_detail,
    add_project_task,
    update_project_task,
    delete_project_task,
    list_all_reminders,
    create_schedule,
    delete_schedule,
    list_calendar_events,
    add_calendar_event,
    update_calendar_event,
    delete_calendar_event,
    search_news,
    web_search,
    get_system_status,
    run_shell_command,
    get_stock_recommendations,
    get_current_datetime,
    # 파일 관리
    list_files,
    read_file,
    write_file,
    delete_file,
    # 메모리 CRUD
    memory_read,
    memory_append,
    memory_replace,
    memory_delete_line,
    memory_list_files,
    # 코딩 에이전트
    run_python_code,
    save_and_run,
    install_package,
    analyze_code,
    list_workspace,
    # YouTube / 동적 스킬 브리지
    search_youtube,
    execute_registered_skill,
    # 자기진화
    create_skill,
    modify_skill,
    list_available_skills,
    read_skill_code,
    self_diagnose,
    # 선언적 스킬 아키텍처 (SKILL.md 관리)
    skill_read_doc,
    skill_write_doc,
    skill_log_failure,
    # 강화된 날씨/시장
    get_weather_forecast,
    get_market_overview,
    # 설정 관리
    set_skill_config,
# 한국투자증권 실계좌 매매
    kis_get_balance,
    kis_buy_stock,
    kis_sell_stock,
    kis_get_stock_price,
    # Nemesis HA 운영(상태 조회 + 수동 페일오버)
    nemesis_state,
    nemesis_failover,
]

# ── 메시징 도구 ─────────────────────────────────────────────────────────

@tool
def send_telegram_message(chat_id: int, message: str) -> str:
    """
    Telegram 메시지를 전송합니다.
    
    Args:
        chat_id: Telegram 채트 ID
        message: 전송할 메시지 내용
    
    Returns:
        str: 메시지 전송 결과
    """
    try:
        # Telegram bot을 통해 메시지 전송
        from telegram import Bot
        import os
        
        # Telegram 토큰을 환경 변수에서 가져오거나 직접 설정
        bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
        if not bot_token:
            return "❌ Telegram 봇 토큰이 설정되지 않았습니다."
        
        bot = Bot(token=bot_token)
        
        # Markdown 형식으로 메시지 전송
        bot.send_message(
            chat_id=chat_id,
            text=message,
            parse_mode='Markdown'
        )
        
        return f"✅ 메시지가 성공적으로 전송되었습니다 (채트 ID: {chat_id})"
        
    except Exception as e:
        logger.error(f"send_telegram_message error: {e}")
        return f"❌ 메시지 전송 실패: {e}"

__all__ = ALL_TOOLS
