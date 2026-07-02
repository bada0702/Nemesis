
import logging
from config import SKILLS_CONFIG

from .weather import WeatherSkill
from .news import NewsSkill
from .stock import StockSkill, StockRecommendationSkill
from .currency import CurrencySkill
from .crypto import CryptoSkill
from .search import SearchSkill
from .files import FileSkill
from .ftp import FTPSkill
from .system import SystemSkill
from .server import ServerSkill
from .notes import NoteSkill
from .tasks import TaskSkill
from .gmail import GmailSkill
from .project import ProjectScheduleSkill
from .flight_search import FlightSearchSkill
from .claude_coding import ClaudeCodingSkill
from .medical_knowledge import MedicalKnowledgeSkill
from .stock_trader import StockTraderSkill
from .trading_calc import TradingCalcSkill
from .autonomous_guardian import AutonomousGuardianSkill

logger = logging.getLogger(__name__)

class SkillsManager:
    """모든 스킬을 관리하는 통합 매니저"""
    
    def __init__(self):
        # Initialize skills based on config
        self.weather = WeatherSkill() if SKILLS_CONFIG.get("weather") else None
        self.search = SearchSkill() # 항상 활성화 (Brave 대체)
        self.news = NewsSkill(search_skill=self.search) if SKILLS_CONFIG.get("news") else None
        self.stock = StockSkill() if SKILLS_CONFIG.get("stock") else None
        self.currency = CurrencySkill(search_skill=self.search) if SKILLS_CONFIG.get("currency") else None
        self.system = SystemSkill() if SKILLS_CONFIG.get("system") else None
        self.note = NoteSkill() if SKILLS_CONFIG.get("note") else None
        self.task = TaskSkill() if SKILLS_CONFIG.get("task") else None
        self.crypto = CryptoSkill() if SKILLS_CONFIG.get("crypto") else None
        self.project = ProjectScheduleSkill() if SKILLS_CONFIG.get("project") else None
        
        # Initialize FileSkill with BASE_DIR
        from config import BASE_DIR
        self.files = FileSkill(BASE_DIR) if SKILLS_CONFIG.get("file") else None
        
        self.server = ServerSkill() if SKILLS_CONFIG.get("server") else None
        self.ftp = FTPSkill() if SKILLS_CONFIG.get("ftp") else None

        # Gmail 스킬 초기화
        if SKILLS_CONFIG.get("gmail"):
            try:
                # from gmail_client import GmailClient # Imported inside GmailSkill.client property
                self.gmail = GmailSkill()
                logger.info("GmailSkill initialized.")
            except Exception as e:
                logger.warning(f"GmailSkill disabled (auth required): {e}")
                self.gmail = None
        else:
            self.gmail = None
        
        # 주식 추천 스킬 초기화
        if SKILLS_CONFIG.get("stock_recommendation") and self.stock and self.news:
            self.stock_recommendation = StockRecommendationSkill(self.stock, self.news, self.search)
        else:
            self.stock_recommendation = None
        
        self.flight_search = FlightSearchSkill()
        self.claude_coding = ClaudeCodingSkill()
        self.medical_knowledge = MedicalKnowledgeSkill()
        self.stock_trader = StockTraderSkill()
        self.trading_calc = TradingCalcSkill()
        self.autonomous_guardian = AutonomousGuardianSkill()
        enabled_list = [k for k, v in SKILLS_CONFIG.items() if v]
        logger.info(f"SkillsManager initialized with enabled skills: {enabled_list}")
    
    def get_skill(self, skill_name: str):
        """스킬 가져오기"""
        return getattr(self, skill_name, None)
