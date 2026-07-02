"""
Cron-based scheduler for recurring AI tasks
Manages daily/weekly scheduled tasks like weather reports
"""
import json
import logging
import random
import string
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict, Optional
from croniter import croniter
import asyncio

from config import DATA_DIR

# KST 타임존 (UTC+9)
KST = timezone(timedelta(hours=9))

def _now_kst() -> datetime:
    """현재 KST 시각 반환 (naive datetime, KST 기준)"""
    return datetime.now(KST).replace(tzinfo=None)

logger = logging.getLogger(__name__)

CRON_SCHEDULES_FILE = DATA_DIR / "cron_schedules.json"


class CronScheduler:
    """Manage cron-based recurring AI tasks"""
    
    def __init__(self, schedules_file: Path = CRON_SCHEDULES_FILE):
        """
        Initialize cron scheduler
        
        Args:
            schedules_file: Path to cron schedules JSON file
        """
        self.schedules_file = schedules_file
        self.schedules: List[Dict] = []
        self.last_check_times: Dict[str, datetime] = {}
        self.load_schedules()
    
    def load_schedules(self):
        """Load cron schedules from JSON file with validation"""
        try:
            if self.schedules_file.exists():
                with open(self.schedules_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    raw_schedules = data.get("schedules", [])
                
                # Validate and deduplicate
                self.schedules = []
                seen_ids = set()
                
                for s in raw_schedules:
                    # Basic validation
                    if not isinstance(s, dict):
                        continue
                        
                    schedule_id = s.get("id")
                    if not schedule_id:
                        logger.warning(f"Skipping malformed schedule missing 'id': {s}")
                        continue
                        
                    if not s.get("cron") or not s.get("ai_task"):
                        logger.warning(f"Skipping malformed schedule {schedule_id}: missing 'cron' or 'ai_task'")
                        continue
                    
                    # Ensure unique ID
                    if schedule_id in seen_ids:
                        random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
                        new_id = f"{schedule_id}_{random_suffix}"
                        logger.warning(f"Duplicate schedule ID found: {schedule_id}. Renaming to {new_id}")
                        s["id"] = new_id
                        schedule_id = new_id
                    
                    self.schedules.append(s)
                    seen_ids.add(schedule_id)
                
                logger.info(f"Loaded {len(self.schedules)} valid cron schedules")
            else:
                # Create default file
                self.schedules = []
                self.save_schedules()
        except Exception as e:
            logger.error(f"Error loading cron schedules: {e}")
            self.schedules = []
    
    def save_schedules(self):
        """Save cron schedules to JSON file"""
        try:
            self.schedules_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.schedules_file, 'w', encoding='utf-8') as f:
                json.dump({"schedules": self.schedules}, f, ensure_ascii=False, indent=2)
            logger.info("Cron schedules saved")
        except Exception as e:
            logger.error(f"Error saving cron schedules: {e}")
    
    def add_schedule(
        self,
        user_id: int,
        chat_id: int,
        ai_task: str,
        cron_expression: str,
        name: str = "",
        description: str = ""
    ) -> str:
        """
        Add a new cron schedule
        
        Args:
            user_id: Telegram user ID
            chat_id: Telegram chat ID
            ai_task: AI task to execute (e.g., "서울 날씨 알려줘")
            cron_expression: Cron expression (e.g., "0 7 * * *" for daily 7 AM)
            name: Schedule name
            description: Schedule description
        
        Returns:
            Schedule ID
        """
        # Validate cron expression
        try:
            croniter(cron_expression)
        except Exception as e:
            raise ValueError(f"Invalid cron expression: {e}")
        
        # Generate unique ID with random suffix to prevent collisions
        random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
        schedule_id = f"cron_{user_id}_{int(datetime.now().timestamp())}_{random_suffix}"
        
        schedule = {
            "id": schedule_id,
            "enabled": True,
            "name": name or f"Schedule {schedule_id}",
            "description": description,
            "cron": cron_expression,
            "user_id": user_id,
            "chat_id": chat_id,
            "ai_task": ai_task,
            "created_at": _now_kst().isoformat(),
            "last_run": None  # KST 기준으로 추적
        }
        
        self.schedules.append(schedule)
        self.save_schedules()
        
        logger.info(f"Added cron schedule {schedule_id}: {cron_expression} - {ai_task}")
        return schedule_id
    
    def add_schedule_natural(
        self,
        user_id: int,
        chat_id: int,
        time_expression: str,
        ai_task: str,
        name: str = "",
        description: str = ""
    ) -> str:
        """
        Add a new cron schedule using natural language time expression
        """
        cron_expression = parse_natural_cron(time_expression)
        if not cron_expression:
            raise ValueError(f"Could not parse time expression: {time_expression}")
            
        return self.add_schedule(
            user_id=user_id,
            chat_id=chat_id,
            ai_task=ai_task,
            cron_expression=cron_expression,
            name=name or f"{time_expression} 알림",
            description=description or f"AI Task: {ai_task}"
        )
    
    def remove_schedule(self, schedule_id: str) -> bool:
        """Remove a cron schedule"""
        initial_count = len(self.schedules)
        self.schedules = [s for s in self.schedules if s.get("id") != schedule_id]
        
        if len(self.schedules) < initial_count:
            self.save_schedules()
            logger.info(f"Removed cron schedule {schedule_id}")
            return True
        return False
    
    def get_user_schedules(self, user_id: int) -> List[Dict]:
        """Get all schedules for a user"""
        return [s for s in self.schedules if s["user_id"] == user_id]
    
    def toggle_schedule(self, schedule_id: str, enabled: bool) -> bool:
        """Enable or disable a schedule"""
        for schedule in self.schedules:
            if schedule.get("id") == schedule_id:
                schedule["enabled"] = enabled
                self.save_schedules()
                logger.info(f"Schedule {schedule_id} {'enabled' if enabled else 'disabled'}")
                return True
        return False
    
    def get_due_schedules(self) -> List[Dict]:
        """
        KST 기준으로 실행 시각이 된 스케줄 목록을 반환합니다.
        누락된 스케줄도 1회 복구 실행합니다.
        """
        now = _now_kst()
        due_schedules = []
        schedules_updated = False

        for schedule in self.schedules:
            if not isinstance(schedule, dict) or not schedule.get("enabled", True):
                continue

            schedule_id = schedule.get("id")
            if not schedule_id:
                continue

            cron_expr = schedule.get("cron")
            if not cron_expr:
                continue

            try:
                last_run_str = schedule.get("last_run")
                if last_run_str:
                    last_run = datetime.fromisoformat(last_run_str)
                else:
                    # 처음 실행: 1분 전 기준으로 next를 계산하여 즉시 실행 방지
                    created_str = schedule.get("created_at", now.isoformat())
                    last_run = datetime.fromisoformat(created_str)

                cron = croniter(cron_expr, last_run)
                next_run = cron.get_next(datetime)

                if next_run <= now:
                    due_schedules.append(schedule)
                    schedule["last_run"] = now.isoformat()
                    schedules_updated = True
                    logger.info(
                        f"[KST] Schedule '{schedule.get('name', schedule_id)}' due "
                        f"(next={next_run.strftime('%H:%M')}, now={now.strftime('%H:%M')})"
                    )

            except Exception as e:
                logger.error(f"Error checking schedule {schedule_id}: {e}")

        if schedules_updated:
            self.save_schedules()

        return due_schedules


def parse_natural_cron(expression: str) -> Optional[str]:
    """
    Convert natural language to cron expression
    Supports:
    - 매일 오전/오후 7시, 7시 40분, 7:40
    - 매일 아침 7시 (07:00), 저녁 7시 (19:00)
    - 매주 월요일 오전 9시
    - 오전 7:00 날씨 알림 (매일 키워드 없어도 기본 매일로 처리)
    - 평일 오전 7시  → 월-금(1-5)만 실행
    - 주말 오전 9시  → 토-일(6,0)만 실행
    """
    import re
    expression = expression.strip()
    
    # 1. 시간 파싱 (오전/오후/아침/저녁/밤 hh:mm)
    hour = -1
    minute = 0
    
    # 오전/오후 체크
    is_pm = False
    if "오후" in expression or "저녁" in expression or "밤" in expression:
        is_pm = True

    # 시간 숫자 추출 — 우선순위대로 시도
    # 1) "5시 40분" / "5시40분" 형식
    kor_match = re.search(r'(\d{1,2})\s*시\s*(\d{1,2})\s*분', expression)
    # 2) "17:40" / "5:40" 콜론 형식
    colon_match = re.search(r'(\d{1,2}):(\d{2})', expression)
    # 3) "5시" 만 있는 경우
    hour_only = re.search(r'(\d{1,2})\s*시', expression)

    if kor_match:
        hour = int(kor_match.group(1))
        minute = int(kor_match.group(2))
    elif colon_match:
        hour = int(colon_match.group(1))
        minute = int(colon_match.group(2))
    elif hour_only:
        hour = int(hour_only.group(1))
        minute = 0

    if hour != -1:
        # 12시간제 → 24시간제 변환
        if is_pm and hour < 12:
            hour += 12
        elif not is_pm and "오전" in expression and hour == 12:
            hour = 0

    if hour == -1:
        return None
    
    # 시간 유효성 검사
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
        
    # 2. 주기 파싱 (매일/평일/주말/매주/기본=매일)
    
    # 평일만 (월~금)
    if "평일" in expression or "주중" in expression:
        return f"{minute} {hour} * * 1-5"
    
    # 주말만 (토, 일)
    if "주말" in expression:
        return f"{minute} {hour} * * 0,6"
    
    # 매일
    if "매일" in expression or "날마다" in expression or "하루" in expression:
        return f"{minute} {hour} * * *"
        
    # 매주 특정 요일
    if "매주" in expression or "주마다" in expression:
        # 요일 매핑
        day_map = {
            "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6, "일": 0
        }
        for day_char, day_num in day_map.items():
            if day_char in expression:
                return f"{minute} {hour} * * {day_num}"
        # 요일 미지정 시 매일
        return f"{minute} {hour} * * *"
    
    # 알림/설정/시 등 키워드가 있으면 기본적으로 '매일' 처리
    # (예: "오전 7:00 날씨 알림 설정", "매일 아침")
    if any(k in expression for k in ['알림', '설정', '보내', '알려', '시작']):
        return f"{minute} {hour} * * *"
                
    # 기타 - 시간만 지정된 경우 매일로 처리
    return f"{minute} {hour} * * *"


if __name__ == "__main__":
    # Test cron scheduler
    from config import ensure_directories
    
    ensure_directories()
    
    scheduler = CronScheduler()
    
    # Test adding schedule
    schedule_id = scheduler.add_schedule(
        user_id=12345,
        chat_id=12345,
        ai_task="서울 날씨 알려줘",
        cron_expression="0 7 * * *",
        name="Daily Weather",
        description="매일 아침 7시 날씨 정보"
    )
    
    print(f"Added schedule: {schedule_id}")
    print(f"User schedules: {scheduler.get_user_schedules(12345)}")
    
    # Test natural language parsing
    print("\n=== Natural Language Cron Parsing ===")
    test_expressions = [
        "매일 오전 7시",
        "매일 오후 3시",
        "매주 월요일 오전 9시"
    ]
    
    for expr in test_expressions:
        cron_expr = parse_natural_cron(expr)
        print(f"{expr} -> {cron_expr}")
