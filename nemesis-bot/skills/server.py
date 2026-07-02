
import logging
import psutil
from datetime import datetime
from typing import List, Dict

logger = logging.getLogger(__name__)

class ServerSkill:
    """서버 상태 모니터링 스킬"""
    
    def get_server_status(self):
        """CPU, Memory, Disk 상태 조회"""
        try:
            t = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            return {
                "time": t,
                "cpu": {
                    "percent": cpu_percent
                },
                "memory": {
                    "total": memory.total,
                    "available": memory.available,
                    "percent": memory.percent
                },
                "disk": {
                    "total": disk.total,
                    "free": disk.free,
                    "percent": disk.percent
                }
            }
        except Exception as e:
            logger.error(f"Server status error: {e}")
            return {"error": str(e)}

    def get_tool_definitions(self) -> List[dict]:
        return [
            {
                "name": "get_server_time",
                "description": "서버의 현재 시간과 가동 시간(uptime)을 조회합니다.",
                "parameters": {"type": "object", "properties": {}}
            },
            {
                "name": "get_system_resources",
                "description": "서버의 시스템 리소스(CPU, 메모리, 디스크) 사용량을 조회합니다.",
                "parameters": {"type": "object", "properties": {}}
            }
        ]

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name in ["get_server_time", "get_system_resources"]:
            # Both map to get_server_status for now as it contains time and resources
            return self.get_server_status()
        return {"error": "Unknown tool"}
