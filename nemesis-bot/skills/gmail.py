
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

class GmailSkill:
    """Gmail API 기반 이메일 스킬 (새 메일 알림, 요약, 발송)"""

    def __init__(self, gmail_client=None):
        self._client = gmail_client

    @property
    def client(self):
        if self._client is None:
            try:
                from gmail_client import GmailClient
                self._client = GmailClient()
            except Exception as e:
                logger.error(f"GmailClient init error: {e}")
        return self._client

    def get_unread_summary(self, max_results: int = 5) -> str:
        """미읽은 메일 요약 텍스트 반환"""
        if not self.client:
            return "⚠️ Gmail 클라이언트를 초기화할 수 없습니다."
        try:
            emails = self.client.get_unread_emails(max_results=max_results)
            if not emails:
                return "📭 미읽은 메일이 없습니다."

            lines = [f"📬 **미읽은 메일 {len(emails)}건**\n"]
            for i, m in enumerate(emails, 1):
                lines.append(f"{i}. **{m['subject']}**")
                lines.append(f"   👤 발신: {m['from']}")
                lines.append(f"   📅 {m['date']}")
                snippet = m.get("snippet", "")[:120]
                if snippet:
                    lines.append(f"   💬 {snippet}...")
                lines.append("")
            return "\n".join(lines).strip()
        except Exception as e:
            logger.error(f"GmailSkill.get_unread_summary: {e}")
            return f"⚠️ 메일 조회 중 오류: {e}"

    def get_unread_emails_raw(self, max_results: int = 5) -> List[Dict]:
        """미읽은 메일 raw 데이터 반환 (알림용)"""
        if not self.client:
            return []
        try:
            return self.client.get_unread_emails(max_results=max_results)
        except Exception as e:
            logger.error(f"GmailSkill.get_unread_emails_raw: {e}")
            return []

    def send_email(self, to: str, subject: str, body: str) -> Dict:
        """메일 발송"""
        if not self.client:
            return {"error": "Gmail 클라이언트를 초기화할 수 없습니다."}
        try:
            return self.client.send_email(to=to, subject=subject, body=body)
        except Exception as e:
            logger.error(f"GmailSkill.send_email: {e}")
            return {"error": str(e)}

    def get_my_email(self) -> str:
        """내 Gmail 주소 반환"""
        if not self.client:
            return ""
        return self.client.get_my_email()

    def mark_as_read(self, msg_id: str) -> bool:
        """메일 읽음 처리"""
        if not self.client:
            return False
        return self.client.mark_as_read(msg_id)

    def get_tool_definitions(self) -> List[dict]:
        return [
            {
                "name": "check_gmail",
                "description": "Gmail 받은편지함의 미읽은 메일 목록과 간략한 내용을 조회합니다. 사용자가 '메일 확인', '이메일 확인', '받은편지함' 등을 요청할 때 사용하세요.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_results": {
                            "type": "integer",
                            "description": "조회할 최대 메일 수 (기본값: 5)"
                        }
                    }
                }
            },
            {
                "name": "send_gmail",
                "description": "Gmail로 이메일을 발송합니다. 사용자가 '이메일 보내줘', '메일 전송', '이메일 전송' 등을 요청할 때 사용하세요.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "to": {
                            "type": "string",
                            "description": "수신자 이메일 주소 (예: example@gmail.com)"
                        },
                        "subject": {
                            "type": "string",
                            "description": "이메일 제목"
                        },
                        "body": {
                            "type": "string",
                            "description": "이메일 본문 내용"
                        }
                    },
                    "required": ["to", "subject", "body"]
                }
            }
        ]

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "check_gmail":
            summary = self.get_unread_summary(max_results=args.get("max_results", 5))
            return {"summary": summary}
        elif tool_name == "send_gmail":
            return self.send_email(to=args.get("to"), subject=args.get("subject"), body=args.get("body"))
        return {"error": "Unknown tool"}
