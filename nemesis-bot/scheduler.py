"""
Scheduler and reminder system for aibot
Handles alarms, reminders, and scheduled tasks
"""
import json
import logging
import random
import string
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from pathlib import Path
import asyncio

logger = logging.getLogger(__name__)


class ReminderManager:
    """Manage reminders and scheduled tasks"""
    
    def __init__(self, db_path):
        """
        Initialize reminder manager
        
        Args:
            db_path: Path to reminders database file
        """
        from pathlib import Path
        self.db_path = Path(db_path)
        self.reminders: Dict[str, Dict] = {}
        self.load_reminders()
    
    def load_reminders(self):
        """Load reminders from database"""
        try:
            if self.db_path.exists():
                with open(self.db_path, 'r', encoding='utf-8') as f:
                    self.reminders = json.load(f)
                logger.info(f"Loaded {len(self.reminders)} reminders")
            else:
                self.reminders = {}
                self.save_reminders()
        except Exception as e:
            logger.error(f"Error loading reminders: {e}")
            self.reminders = {}
    
    def save_reminders(self):
        """Save reminders to database"""
        try:
            with open(self.db_path, 'w', encoding='utf-8') as f:
                json.dump(self.reminders, f, ensure_ascii=False, indent=2)
            logger.info("Reminders saved")
        except Exception as e:
            logger.error(f"Error saving reminders: {e}")
    
    def add_reminder(
        self,
        user_id: int,
        chat_id: int,
        message: str,
        trigger_time: datetime,
        reminder_type: str = "once"
    ) -> str:
        """
        Add a new reminder
        
        Args:
            user_id: Telegram user ID
            chat_id: Telegram chat ID
            message: Reminder message
            trigger_time: When to trigger the reminder
            reminder_type: Type of reminder (once, daily, weekly)
        
        Returns:
            Reminder ID
        """
        suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
        reminder_id = f"{user_id}_{int(trigger_time.timestamp())}_{suffix}"
        
        self.reminders[reminder_id] = {
            "user_id": user_id,
            "chat_id": chat_id,
            "message": message,
            "trigger_time": trigger_time.isoformat(),
            "type": reminder_type,
            "active": True,
            "created_at": datetime.now().isoformat()
        }
        
        self.save_reminders()
        logger.info(f"Added reminder {reminder_id}: {message}")
        
        return reminder_id
    
    def remove_reminder(self, reminder_id: str) -> bool:
        """Remove a reminder"""
        if reminder_id in self.reminders:
            del self.reminders[reminder_id]
            self.save_reminders()
            logger.info(f"Removed reminder {reminder_id}")
            return True
        return False
    
    def get_user_reminders(self, user_id: int) -> List[Dict]:
        """Get all active reminders for a user"""
        return [
            {"id": rid, **reminder}
            for rid, reminder in self.reminders.items()
            if reminder["user_id"] == user_id and reminder["active"]
        ]
    
    def get_due_reminders(self) -> List[Dict]:
        """Get all reminders that are due"""
        now = datetime.now()
        due_reminders = []
        
        for reminder_id, reminder in self.reminders.items():
            if not reminder["active"]:
                continue
            
            trigger_time = datetime.fromisoformat(reminder["trigger_time"])
            
            if trigger_time <= now:
                due_reminders.append({
                    "id": reminder_id,
                    **reminder
                })
        
        return due_reminders
    
    def mark_reminder_completed(self, reminder_id: str):
        """Mark a reminder as completed"""
        if reminder_id in self.reminders:
            reminder = self.reminders[reminder_id]
            
            if reminder["type"] == "once":
                # One-time reminder: deactivate
                reminder["active"] = False
            elif reminder["type"] == "daily":
                # Daily reminder: schedule for next day
                trigger_time = datetime.fromisoformat(reminder["trigger_time"])
                next_trigger = trigger_time + timedelta(days=1)
                reminder["trigger_time"] = next_trigger.isoformat()
            elif reminder["type"] == "weekly":
                # Weekly reminder: schedule for next week
                trigger_time = datetime.fromisoformat(reminder["trigger_time"])
                next_trigger = trigger_time + timedelta(weeks=1)
                reminder["trigger_time"] = next_trigger.isoformat()
            
            self.save_reminders()


def parse_time_expression(expression: str) -> Optional[datetime]:
    """
    Parse natural language time expressions
    
    Examples:
        - "10분 후" -> 10 minutes from now
        - "1시간 후" -> 1 hour from now
        - "내일 오전 8시" -> tomorrow at 8 AM
        - "2026-02-10 14:30" -> specific datetime
        - "매일 오전 7시" -> next occurrence of 7 AM
    
    Args:
        expression: Time expression string
    
    Returns:
        Datetime object or None if parsing fails
    """
    now = datetime.now()
    expression = expression.strip()
    
    # Remove recurrence keywords for parsing the next occurrence
    expression = expression.replace("매일", "").replace("매주", "").strip()
    
    try:
        # Try parsing as ISO format first
        if "-" in expression and ":" in expression:
            return datetime.fromisoformat(expression)
        
        # Parse relative time
        if "분" in expression:
            parts = expression.split("분")
            if parts[0].strip().isdigit():
                minutes = int(parts[0].strip())
                return now + timedelta(minutes=minutes)
        
        if "시간" in expression:
            parts = expression.split("시간")
            if parts[0].strip().isdigit():
                hours = int(parts[0].strip())
                return now + timedelta(hours=hours)
        
        if "일" in expression and "요일" not in expression and "일정" not in expression:
            parts = expression.split("일")
            if parts[0].strip().isdigit():
                days = int(parts[0].strip())
                return now + timedelta(days=days)
        
        # Parse "내일" (tomorrow)
        if "내일" in expression:
            tomorrow = now + timedelta(days=1)
            
            # Check for specific time
            if "오전" in expression or "오후" in expression:
                # Remove "내일"
                time_part = expression.replace("내일", "").strip()
                
                is_pm = "오후" in time_part
                time_part = time_part.replace("오전", "").replace("오후", "").strip()
                
                if "시" in time_part:
                    hour = int(time_part.split("시")[0].strip())
                    minute = 0
                    if "분" in time_part:
                        minute_str = time_part.split("시")[1].split("분")[0].strip()
                        if minute_str:
                            minute = int(minute_str)
                    
                    if is_pm and hour != 12:
                        hour += 12
                    elif not is_pm and hour == 12:
                        hour = 0
                        
                    return tomorrow.replace(hour=hour, minute=minute, second=0, microsecond=0)
            
            return tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)
        
        # Parse specific time today (or next occurrence)
        if "시" in expression:
            original_expression = expression
            is_pm = "오후" in expression
            
            # Remove 오전/오후 to get numbers
            # Use regex or simple replace if formatting is clean
            # Assuming "오전 7시" or "7시"
            
            # Remove Korean chars except number and identifiers if needed, but let's try simple replacement first
            time_part = expression.replace("오전", "").replace("오후", "").strip()
            
            if "시" in time_part:
                hour = int(time_part.split("시")[0].strip())
                minute = 0
                
                if "분" in time_part:
                    minute_str = time_part.split("시")[1].split("분")[0].strip()
                    if minute_str:
                        minute = int(minute_str)
                
                if is_pm and hour != 12:
                    hour += 12
                elif not is_pm and "오전" in expression and hour == 12:
                    hour = 0
                
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                
                # If time has passed today, schedule for tomorrow
                if target <= now:
                    target += timedelta(days=1)
                
                return target
        
    except Exception as e:
        logger.error(f"Error parsing time expression '{expression}': {e}")
    
    return None


if __name__ == "__main__":
    # Test reminder manager
    from config import REMINDERS_DB, ensure_directories
    
    ensure_directories()
    
    manager = ReminderManager(REMINDERS_DB)
    
    # Test adding reminder
    trigger = datetime.now() + timedelta(minutes=5)
    reminder_id = manager.add_reminder(
        user_id=12345,
        chat_id=12345,
        message="테스트 알림입니다!",
        trigger_time=trigger
    )
    
    print(f"Added reminder: {reminder_id}")
    print(f"User reminders: {manager.get_user_reminders(12345)}")
    
    # Test time parsing
    print("\n=== Time Parsing Tests ===")
    test_expressions = [
        "10분 후",
        "1시간 후",
        "내일 오전 8시",
        "오후 3시",
        "2026-02-10 14:30"
    ]
    
    for expr in test_expressions:
        result = parse_time_expression(expr)
        print(f"{expr} -> {result}")
