
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class WorkLogSkill:
    """
    업무일지 생성 스킬.
    구글 캘린더 일정을 조회해서 정해진 템플릿으로 업무일지를 작성하고 파일로 저장합니다.
    calendar_client 는 ToolManager 가 주입합니다.
    """

    def __init__(self, calendar_client=None, project_skill=None, base_dir: Optional[Path] = None):
        self.calendar_client = calendar_client
        self.project_skill = project_skill
        self.base_dir = base_dir or Path(".")
        self.reports_dir = self.base_dir / "workspace" / "reports"

    def _ensure_reports_dir(self):
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_date(self, date_str: str) -> datetime:
        """'오늘', '어제', '내일' 또는 YYYY-MM-DD 를 datetime 으로 변환."""
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        d = (date_str or "오늘").strip().lower()
        if d in ("오늘", "today", ""):
            return today
        if d in ("어제", "yesterday"):
            from datetime import timedelta
            return today - timedelta(days=1)
        if d in ("내일", "tomorrow"):
            from datetime import timedelta
            return today + timedelta(days=1)
        try:
            return datetime.strptime(d, "%Y-%m-%d")
        except ValueError:
            return today

    def generate(self, date: str = "오늘", worker_name: str = "", project_name: str = "",
                 extra_notes: str = "", save: bool = True) -> Dict:
        """
        업무일지 생성.
        1) 캘린더에서 해당 날짜 일정 조회
        2) 템플릿 채우기
        3) save=True 이면 workspace/reports/daily_report_YYYYMMDD.txt 로 저장
        """
        dt = self._resolve_date(date)
        date_label = dt.strftime("%Y년 %m월 %d일")
        date_file = dt.strftime("%Y%m%d")

        # 캘린더 일정 조회
        events_text = ""
        if self.calendar_client:
            try:
                date_param = dt.strftime("%Y-%m-%d")
                events = self.calendar_client.get_events_by_date(date=date_param, days=1)
                if events and not (isinstance(events, dict) and "error" in events):
                    lines = []
                    for i, ev in enumerate(events, 1):
                        summary = ev.get("summary", "(제목 없음)")
                        start = ev.get("start", {})
                        start_time = start.get("dateTime") or start.get("date", "")
                        # ISO → 시:분만 추출
                        if "T" in start_time:
                            try:
                                t = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                                start_time = t.strftime("%H:%M")
                            except Exception:
                                pass
                        lines.append(f"  {i}. [{start_time}] {summary}")
                    events_text = "\n".join(lines)
                else:
                    events_text = "  (등록된 일정 없음)"
            except Exception as e:
                logger.warning(f"WorkLogSkill: calendar error: {e}")
                events_text = "  (캘린더 조회 실패)"
        else:
            events_text = "  (캘린더 연동 없음)"

        # 3) 프로젝트 일정 조회
        project_tasks_text = ""
        if self.project_skill:
            try:
                date_param = dt.strftime("%Y-%m-%d")
                res = self.project_skill.get_tasks()
                tasks = res if isinstance(res, list) else res.get("data", [])
                
                if tasks:
                    matched_tasks = []
                    for t in tasks:
                        s_date = t.get("start_date")
                        e_date = t.get("end_date")
                        # 날짜 포함 여부 확인 (시작일 <= 오늘 <= 종료일)
                        if s_date and e_date:
                            try:
                                if s_date <= date_param <= e_date:
                                    status = t.get("status", "todo")
                                    prog = t.get("progress", 0)
                                    formatted_task = f"  - [프로그램] {t.get('name')} ({status}, {prog}%)"
                                    matched_tasks.append(formatted_task)
                            except: pass
                    
                    if matched_tasks:
                        project_tasks_text = "\n".join(matched_tasks)
            except Exception as e:
                logger.warning(f"WorkLogSkill: project error: {e}")

        # 작업내용 = 캘린더 일정 + 프로젝트 일정
        work_content = ""
        if events_text:
            work_content += f"📅 구글 캘린더:\n{events_text}\n"
        if project_tasks_text:
            if work_content: work_content += "\n"
            work_content += f"📂 프로젝트 일정:\n{project_tasks_text}"
            
        if not work_content:
            work_content = "  (등록된 일정 없음)"

        template = f"""-작업일지
작업일자 : {date_label}
프로젝트명 : {project_name or '(미입력)'}
작업자명 : {worker_name or '(미입력)'}
작업내용 :
{work_content}
특이사항 : {extra_notes or '없음'}
"""

        result: Dict = {
            "date": date_label,
            "content": template,
            "saved": False,
            "file_path": None,
        }

        if save:
            self._ensure_reports_dir()
            file_path = self.reports_dir / f"daily_report_{date_file}.txt"
            try:
                file_path.write_text(template, encoding="utf-8")
                result["saved"] = True
                result["file_path"] = str(file_path)
                logger.info(f"WorkLogSkill: saved to {file_path}")
            except Exception as e:
                logger.error(f"WorkLogSkill: save failed: {e}")
                result["error"] = f"파일 저장 실패: {e}"

        return result

    # ------------------------------------------------------------------ #
    #  Tool definitions                                                    #
    # ------------------------------------------------------------------ #
    def get_tool_definitions(self) -> list:
        return [
            {
                "name": "generate_work_log",
                "description": (
                    "업무일지(작업일지)를 생성합니다. "
                    "구글 캘린더에서 해당 날짜 일정을 자동으로 가져와 작업내용에 채운 뒤 "
                    "workspace/reports/ 폴더에 파일로 저장합니다."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "date": {
                            "type": "string",
                            "description": "업무일지 날짜. '오늘', '어제', '내일' 또는 'YYYY-MM-DD'. 기본값: 오늘."
                        },
                        "worker_name": {
                            "type": "string",
                            "description": "작업자 이름 (선택사항)"
                        },
                        "project_name": {
                            "type": "string",
                            "description": "프로젝트명 (선택사항)"
                        },
                        "extra_notes": {
                            "type": "string",
                            "description": "특이사항 (선택사항)"
                        },
                        "save": {
                            "type": "boolean",
                            "description": "파일로 저장 여부. 기본값: true."
                        }
                    }
                }
            }
        ]

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "generate_work_log":
            return self.generate(
                date=args.get("date", "오늘"),
                worker_name=args.get("worker_name", ""),
                project_name=args.get("project_name", ""),
                extra_notes=args.get("extra_notes", ""),
                save=args.get("save", True),
            )
        return {"error": "Unknown tool"}
