import os
import logging
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from config import BASE_DIR

logger = logging.getLogger(__name__)

class GoogleAuthManager:
    """
    Manages Google OAuth 2.0 authentication for multiple scopes (Calendar, Gmail).
    Uses a single token file (token_google.json) and credentials.json.
    """
    
    # Combined scopes for Calendar and Gmail
    SCOPES = [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
    ]
    
    CREDENTIALS_PATH = BASE_DIR / "credentials.json"
    TOKEN_PATH = BASE_DIR / "token_google.json"
    
    @classmethod
    def get_credentials(cls):
        """
        Get valid user credentials from storage.
        If credentials are valid or can be refreshed, returns them.
        If not (and no interaction is possible here), returns None.
        """
        creds = None
        
        if os.path.exists(cls.TOKEN_PATH):
            try:
                creds = Credentials.from_authorized_user_file(str(cls.TOKEN_PATH), cls.SCOPES)
            except Exception as e:
                logger.error(f"Error loading token from {cls.TOKEN_PATH}: {e}")
                return None

        # If there are no (valid) credentials available, let the user log in.
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                    # Save the refreshed credentials
                    with open(cls.TOKEN_PATH, "w") as token:
                        token.write(creds.to_json())
                    return creds
                except Exception as e:
                    logger.warning(f"Failed to refresh token: {e}")
                    return None
            else:
                return None
        
        return creds

    @classmethod
    def setup(cls, use_console=False):
        """
        Performs the initial authentication flow.
        This MUST be run in an environment where a browser can be opened or a link clicked.
        Args:
            use_console (bool): If True, use console-based copy-paste flow (for remote servers).
        """
        print(f"Checking for credentials at: {cls.CREDENTIALS_PATH}")
        if not os.path.exists(cls.CREDENTIALS_PATH):
            print(f"[ERROR] 'credentials.json' not found at {cls.CREDENTIALS_PATH}")
            print("Please download your OAuth 2.0 Client ID JSON file from Google Cloud Console")
            print("and save it as 'credentials.json' in the bot directory.")
            return False

        creds = cls.get_credentials()
        
        if not creds or not creds.valid:
            print("Starting new authentication flow...")
            try:
                flow = InstalledAppFlow.from_client_secrets_file(
                    str(cls.CREDENTIALS_PATH), cls.SCOPES
                )
                
                if use_console:
                    # Manual console flow for google-auth-oauthlib >= 1.0.0
                    try:
                        # Use localhost redirect (standard for installed apps)
                        # The user will get a connection error, but the code will be in the URL
                        flow.redirect_uri = 'http://localhost'
                        auth_url, _ = flow.authorization_url(prompt='consent')

                        print("\n[REMOTE MODE] Authentication Instructions:")
                        print("1. Visit the URL below in your browser.")
                        print("2. Log in and authorize the app.")
                        print("3. Your browser will redirect to 'http://localhost/...' and fail to connect.")
                        print("4. Copy the **ENTIRE URL** of that failed page from your address bar.")
                        print("5. Paste it below.")
                        print("-" * 80)
                        print(auth_url)
                        print("-" * 80)
                        
                        code_input = input("\nEnter the failed URL (or just the code): ").strip()
                        
                        # Extract code if full URL is pasted
                        if "code=" in code_input:
                            try:
                                import urllib.parse
                                parsed = urllib.parse.urlparse(code_input)
                                query = urllib.parse.parse_qs(parsed.query)
                                code = query.get("code", [None])[0]
                                if not code:
                                    # Handle case where code might be in fragment or elsewhere if weirdly formatted
                                    raise ValueError("Could not find 'code' param")
                            except Exception:
                                # Fallback: try simple string splitting if parsing fails
                                code = code_input.split("code=")[1].split("&")[0]
                        else:
                            code = code_input

                        flow.fetch_token(code=code)
                        creds = flow.credentials
                    except Exception as e:
                        print(f"\n[ERROR] Console flow failed: {e}")
                        return False
                else:
                    print("\n[LOCAL MODE] Opening browser for authentication...")
                    creds = flow.run_local_server(port=0)
                
                
                # Save the credentials for the next run
                with open(cls.TOKEN_PATH, "w") as token:
                    token.write(creds.to_json())
                
                print(f"[OK] Authentication successful! Token saved to '{cls.TOKEN_PATH.name}'")
                return True
            except Exception as e:
                print(f"[FAIL] Authentication failed: {e}")
                return False
        else:
            print("[OK] Valid credentials already exist.")
            return True

if __name__ == "__main__":
    # Test/Setup when run directly
    logging.basicConfig(level=logging.INFO)
    GoogleAuthManager.setup()
