"""
MCP Server for Server Context
Provides tools for AI to access server information, files, and system status
"""
import os
import time
import psutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional
import logging

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    # Fallback if mcp is not installed yet
    FastMCP = None

from config import BASE_DIR, DATA_DIR

logger = logging.getLogger(__name__)

# Initialize MCP server
if FastMCP:
    mcp = FastMCP("ServerContext")
else:
    mcp = None
    logger.warning("MCP not installed. Run: pip install mcp")

# Initialize Google Calendar Client
try:
    from google_calendar_client import GoogleCalendarClient
    # Check if credentials exist before initializing to avoid error logs
    if (BASE_DIR / "credentials.json").exists() or (BASE_DIR / "token.json").exists():
        calendar_client = GoogleCalendarClient()
    else:
        calendar_client = None
        logger.info("Google Calendar credentials not found. Calendar tools disabled.")
except ImportError:
    calendar_client = None
    logger.warning("Google Calendar Client not found.")

# Server start time for uptime calculation
SERVER_START_TIME = time.time()


def get_safe_path(path: str) -> Optional[Path]:
    """
    Validate and return safe path within BASE_DIR
    
    Args:
        path: Requested path
        
    Returns:
        Safe Path object or None if invalid
    """
    try:
        # Resolve relative to BASE_DIR
        if not os.path.isabs(path):
            full_path = BASE_DIR / path
        else:
            full_path = Path(path)
        
        # Resolve to absolute path
        full_path = full_path.resolve()
        
        # Check if within BASE_DIR
        if not str(full_path).startswith(str(BASE_DIR.resolve())):
            logger.warning(f"Path {path} is outside BASE_DIR")
            return None
            
        return full_path
    except Exception as e:
        logger.error(f"Error validating path {path}: {e}")
        return None


@mcp.tool()
def get_server_time() -> dict:
    """
    Get current server time and uptime
    
    Returns:
        Dictionary with current time, uptime, and timezone
    """
    uptime_seconds = time.time() - SERVER_START_TIME
    uptime_hours = uptime_seconds / 3600
    
    return {
        "current_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "Asia/Seoul (UTC+9)",
        "uptime_hours": round(uptime_hours, 2),
        "uptime_days": round(uptime_hours / 24, 2)
    }


@mcp.tool()
def get_system_resources() -> dict:
    """
    Get system resource usage (CPU, Memory, Disk)
    
    Returns:
        Dictionary with CPU, memory, and disk usage
    """
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage(str(BASE_DIR))
        
        return {
            "cpu": {
                "usage_percent": cpu_percent,
                "cores": psutil.cpu_count()
            },
            "memory": {
                "total_gb": round(memory.total / (1024**3), 2),
                "used_gb": round(memory.used / (1024**3), 2),
                "available_gb": round(memory.available / (1024**3), 2),
                "usage_percent": memory.percent
            },
            "disk": {
                "total_gb": round(disk.total / (1024**3), 2),
                "used_gb": round(disk.used / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "usage_percent": disk.percent
            }
        }
    except Exception as e:
        logger.error(f"Error getting system resources: {e}")
        return {"error": str(e)}


@mcp.tool()
def list_files(path: str = ".") -> dict:
    """
    List files in a directory within BASE_DIR
    
    Args:
        path: Directory path (relative to BASE_DIR or absolute)
        
    Returns:
        Dictionary with list of files and directories
    """
    safe_path = get_safe_path(path)
    if not safe_path:
        return {"error": "Invalid path or path outside workspace"}
    
    if not safe_path.exists():
        return {"error": f"Path does not exist: {path}"}
    
    if not safe_path.is_dir():
        return {"error": f"Path is not a directory: {path}"}
    
    try:
        files = []
        directories = []
        
        for item in safe_path.iterdir():
            item_info = {
                "name": item.name,
                "size_bytes": item.stat().st_size if item.is_file() else None,
                "modified": datetime.fromtimestamp(item.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            }
            
            if item.is_file():
                files.append(item_info)
            elif item.is_dir():
                directories.append(item_info)
        
        return {
            "path": str(safe_path.relative_to(BASE_DIR)),
            "directories": directories,
            "files": files,
            "total_items": len(files) + len(directories)
        }
    except Exception as e:
        logger.error(f"Error listing files in {path}: {e}")
        return {"error": str(e)}


@mcp.tool()
def read_file(path: str) -> dict:
    """
    Read content of a file within BASE_DIR
    
    Args:
        path: File path (relative to BASE_DIR or absolute)
        
    Returns:
        Dictionary with file content and metadata
    """
    safe_path = get_safe_path(path)
    if not safe_path:
        return {"error": "Invalid path or path outside workspace"}
    
    if not safe_path.exists():
        return {"error": f"File does not exist: {path}"}
    
    if not safe_path.is_file():
        return {"error": f"Path is not a file: {path}"}
    
    try:
        # Try to read as text
        with open(safe_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return {
            "path": str(safe_path.relative_to(BASE_DIR)),
            "content": content,
            "size_bytes": safe_path.stat().st_size,
            "lines": len(content.splitlines()),
            "encoding": "utf-8"
        }
    except UnicodeDecodeError:
        return {"error": "File is not a text file (binary content)"}
    except Exception as e:
        logger.error(f"Error reading file {path}: {e}")
        return {"error": str(e)}


@mcp.tool()
def write_file(path: str, content: str) -> dict:
    """
    Create or update a file within BASE_DIR
    
    Args:
        path: File path (relative to BASE_DIR or absolute)
        content: Content to write to the file
        
    Returns:
        Dictionary with operation result
    """
    safe_path = get_safe_path(path)
    if not safe_path:
        return {"error": "Invalid path or path outside workspace"}
    
    try:
        # Create parent directories if needed
        safe_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write file
        with open(safe_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return {
            "success": True,
            "path": str(safe_path.relative_to(BASE_DIR)),
            "size_bytes": safe_path.stat().st_size,
            "lines": len(content.splitlines()),
            "message": "File created/updated successfully"
        }
    except Exception as e:
        logger.error(f"Error writing file {path}: {e}")
        return {"error": str(e)}


@mcp.tool()
def search_documents(query: str) -> dict:
    """
    Search through text/markdown files in memory/ directory (Simple RAG)
    
    Args:
        query: Search query string
        
    Returns:
        Dictionary with search results
    """
    # Expanded search directories
    search_dirs = [
        BASE_DIR / "memory",
        BASE_DIR / "data",
        BASE_DIR / "notes",
        BASE_DIR / "tasks",
        BASE_DIR / "workspace",
        BASE_DIR / "logs"
    ]
    results = []
    
    query_lower = query.lower()
    
    for search_dir in search_dirs:
        if not search_dir.exists():
            continue
            
        try:
            # Search through .txt and .md files
            for ext in ['*.txt', '*.md']:
                for file_path in search_dir.rglob(ext):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        # Simple search: check if query is in content
                        if query_lower in content.lower():
                            # Find relevant lines
                            lines = content.splitlines()
                            relevant_lines = []
                            
                            for i, line in enumerate(lines):
                                if query_lower in line.lower():
                                    # Include context (line before and after)
                                    start = max(0, i - 1)
                                    end = min(len(lines), i + 2)
                                    context = '\n'.join(lines[start:end])
                                    relevant_lines.append({
                                        "line_number": i + 1,
                                        "context": context
                                    })
                            
                            results.append({
                                "file": str(file_path.relative_to(BASE_DIR)),
                                "matches": len(relevant_lines),
                                "relevant_excerpts": relevant_lines[:3]  # Limit to 3 excerpts per file
                            })
                    except Exception as e:
                        logger.error(f"Error searching file {file_path}: {e}")
                        continue
        except Exception as e:
            logger.error(f"Error searching directory {search_dir}: {e}")
            continue
    
    return {
        "query": query,
        "total_files_found": len(results),
        "results": results[:10]  # Limit to top 10 files
    }


@mcp.tool()
def get_logs(lines: int = 50) -> dict:
    """
    Get last N lines from the bot log file
    
    Args:
        lines: Number of lines to retrieve (default: 50, max: 500)
        
    Returns:
        Dictionary with log content
    """
    log_file = BASE_DIR / "logs" / "aibot.log"
    
    if not log_file.exists():
        return {"error": "Log file does not exist"}
    
    # Limit lines to prevent excessive data
    lines = min(lines, 500)
    
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            all_lines = f.readlines()
        
        last_lines = all_lines[-lines:]
        
        return {
            "log_file": str(log_file.relative_to(BASE_DIR)),
            "total_lines": len(all_lines),
            "retrieved_lines": len(last_lines),
            "content": ''.join(last_lines)
        }
    except Exception as e:
        logger.error(f"Error reading log file: {e}")
        return {"error": str(e)}


@mcp.tool()
def add_google_calendar_event(summary: str, start_time: str, end_time: str = None) -> dict:
    """
    Add an event to Google Calendar
    
    Args:
        summary: Event title
        start_time: Start time (ISO 8601 format, e.g. '2026-02-10T14:00:00')
        end_time: End time (optional)
        
    Returns:
        Dictionary with event details
    """
    if not calendar_client:
        return {"error": "Google Calendar not configured. Please add credentials.json."}
        
    return calendar_client.add_event(summary, start_time, end_time)


@mcp.tool()
def list_google_calendar_events(count: int = 10) -> dict:
    """
    List upcoming Google Calendar events
    
    Args:
        count: Number of events to retrieve
        
    Returns:
        List of events
    """
    if not calendar_client:
        return {"error": "Google Calendar not configured. Please add credentials.json."}
        
    events = calendar_client.list_upcoming_events(count)
    return {"events": events}


@mcp.tool()
def delete_google_calendar_event(query: str, day: str = None) -> dict:
    """
    Delete an event from Google Calendar by searching for it
    
    Args:
        query: Search query string (e.g. 'meeting', 'lunch')
        day: Optional date filter (YYYY-MM-DD)
        
    Returns:
        Dictionary with operation result
    """
    if not calendar_client:
        return {"error": "Google Calendar not configured. Please add credentials.json."}
        
    # 1. Search for events
    events = calendar_client.search_events(query, day=day)
    
    if not events:
        return {"success": False, "message": f"'{query}' 관련 일정을 찾을 수 없습니다."}
        
    if len(events) == 1:
        # Found exactly one event, delete it
        event = events[0]
        if calendar_client.delete_event(event['id']):
            return {
                "success": True, 
                "message": f"일정이 삭제되었습니다: {event['summary']} ({event['start']})"
            }
        else:
            return {"success": False, "message": "일정 삭제 중 오류가 발생했습니다."}
    else:
        # Found multiple events
        event_list = "\\n".join([f"- {e['summary']} ({e['start']})" for e in events])
        return {
            "success": False, 
            "message": f"여러 개의 일정이 발견되었습니다. 더 구체적으로 말씀해주세요:\\n{event_list}"
        }


@mcp.tool()
def run_shell_command(command: str) -> dict:
    """
    Execute a shell command (Linux/Bash) and return the output.
    Now with automatic permission handling and robust path resolution.
    
    Args:
        command: The command to execute (e.g. 'ls -la', 'ps aux')
        
    Returns:
        Dictionary with stdout, stderr, and exit code
    """
    try:
        logger.info(f"Executing shell command: {command}")
        
        # Automatic Permission Handling for local scripts on Linux
        if os.name != 'nt':  # Not Linux/UNIX
            # Check if command starts with ./ or is a relative path to an existing .sh file
            cmd_parts = command.split()
            if cmd_parts:
                potential_script = cmd_parts[0]
                # Remove leading ./ or resolve relative path
                script_path = get_safe_path(potential_script)
                
                if script_path and script_path.exists() and script_path.suffix in ['.sh', '.py']:
                    if not os.access(script_path, os.X_OK):
                        logger.info(f"Automatically granting execution permission to: {script_path}")
                        try:
                            os.chmod(script_path, 0o755)
                        except Exception as e:
                            logger.warning(f"Failed to chmod {script_path}: {e}")

        # Execute using bash -c for better portability
        # On Windows, this will usually fail unless Git Bash or WSL is in PATH
        shell_executable = "bash" if os.name != 'nt' else "powershell.exe"
        shell_flag = "-c" if os.name != 'nt' else "-Command"
        
        process = subprocess.Popen(
            [shell_executable, shell_flag, command],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(BASE_DIR)  # Execute from project root
        )
        
        stdout, stderr = process.communicate(timeout=60)
        
        return {
            "command": command,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": process.returncode,
            "success": process.returncode == 0
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out after 60 seconds", "command": command}
    except Exception as e:
        logger.error(f"Error executing shell command {command}: {e}")
        return {"error": str(e), "command": command}


if __name__ == "__main__":
    # Test the MCP server
    if mcp:
        print("MCP Server initialized successfully!")
        print("\nAvailable tools:")
        print("- get_server_time()")
        print("- get_system_resources()")
        print("- list_files(path='.')")
        print("- read_file(path)")
        print("- write_file(path, content)")
        print("- search_documents(query)")
        print("- get_logs(lines=50)")
        print("- add_google_calendar_event(summary, start, end)")
        print("- list_google_calendar_events(count)")
        
        # Test get_server_time
        print("\n=== Testing get_server_time ===")
        print(get_server_time())
        
        # Test get_system_resources
        print("\n=== Testing get_system_resources ===")
        print(get_system_resources())
    else:
        print("MCP not installed. Install with: pip install mcp")
