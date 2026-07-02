import os
import requests
import json
from typing import List, Dict, Any
import urllib3

# SSL 경고 무시 설정
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class ProjectScheduleSkill:
    def __init__(self):
        self.base_url = "https://chojungwon.iptime.org"
        self.api_key = os.getenv("PROJECT_API_KEY", "")

    def execute_tool(self, tool_name: str, args: Dict[str, Any]) -> str:
        if tool_name == "list_projects":
            return self.list_projects()
        elif tool_name == "list_project_tasks":
            return self.list_project_tasks(args.get("projectId"), args.get("date"))
        elif tool_name == "add_project_task":
            return self.add_project_task(args)
        elif tool_name == "update_project_task":
            return self.update_project_task(args)
        elif tool_name == "delete_project_task":
            return self.delete_project_task(args.get("id"))
        elif tool_name == "get_project_tasks_detail":
            return self.get_project_tasks_detail(args.get("projectId"), args.get("date"))
        return "지원하지 않는 도구입니다."

    def _request(self, resource: str, method: str = "GET", data: Dict = None, extra_params: Dict = None):
        url = f"{self.base_url}/project/api/ai-api.php"

        headers = {
            "X-AI-API-Key": self.api_key,
            "Content-Type": "application/json"
        }

        params = {"resource": resource}
        if extra_params:
            params.update(extra_params)

        try:
            if method == "GET":
                response = requests.get(url, headers=headers, params=params, verify=False, timeout=15)
            elif method == "POST":
                response = requests.post(url, headers=headers, params=params, json=data, verify=False, timeout=15)
            elif method == "PUT":
                response = requests.put(url, headers=headers, params=params, json=data, verify=False, timeout=15)
            elif method == "DELETE":
                response = requests.delete(url, headers=headers, params=params, json=data, verify=False, timeout=15)

            response.raise_for_status()
            return response.json()
        except Exception as e:
            return {"error": str(e)}

    def list_projects(self) -> str:
        res = self._request("projects")
        return json.dumps(res, ensure_ascii=False)

    def list_project_tasks(self, project_id=None, date=None) -> str:
        extra = {}
        if project_id:
            extra["projectId"] = project_id
        if date:
            extra["date"] = date
        res = self._request("tasks", extra_params=extra if extra else None)
        return json.dumps(res, ensure_ascii=False)

    def add_project_task(self, args: Dict) -> str:
        body = {
            "name": args.get("name"),
            "projectId": args.get("projectId"),
        }
        if args.get("startDate"):
            body["startDate"] = args["startDate"]
        if args.get("endDate"):
            body["endDate"] = args["endDate"]
        if args.get("assignee"):
            body["assignee"] = args["assignee"]
        res = self._request("tasks", method="POST", data=body)
        return json.dumps(res, ensure_ascii=False)

    def update_project_task(self, args: Dict) -> str:
        body = {"id": args.get("id")}
        for field in ("name", "startDate", "endDate", "progress", "status", "assignee"):
            if args.get(field) is not None:
                body[field] = args[field]
        res = self._request("tasks", method="PUT", data=body)
        return json.dumps(res, ensure_ascii=False)

    def delete_project_task(self, task_id: int) -> str:
        res = self._request("tasks", method="DELETE", data={"id": task_id})
        return json.dumps(res, ensure_ascii=False)

    def get_project_tasks_detail(self, project_id=None, date=None) -> str:
        extra = {}
        if project_id:
            extra["projectId"] = project_id
        if date:
            extra["date"] = date
        res = self._request("tasks_detail", extra_params=extra if extra else None)
        return json.dumps(res, ensure_ascii=False)

    # --- Aliases for langgraph_tools.py compatibility ---

    def get_projects(self):
        return json.loads(self.list_projects())

    def get_tasks(self, project_id=None, date=None):
        return json.loads(self.list_project_tasks(project_id=project_id, date=date))

    def create_task(self, name: str, project_id: int, start_date: str = None,
                    end_date: str = None, assignee: str = None):
        args = {"name": name, "projectId": project_id}
        if start_date:
            args["startDate"] = start_date
        if end_date:
            args["endDate"] = end_date
        if assignee:
            args["assignee"] = assignee
        return json.loads(self.add_project_task(args))

    def update_task(self, task_id: int, name: str = None, start_date: str = None,
                    end_date: str = None, assignee: str = None, status: str = None,
                    progress: int = None, description: str = None):
        args = {"id": task_id}
        if name is not None:
            args["name"] = name
        if start_date is not None:
            args["startDate"] = start_date
        if end_date is not None:
            args["endDate"] = end_date
        if assignee is not None:
            args["assignee"] = assignee
        if status is not None:
            args["status"] = status
        if progress is not None:
            args["progress"] = progress
        if description is not None:
            args["description"] = description
        return json.loads(self.update_project_task(args))

    def delete_task(self, task_id: int):
        return json.loads(self.delete_project_task(task_id))

    def get_tool_definitions(self) -> List[Dict]:
        return [
            {
                "name": "list_projects",
                "description": "등록된 모든 프로젝트 목록을 조회합니다.",
                "parameters": {"type": "object", "properties": {}}
            },
            {
                "name": "list_project_tasks",
                "description": "프로젝트 작업 목록을 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "projectId": {"type": "integer", "description": "프로젝트 ID (선택)"},
                        "date": {"type": "string", "description": "날짜 필터 (YYYY-MM-DD, 선택)"}
                    }
                }
            },
            {
                "name": "add_project_task",
                "description": "프로젝트에 새로운 작업을 추가합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "projectId": {"type": "integer", "description": "프로젝트 ID"},
                        "name": {"type": "string", "description": "작업 이름"},
                        "startDate": {"type": "string", "description": "시작 날짜 (YYYY-MM-DD)"},
                        "endDate": {"type": "string", "description": "종료 날짜 (YYYY-MM-DD)"},
                        "assignee": {"type": "string", "description": "담당자"}
                    },
                    "required": ["projectId", "name"]
                }
            },
            {
                "name": "update_project_task",
                "description": "프로젝트 작업을 수정합니다. (진행률, 이름, 날짜, 상태 등)",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer", "description": "작업 ID"},
                        "name": {"type": "string", "description": "작업 이름"},
                        "startDate": {"type": "string", "description": "시작 날짜 (YYYY-MM-DD)"},
                        "endDate": {"type": "string", "description": "종료 날짜 (YYYY-MM-DD)"},
                        "progress": {"type": "integer", "description": "진행률 (0~100)"},
                        "status": {"type": "string", "description": "작업 상태"},
                        "assignee": {"type": "string", "description": "담당자"}
                    },
                    "required": ["id"]
                }
            },
            {
                "name": "delete_project_task",
                "description": "프로젝트 작업을 삭제합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer", "description": "작업 ID"}
                    },
                    "required": ["id"]
                }
            },
            {
                "name": "get_project_tasks_detail",
                "description": "작업일지 작성을 위한 상세 정보를 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "projectId": {"type": "integer", "description": "프로젝트 ID (선택)"},
                        "date": {"type": "string", "description": "날짜 (YYYY-MM-DD, 선택)"}
                    }
                }
            }
        ]
