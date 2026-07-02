
import logging
from ftplib import FTP
from pathlib import Path

logger = logging.getLogger(__name__)

class FTPSkill:
    """FTP 파일 전송 스킬"""
    
    def __init__(self):
        pass

    def upload_file(self, host, user, password, local_path, remote_path):
        """FTP로 파일 업로드"""
        try:
            ftp = FTP(host)
            ftp.login(user, password)
            
            with open(local_path, 'rb') as f:
                ftp.storbinary(f'STOR {remote_path}', f)
            
            ftp.quit()
            return f"Successfully uploaded {local_path} to {remote_path}"
        except Exception as e:
            logger.error(f"FTP upload error: {e}")
            return f"FTP Error: {str(e)}"
