
import logging
import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict

logger = logging.getLogger(__name__)

from config import BASE_DIR

class TaskSkill:
    """간단한 할 일 관리 스킬 (JSON 파일 기반)"""
    
    def __init__(self, tasks_dir: str = None):
        if tasks_dir:
            self.tasks_dir = Path(tasks_dir)
        else:
            self.tasks_dir = BASE_DIR / "tasks"
            
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self.data_file = self.tasks_dir / "tasks.json"
        self._load_tasks()

    def _load_tasks(self):
        if not self.data_file.exists():
            self.tasks = []
            self._save_tasks()
        else:
            try:
                self.tasks = json.loads(self.data_file.read_text(encoding='utf-8'))
            except:
                self.tasks = []

    def _save_tasks(self):
        self.data_file.write_text(json.dumps(self.tasks, ensure_ascii=False, indent=2), encoding='utf-8')

    def add_task(self, description: str, due_date: str = None):
        """할 일 추가"""
        task = {
            "id": len(self.tasks) + 1,
            "description": description,
            "due_date": due_date,
            "completed": False,
            "created_at": datetime.now().isoformat()
        }
        self.tasks.append(task)
        self._save_tasks()
        return f"Task added with ID {task['id']}"

    def list_tasks(self, include_completed: bool = False):
        """할 일 목록 조회"""
        if include_completed:
            return self.tasks
        return [t for t in self.tasks if not t["completed"]]

    def complete_task(self, task_id: int):
        """할 일 완료 처리"""
        for t in self.tasks:
            if t["id"] == task_id:
                t["completed"] = True
                t["completed_at"] = datetime.now().isoformat()
                self._save_tasks()
                return f"Task {task_id} marked as completed"
        return f"Task {task_id} not found"

    def get_tool_definitions(self) -> List[dict]:
        return [
            {
                "name": "add_task",
                "description": "할 일을 추가합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string", "description": "할 일 내용"},
                        "due_date": {"type": "string", "description": "마감 기한 (선택사항)"}
                    },
                    "required": ["description"]
                }
            },
            {
                "name": "list_tasks",
                "description": "할 일 목록을 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "include_completed": {"type": "boolean", "description": "완료된 항목 포함 여부"}
                    }
                }
            },
            {
                "name": "complete_task",
                "description": "할 일을 완료 처리합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "integer", "description": "완료할 할 일 ID"}
                    },
                    "required": ["task_id"]
                }
            }
        ]

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "add_task":
            return {"result": self.add_task(args.get("description"), args.get("due_date"))}
        elif tool_name == "list_tasks":
            return {"tasks": self.list_tasks(args.get("include_completed", False))}
        elif tool_name == "complete_task":
            return {"result": self.complete_task(args.get("task_id"))}
        return {"error": "Unknown tool"}
