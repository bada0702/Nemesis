
"""
langgraph_tools_distribution.py
Tool distribution for the hierarchical multi-agent system.
"""
import logging
from typing import List, Dict
from langchain_core.tools import BaseTool
import langgraph_tools as lt

logger = logging.getLogger(__name__)


def get_all_tools() -> List[BaseTool]:
    """Returns all tool objects from langgraph_tools.py"""
    return list(lt.ALL_TOOLS)


# ── 전문 에이전트별 도구 그룹 정의 ──────────────────────────────────────────
SPECIALIST_TOOL_GROUPS: Dict[str, List[str]] = {
    "generalist": [
        "get_current_datetime", "web_search", "search_news", "search_youtube",
        "get_weather", "get_weather_forecast",
    ],
    "investment": [
        "get_stock_price", "get_market_overview", "get_exchange_rate",
        "get_multiple_exchange_rates", "get_crypto_price",
        "kis_get_balance", "kis_buy_stock", "kis_sell_stock", "kis_get_stock_price",
        "get_stock_recommendations",
        "web_search", "search_news",  # 투자 뉴스 검색 허용
    ],
    "system": [
        "get_system_status", "run_shell_command", "run_python_code",
        "save_and_run", "install_package", "analyze_code",
        "list_workspace", "create_skill", "modify_skill",
        "list_available_skills", "read_skill_code", "self_diagnose",
        "set_skill_config", "list_files", "read_file", "write_file", "delete_file",
        "execute_registered_skill", "web_search",
    ],
    "life": [
        "get_weather", "get_weather_forecast",
        "list_all_reminders", "create_schedule", "delete_schedule",
        "list_calendar_events", "add_calendar_event",
        "update_calendar_event", "delete_calendar_event",
        "list_projects", "list_project_tasks", "add_project_task",
        "update_project_task", "delete_project_task", "get_project_tasks_detail",
        "memory_read", "memory_append", "memory_replace",
        "memory_delete_line", "memory_list_files",
        "get_note", "save_note", "list_notes",
        "get_tasks", "add_task", "complete_task",
        "check_gmail", "send_gmail", "read_gmail",
        "web_search",
    ],
}

# ── 전문 에이전트별 시스템 프롬프트 추가 지침 ──────────────────────────────
SPECIALIST_SYSTEM_PROMPTS: Dict[str, str] = {
    "generalist": """
**[전문 영역: 일반 비서]**
- 웹 검색, 뉴스, 날씨, 날짜 등 일반적인 정보 조회를 담당합니다.
- 질문에 필요한 정보를 검색으로 가져와 명확하고 간결하게 답변하십시오.
- 검색은 1~2회로 충분합니다. 충분한 정보가 수집되면 즉시 답변을 작성하십시오.
""",
    "investment": """
**[전문 영역: 금융·투자 전문가]**
- 주식, 환율, 암호화폐, 실적, 시장 분석을 담당합니다.
- 실제 데이터(도구 호출 결과)만 사용하고 추측은 절대 금지입니다.
- 숫자는 반드시 도구 결과값 그대로 인용하십시오.
- 투자 분석 순서: ① 현재가/시장 데이터 조회 → ② 관련 뉴스 검색 → ③ 종합 분석 답변
- 뉴스 검색은 최대 2회. 이후 반드시 종합 답변을 작성하십시오.
- 투자 권유가 아닌 데이터 기반 분석으로 제공하십시오.
""",
    "system": """
**[전문 영역: 코딩·시스템 전문가]**
- 코드 작성·수정, 스킬 생성·수정, 파일 관리, 시스템 명령 실행을 담당합니다.
- 실행 전 코드를 분석하고, 실행 후 결과를 반드시 확인하십시오.
- 오류 발생 시: 오류 메시지 분석 → 원인 파악 → 즉시 수정 시도.
- 파일 경로는 workspace 내부(read_file/write_file) vs 외부(run_shell_command)를 구분하십시오.
- 스킬 생성 후 execute_registered_skill로 즉시 테스트하십시오.
""",
    "life": """
**[전문 영역: 일정·생활 관리 전문가]**
- 캘린더, 프로젝트, 일정, 메모, 이메일, 날씨를 담당합니다.
- 프로젝트 작업 추가 시: list_projects() → add_project_task() 순서 필수.
- 일정 등록 시 user_id와 chat_id를 반드시 포함하십시오.
- 날짜/시간은 항상 현재 시간 기준으로 계산하십시오.
""",
}

# ── 의도 분류 키워드 ─────────────────────────────────────────────────────────
SPECIALIST_KEYWORDS: Dict[str, List[str]] = {
    "investment": [
        "주식", "종목", "코스피", "코스닥", "나스닥", "s&p", "환율", "달러", "엔화",
        "코인", "비트코인", "이더리움", "암호화폐", "가상화폐",
        "매수", "매도", "잔고", "수익", "손실", "투자", "포트폴리오",
        "etf", "펀드", "배당", "실적", "roe", "per", "시총",
        "팔란티어", "pltr", "테슬라", "애플", "nvidia", "삼성전자", "sk하이닉스",
        "전망", "분석", "주가", "시세", "선물", "옵션", "금리", "채권",
    ],
    "system": [
        "코드", "파이썬", "python", "javascript", "스크립트", "프로그램",
        "스킬 만들", "스킬 수정", "스킬 생성", "기능 추가", "버그", "오류 수정",
        "파일", "폴더", "디렉토리", "설치", "패키지", "라이브러리",
        "쉘", "명령", "터미널", "서버", "프로세스", "재시작", "로그",
        "자가진단", "create_skill", "modify_skill",
    ],
    "life": [
        "날씨", "기온", "비", "눈", "맑음", "흐림",
        "일정", "캘린더", "calendar", "약속", "미팅", "회의",
        "프로젝트", "작업", "태스크", "task",
        "알림", "리마인더", "reminder", "스케줄", "schedule",
        "메모", "노트", "메일", "이메일", "gmail",
        "내일", "이번주", "다음주", "오늘 할일",
    ],
}


def get_specialist_tools() -> Dict[str, List[BaseTool]]:
    """전문 에이전트별 도구 객체 목록 반환."""
    all_tools_list = get_all_tools()
    tool_map = {t.name: t for t in all_tools_list}

    result = {}
    for specialist, tool_names in SPECIALIST_TOOL_GROUPS.items():
        result[specialist] = [tool_map[name] for name in tool_names if name in tool_map]
        missing = [n for n in tool_names if n not in tool_map]
        if missing:
            logger.debug(f"[{specialist}] 도구 없음 (건너뜀): {missing}")

    return result


def classify_intent(message: str) -> str:
    """키워드 기반 의도 분류 → specialist 이름 반환."""
    msg_lower = message.lower()
    scores = {k: 0 for k in SPECIALIST_KEYWORDS}
    for specialist, keywords in SPECIALIST_KEYWORDS.items():
        for kw in keywords:
            if kw in msg_lower:
                scores[specialist] += 1

    best = max(scores, key=scores.get)
    if scores[best] > 0:
        logger.info(f"Intent classified → {best} (scores: {scores})")
        return best

    return "generalist"
