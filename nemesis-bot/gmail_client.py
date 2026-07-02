"""
Gmail Client — Google Mail API (OAuth 2.0)
Uses GoogleAuthManager for unified authentication.
"""
import base64
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, List, Dict

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google_auth_manager import GoogleAuthManager

logger = logging.getLogger(__name__)

class GmailClient:
    """Gmail API Client using Unified GoogleAuthManager"""

    def __init__(self):
        self.service = None
        self._authenticate()

    # ── Authentication ──────────────────────────────────────────────────────────────
    def _authenticate(self):
        """Authenticate using GoogleAuthManager."""
        try:
            creds = GoogleAuthManager.get_credentials()
            if creds and creds.valid:
                self.service = build("gmail", "v1", credentials=creds)
                logger.info("Gmail API service initialized.")
            else:
                logger.warning("No valid credentials found. Please run setup_google.py first.")
                self.service = None
        except Exception as e:
            logger.error(f"Gmail authentication failed: {e}")
            self.service = None

    def ensure_authenticated(self) -> bool:
        if not self.service:
            self._authenticate()
        return self.service is not None

    # ── Get Unread Emails ──────────────────────────────────────────────────
    def get_unread_emails(self, max_results: int = 5) -> List[Dict]:
        """
        Returns list of unread messages: {id, from, subject, date, snippet}
        """
        if not self.ensure_authenticated():
            return []

        try:
            results = (
                self.service.users()
                .messages()
                .list(
                    userId="me",
                    labelIds=["INBOX", "UNREAD"],
                    maxResults=max_results,
                )
                .execute()
            )
            messages = results.get("messages", [])
            emails = []
            for msg in messages:
                detail = self.get_email_detail(msg["id"])
                if detail:
                    emails.append(detail)
            return emails
        except HttpError as e:
            logger.error(f"Gmail list error: {e}")
            return []

    # ── Get Email Detail ────────────────────────────────────────────────────
    def get_email_detail(self, msg_id: str) -> Optional[Dict]:
        """
        Returns single email detail: {id, from, to, subject, date, snippet, body}
        """
        if not self.ensure_authenticated():
            return None

        try:
            msg = (
                self.service.users()
                .messages()
                .get(userId="me", id=msg_id, format="full")
                .execute()
            )
            headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
            body = self._extract_body(msg["payload"])
            return {
                "id": msg_id,
                "from": headers.get("From", "Unknown"),
                "to": headers.get("To", ""),
                "subject": headers.get("Subject", "(No Subject)"),
                "date": headers.get("Date", ""),
                "snippet": msg.get("snippet", ""),
                "body": body[:500] if body else msg.get("snippet", ""),
            }
        except HttpError as e:
            logger.error(f"Gmail detail error ({msg_id}): {e}")
            return None

    def _extract_body(self, payload: Dict) -> str:
        """Extract email body (prefer text/plain)"""
        if payload.get("mimeType") == "text/plain":
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        # multipart
        for part in payload.get("parts", []):
            result = self._extract_body(part)
            if result:
                return result
        return ""

    # ── Mark as Read ─────────────────────────────────────────────────────────
    def mark_as_read(self, msg_id: str) -> bool:
        """Mark email as read"""
        if not self.ensure_authenticated():
            return False
        try:
            self.service.users().messages().modify(
                userId="me",
                id=msg_id,
                body={"removeLabelIds": ["UNREAD"]},
            ).execute()
            return True
        except HttpError as e:
            logger.error(f"Mark as read error ({msg_id}): {e}")
            return False

    # ── Send Email ─────────────────────────────────────────────────────────
    def send_email(self, to: str, subject: str, body: str) -> Dict:
        """
        Send an email.
        Args:
            to: Recipient email address
            subject: Subject
            body: Body (plain text)
        Returns:
            {"success": True, "message_id": ...} or {"error": ...}
        """
        if not self.ensure_authenticated():
            return {"error": "Gmail auth required."}

        try:
            msg = MIMEMultipart()
            msg["to"] = to
            msg["subject"] = subject
            msg.attach(MIMEText(body, "plain", "utf-8"))

            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
            sent = (
                self.service.users()
                .messages()
                .send(userId="me", body={"raw": raw})
                .execute()
            )
            logger.info(f"Email sent to {to}: {sent.get('id')}")
            return {
                "success": True,
                "message_id": sent.get("id"),
                "message": f"✅ Email sent to {to} ('{subject}')",
            }
        except HttpError as e:
            logger.error(f"Gmail send error: {e}")
            return {"error": str(e)}
        except Exception as e:
            logger.error(f"Unexpected send error: {e}")
            return {"error": str(e)}

    # ── Get My Email Address ───────────────────────────────────────────────
    def get_my_email(self) -> str:
        """Returns the authenticated email address"""
        if not self.ensure_authenticated():
            return ""
        try:
            profile = self.service.users().getProfile(userId="me").execute()
            return profile.get("emailAddress", "")
        except Exception:
            return ""


# ── Standalone Test ──────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    client = GmailClient()
    me = client.get_my_email()
    print(f"Authenticated Account: {me}")

    emails = client.get_unread_emails(max_results=3)
    print(f"Unread Emails ({len(emails)}):")
    for e in emails:
        print(f"  [{e['date']}] {e['from']} — {e['subject']}")
        print(f"    {e['snippet'][:80]}")
