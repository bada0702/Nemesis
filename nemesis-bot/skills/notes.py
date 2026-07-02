
import logging
import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict

logger = logging.getLogger(__name__)

from config import BASE_DIR

class NoteSkill:
    """간단한 노트 관리 스킬 (JSON 파일 기반)"""
    
    def __init__(self, notes_dir: str = None):
        if notes_dir:
            self.notes_dir = Path(notes_dir)
        else:
            self.notes_dir = BASE_DIR / "notes"
            
        self.notes_dir.mkdir(parents=True, exist_ok=True)
        self.data_file = self.notes_dir / "notes.json"
        self._load_notes()

    def _load_notes(self):
        if not self.data_file.exists():
            self.notes = []
            self._save_notes()
        else:
            try:
                self.notes = json.loads(self.data_file.read_text(encoding='utf-8'))
            except:
                self.notes = []

    def _save_notes(self):
        self.data_file.write_text(json.dumps(self.notes, ensure_ascii=False, indent=2), encoding='utf-8')

    def add_note(self, content: str, category: str = "general"):
        """노트 추가"""
        note = {
            "id": len(self.notes) + 1,
            "content": content,
            "category": category,
            "created_at": datetime.now().isoformat()
        }
        self.notes.append(note)
        self._save_notes()
        return f"Note added with ID {note['id']}"

    def get_notes(self, category: str = None):
        """노트 조회"""
        if category:
            return [n for n in self.notes if n["category"] == category]
        return self.notes

    def delete_note(self, note_id: int):
        """노트 삭제"""
        original_len = len(self.notes)
        self.notes = [n for n in self.notes if n["id"] != note_id]
        if len(self.notes) < original_len:
            self._save_notes()
            return f"Note {note_id} deleted"
        return f"Note {note_id} not found"

    def get_tool_definitions(self) -> List[dict]:
        return [
            {
                "name": "add_note",
                "description": "간단한 텍스트 노트를 저장합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "노트 내용"},
                        "category": {"type": "string", "description": "카테고리 (선택사항)", "default": "general"}
                    },
                    "required": ["content"]
                }
            },
            {
                "name": "get_notes",
                "description": "저장된 노트를 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "description": "카테고리 필터 (선택사항)"}
                    }
                }
            },
            {
                "name": "delete_note",
                "description": "노트를 삭제합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "note_id": {"type": "integer", "description": "삭제할 노트 ID"}
                    },
                    "required": ["note_id"]
                }
            }
        ]

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "add_note":
            return {"result": self.add_note(args.get("content"), args.get("category", "general"))}
        elif tool_name == "get_notes":
            return {"notes": self.get_notes(args.get("category"))}
        elif tool_name == "delete_note":
            return {"result": self.delete_note(args.get("note_id"))}
        return {"error": "Unknown tool"}
