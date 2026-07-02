import pymysql
import logging
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class ProjectSkill:
    """Project Schedule (Gantt) Skill for internal MySQL DB"""
    
    def __init__(self, host='localhost', user='root', password='', db='gantt_db'):
        self.host = host
        self.user = user
        self.password = password
        self.db = db
    
    def _get_connection(self):
        try:
            return pymysql.connect(
                host=self.host,
                user=self.user,
                password=self.password,
                database=self.db,
                cursorclass=pymysql.cursors.DictCursor
            )
        except Exception as e:
            logger.error(f"MySQL connection error: {e}")
            return None

    def get_projects(self) -> List[Dict]:
        """프로젝트 목록 조회"""
        conn = self._get_connection()
        if not conn:
            return [{"error": "DB 연결 실패"}]
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT id, name FROM projects WHERE is_active = 1")
                return cursor.fetchall()
        except Exception as e:
             logger.error(f"Error fetching projects: {e}")
             return [{"error": str(e)}]
        finally:
            conn.close()

    def get_tasks(self, project_name: str = None, project_id: int = None, date: str = None) -> List[Dict]:
        """일정(태스크) 조회"""
        conn = self._get_connection()
        if not conn:
             return [{"error": "DB 연결 실패"}]
             
        try:
            with conn.cursor() as cursor:
                sql = """
                    SELECT t.id, t.name, t.start_date, t.end_date, t.status, t.assignee, p.name as project_name 
                    FROM tasks t
                    JOIN projects p ON t.project_id = p.id
                    WHERE 1=1
                """
                params = []
                if project_name and project_name.lower() not in ['전체', 'all', '모든']:
                    sql += " AND p.name LIKE %s"
                    params.append(f'%{project_name}%')
                
                if project_id:
                    sql += " AND p.id = %s"
                    params.append(project_id)
                    
                if date:
                    # 해당 날짜가 시작일과 종료일 사이에 있거나 일치하는 경우
                    sql += " AND ((%s BETWEEN t.start_date AND t.end_date) OR (t.start_date = %s))"
                    params.extend([date, date])
                
                sql += " ORDER BY t.start_date ASC LIMIT 50"
                cursor.execute(sql, tuple(params) if params else None)
                
                rows = cursor.fetchall()
                # format datetime
                for row in rows:
                    if hasattr(row['start_date'], 'isoformat'):
                        row['start_date'] = row['start_date'].isoformat()[:10]
                    if hasattr(row['end_date'], 'isoformat'):
                        row['end_date'] = row['end_date'].isoformat()[:10]
                return rows
        except Exception as e:
             logger.error(f"Error fetching tasks: {e}")
             return [{"error": str(e)}]
        finally:
            conn.close()

    def add_task(self, project_name: str, name: str, start_date: str, end_date: str, assignee: str = '미배정') -> Dict:
        """일정(태스크) 추가"""
        conn = self._get_connection()
        if not conn:
             return {"error": "DB 연결 실패"}
             
        try:
            with conn.cursor() as cursor:
                # find project id
                cursor.execute("SELECT id FROM projects WHERE name LIKE %s LIMIT 1", (f'%{project_name}%',))
                proj = cursor.fetchone()
                if not proj:
                    return {"error": f"프로젝트 '{project_name}'를 찾을 수 없습니다."}
                
                project_id = proj['id']
                
                sql = """
                    INSERT INTO tasks (name, project_id, start_date, end_date, assignee, status, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'todo', NOW())
                """
                cursor.execute(sql, (name, project_id, start_date, end_date, assignee))
                conn.commit()
                return {"success": True, "message": f"[{project_name}] 프로젝트에 '{name}' 일정이 성공적으로 추가되었습니다."}
        except Exception as e:
            logger.error(f"Error adding task: {e}")
            return {"error": str(e)}
        finally:
            conn.close()

    def create_task(self, name: str, project_id: int, start_date: str, end_date: str, assignee: str = '미배정') -> Dict:
        """일정(태스크) 추가 (project_id 기반)"""
        conn = self._get_connection()
        if not conn:
             return {"error": "DB 연결 실패"}
             
        try:
            with conn.cursor() as cursor:
                sql = """
                    INSERT INTO tasks (name, project_id, start_date, end_date, assignee, status, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'todo', NOW())
                """
                cursor.execute(sql, (name, project_id, start_date, end_date, assignee))
                conn.commit()
                task_id = cursor.lastrowid
                return {"success": True, "id": task_id, "message": f"일정이 성공적으로 추가되었습니다."}
        except Exception as e:
            logger.error(f"Error creating task: {e}")
            return {"error": str(e)}
        finally:
            conn.close()

    def delete_task(self, task_identifier) -> Dict:
        """일정(태스크) 삭제 (ID 또는 이름 기반)"""
        conn = self._get_connection()
        if not conn:
             return {"error": "DB 연결 실패"}
             
        try:
            with conn.cursor() as cursor:
                if isinstance(task_identifier, int) or (isinstance(task_identifier, str) and task_identifier.isdigit()):
                    task_id = int(task_identifier)
                    cursor.execute("SELECT id, name FROM tasks WHERE id = %s", (task_id,))
                else:
                    cursor.execute("SELECT id, name FROM tasks WHERE name LIKE %s", (f'%{task_identifier}%',))
                
                tasks = cursor.fetchall()
                
                if not tasks:
                    return {"error": f"일정 '{task_identifier}'를 찾을 수 없습니다."}
                if len(tasks) > 1:
                    names = [t['name'] for t in tasks]
                    return {"error": f"'{task_identifier}'에 해당하는 일정이 여러 개 있습니다: {', '.join(names)}. ID로 구체화해주세요."}
                    
                task_id = tasks[0]['id']
                cursor.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
                conn.commit()
                return {"success": True, "message": f"일정 '{tasks[0]['name']}'이(가) 삭제되었습니다."}
        except Exception as e:
            logger.error(f"Error deleting task: {e}")
            return {"error": str(e)}
        finally:
            conn.close()
            
    def get_schedule_context(self, schedules: List[Dict]) -> str:
        """결과를 자연어로 변환"""
        if not schedules:
            return "🗓️ 예정된 일정이 전혀 없습니다."
        if isinstance(schedules, list) and len(schedules) > 0 and 'error' in schedules[0]:
            return f"⚠️ 오류 발생: {schedules[0]['error']}"
            
        lines = ["🗓️ **프로젝트 일정 현황**\n"]
        for t in schedules:
            status = '✅' if t['status'] == 'done' else '⏳' if t['status'] == 'doing' else '🕒'
            p_name = t.get('project_name', '')
            t_name = t.get('name', '')
            s_date = t.get('start_date', '')
            e_date = t.get('end_date', '')
            lines.append(f"- [{p_name}] **{t_name}**: {s_date} ~ {e_date} {status}")
            
        return "\n".join(lines).strip()
