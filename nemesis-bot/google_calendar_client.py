import logging
import datetime
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google_auth_manager import GoogleAuthManager

# Logging implementation
logger = logging.getLogger(__name__)

class GoogleCalendarClient:
    def __init__(self):
        self.service = None
        self._authenticate()

    def _authenticate(self):
        """Authenticate using GoogleAuthManager."""
        try:
            creds = GoogleAuthManager.get_credentials()
            if creds and creds.valid:
                self.service = build("calendar", "v3", credentials=creds)
                logger.info("Google Calendar API service built successfully.")
            else:
                logger.warning("No valid credentials found. Please run setup_google.py first.")
                self.service = None
        except Exception as e:
            logger.error(f"Failed to authenticate with Google Calendar: {e}")
            self.service = None

    def add_event(self, summary, start_time, end_time=None, description="Created by AI Bot"):
        """
        Add an event to the primary calendar.
        
        Args:
            summary (str): Title of the event
            start_time (datetime or str): Start time (ISO format string or datetime object)
            end_time (datetime or str, optional): End time. If None, defaults to start_time + 1 hour.
            description (str): Description of the event
            
        Returns:
            dict: Created event details or error
        """
        if not self.ensure_authenticated():
            return {"error": "Calendar service not initialized. Check credentials."}

        try:
            # Ensure time format is ISO 8601 string
            if isinstance(start_time, datetime.datetime):
                start_iso = start_time.isoformat()
            else:
                start_iso = str(start_time)
            
            if " " in start_iso[:19]:
                start_iso = start_iso[:19].replace(" ", "T") + start_iso[19:]
                
            if end_time:
                if isinstance(end_time, datetime.datetime):
                    end_iso = end_time.isoformat()
                else:
                    end_iso = str(end_time)
                
                if " " in end_iso[:19]:
                    end_iso = end_iso[:19].replace(" ", "T") + end_iso[19:]
            else:
                # Default duration: 1 hour if start_time is datetime, otherwise hard to guess
                # Assuming input is valid ISO string, we try to parse it
                try:
                    dt_start = datetime.datetime.fromisoformat(start_iso)
                    dt_end = dt_start + datetime.timedelta(hours=1)
                    end_iso = dt_end.isoformat()
                except ValueError:
                    return {"error": "Invalid start_time format. Use ISO 8601."}

            event = {
                "summary": summary,
                "description": description,
                "start": {
                    "dateTime": start_iso,
                    "timeZone": "Asia/Seoul",
                },
                "end": {
                    "dateTime": end_iso,
                    "timeZone": "Asia/Seoul",
                },
            }

            event = self.service.events().insert(calendarId="primary", body=event).execute()
            logger.info(f"Event created: {event.get('htmlLink')}")
            return {
                "success": True, 
                "message": f"Event created: {summary}", 
                "link": event.get('htmlLink'),
                "id": event.get('id')
            }

        except HttpError as error:
            logger.error(f"An error occurred: {error}")
            return {"error": str(error)}
        except Exception as e:
            logger.error(f"Unexpected error adding event: {e}")
            return {"error": str(e)}

    def list_upcoming_events(self, max_results=10):
        """List upcoming events."""
        if not self.service:
            # Re-try authentication if service is missing (maybe transient error or first run fail)
            self._authenticate()
            if not self.service:
                 return {"error": "Calendar service not initialized."}

        try:
            now = datetime.datetime.utcnow().isoformat() + "Z"  # 'Z' indicates UTC time
            events_result = (
                self.service.events()
                .list(
                    calendarId="primary",
                    timeMin=now,
                    maxResults=max_results,
                    singleEvents=True,
                    orderBy="startTime",
                )
                .execute()
            )
            events = events_result.get("items", [])

            if not events:
                return []

            result_list = []
            for event in events:
                start = event["start"].get("dateTime", event["start"].get("date"))
                result_list.append({
                    "summary": event["summary"],
                    "start": start,
                    "link": event.get("htmlLink")
                })
            return result_list

        except HttpError as error:
            logger.error(f"An error occurred: {error}")
            return {"error": str(error)}

    def get_events_by_date(self, date: str = None, days: int = 1, max_results: int = 20):
        """
        특정 날짜(범위)의 모든 일정을 조회합니다.

        Args:
            date: 조회 날짜 (YYYY-MM-DD). None이면 오늘.
            days: 조회할 일 수 (기본 1일).
            max_results: 최대 결과 수.

        Returns:
            List of events
        """
        if not self.ensure_authenticated():
            return {"error": "Calendar service not initialized."}

        try:
            now_local = datetime.datetime.now()

            if date in (None, '', 'today', '오늘'):
                day_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
            elif date in ('yesterday', '어제'):
                day_start = (now_local - datetime.timedelta(days=1)).replace(
                    hour=0, minute=0, second=0, microsecond=0)
            elif date in ('tomorrow', '내일'):
                day_start = (now_local + datetime.timedelta(days=1)).replace(
                    hour=0, minute=0, second=0, microsecond=0)
            else:
                day_start = datetime.datetime.strptime(date, "%Y-%m-%d")

            day_end = day_start + datetime.timedelta(days=days)

            # KST(+9) → UTC: KST 시간에서 9시간을 빼면 UTC
            kst_offset = datetime.timedelta(hours=9)
            time_min = (day_start - kst_offset).isoformat() + 'Z'
            time_max = (day_end - kst_offset).isoformat() + 'Z'

            events_result = self.service.events().list(
                calendarId='primary',
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()

            events = events_result.get('items', [])
            formatted = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                end = event['end'].get('dateTime', event['end'].get('date'))
                formatted.append({
                    'id': event['id'],
                    'summary': event.get('summary', '(제목 없음)'),
                    'start': start,
                    'end': end,
                    'location': event.get('location', ''),
                    'description': event.get('description', ''),
                    'link': event.get('htmlLink', '')
                })
            return formatted

        except Exception as e:
            logger.error(f"Error getting events by date: {e}")
            return {"error": str(e)}

    def search_events(self, query: str, max_results: int = 5, day: str = None):
        """
        Search for events matching a query.
        
        Args:
            query: Search query text
            max_results: Maximum number of results to return
            day: Optional date to filter by (YYYY-MM-DD)
            
        Returns:
            List of matching events
        """
        if not self.ensure_authenticated():
            return []
            
        try:
            now_kst = datetime.datetime.now()
            kst_offset = datetime.timedelta(hours=9)
            time_min = (now_kst - kst_offset).isoformat() + 'Z'
            time_max = None

            # 1. Resolve relative dates (KST 기준)
            if day == 'today':
                day = now_kst.strftime("%Y-%m-%d")
            elif day == 'tomorrow':
                day = (now_kst + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

            # 2. Filter by specific day if provided (KST → UTC 변환)
            if day:
                try:
                    day_start = datetime.datetime.strptime(day, "%Y-%m-%d")
                    day_end = day_start + datetime.timedelta(days=1)
                    time_min = (day_start - kst_offset).isoformat() + 'Z'
                    time_max = (day_end - kst_offset).isoformat() + 'Z'
                    logger.info(f"Filtering calendar search for day: {day} ({time_min} to {time_max})")
                except ValueError:
                    logger.warning(f"Invalid date format: {day}")
            
            # 3. Use q parameter for search query if provided
            list_params = {
                "calendarId": 'primary',
                "timeMin": time_min,
                "maxResults": max_results,
                "singleEvents": True,
                "orderBy": 'startTime'
            }
            if time_max:
                list_params["timeMax"] = time_max
            if query:
                list_params["q"] = query
                
            events_result = self.service.events().list(**list_params).execute()
            
            events = events_result.get('items', [])
            
            formatted_events = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                formatted_events.append({
                    'id': event['id'],
                    'summary': event.get('summary', 'No Title'),
                    'start': start,
                    'link': event.get('htmlLink', '')
                })
                
            return formatted_events
            
        except Exception as e:
            logger.error(f"Error searching events: {e}")
            return []

    def update_event(self, event_id: str, summary: str = None,
                     start_time: str = None, end_time: str = None,
                     description: str = None) -> dict:
        """
        기존 이벤트를 수정합니다.

        Args:
            event_id: 수정할 이벤트 ID
            summary: 새 제목 (선택)
            start_time: 새 시작 시간 ISO 8601 (선택)
            end_time: 새 종료 시간 ISO 8601 (선택)
            description: 새 설명 (선택)

        Returns:
            dict: 수정된 이벤트 정보 또는 오류
        """
        if not self.ensure_authenticated():
            return {"error": "Calendar service not initialized."}
        try:
            event = self.service.events().get(calendarId="primary", eventId=event_id).execute()

            if summary is not None:
                event["summary"] = summary
            if description is not None:
                event["description"] = description
            if start_time is not None:
                start_iso = str(start_time).replace(" ", "T")
                event["start"] = {"dateTime": start_iso, "timeZone": "Asia/Seoul"}
            if end_time is not None:
                end_iso = str(end_time).replace(" ", "T")
                event["end"] = {"dateTime": end_iso, "timeZone": "Asia/Seoul"}

            updated = self.service.events().update(
                calendarId="primary", eventId=event_id, body=event
            ).execute()
            return {
                "success": True,
                "message": f"이벤트 수정 완료: {updated.get('summary')}",
                "link": updated.get("htmlLink"),
                "id": updated.get("id"),
            }
        except HttpError as error:
            logger.error(f"update_event HttpError: {error}")
            return {"error": str(error)}
        except Exception as e:
            logger.error(f"update_event error: {e}")
            return {"error": str(e)}

    def delete_event(self, event_id: str) -> bool:
        """
        Delete an event by ID.
        
        Args:
            event_id: The ID of the event to delete
            
        Returns:
            True if successful, False otherwise
        """
        if not self.ensure_authenticated():
            return False
            
        try:
            self.service.events().delete(calendarId='primary', eventId=event_id).execute()
            logger.info(f"Event {event_id} deleted successfully")
            return True
        except Exception as e:
            logger.error(f"Error deleting event: {e}")
            return False
            
    def ensure_authenticated(self):
        """Ensure service is authenticated."""
        if not self.service:
            self._authenticate()
        return self.service is not None
