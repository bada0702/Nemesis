"""
All-in-One Skills Package (No API keys required!)

통합 스킬 패키지:
- 날씨: Open-Meteo API
- 뉴스: RSS 피드
- 주식: yfinance
- 파일 관리: 로컬 파일 시스템
- FTP: FTP 프로토콜
- 시스템: 명령 실행, 프로세스 관리
- 노트: 로컬 JSON 기반
- 태스크: 로컬 JSON 기반
- 서버: 서버 모니터링 및 관리
- 검색: DuckDuckGo 기반 웹 검색 (API 키 불필요)
"""

import requests
import re
import requests
import re
# pyupbit, feedparser and yfinance are imported locally to prevent module failure if missing
import subprocess
import psutil
import psutil
import platform
import socket
import json
from ftplib import FTP
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
import logging
import os

# SSL Certificate Fix (for Windows/certifi issues)
try:
    import certifi
    os.environ['SSL_CERT_FILE'] = certifi.where()
except ImportError:
    pass

logger = logging.getLogger(__name__)


# ==================== 날씨 스킬 ====================
class WeatherSkill:
    """Open-Meteo Weather API (완전 무료, API 키 불필요)"""
    
    def __init__(self):
        self.base_url = "https://api.open-meteo.com/v1"
        self.geocoding_url = "https://geocoding-api.open-meteo.com/v1"
    
    def get_coordinates(self, location: str) -> Optional[Dict]:
        """위치의 좌표 조회"""
        # 한글 지명을 영어로 변환 (Open-Meteo는 영어 검색이 더 정확함)
        location_map = {
            "서울": "Seoul",
            "부산": "Busan",
            "대구": "Daegu",
            "인천": "Incheon",
            "광주": "Gwangju",
            "대전": "Daejeon",
            "울산": "Ulsan",
            "세종": "Sejong",
            "수원": "Suwon",
            "창원": "Changwon",
            "성남": "Seongnam",
            "고양": "Goyang",
            "용인": "Yongin",
            "제주": "Jeju",
            "춘천": "Chuncheon",
            "강릉": "Gangneung",
            "청주": "Cheongju",
            "천안": "Cheonan",
            "전주": "Jeonju",
            "포항": "Pohang",
            "경주": "Gyeongju"
        }
        
        search_location = location_map.get(location, location)
        
        try:
            response = requests.get(
                f"{self.geocoding_url}/search",
                params={"name": search_location, "count": 1, "language": "en"},
                timeout=10
            )
            data = response.json()
            if data.get("results"):
                return {
                    "lat": data["results"][0]["latitude"],
                    "lon": data["results"][0]["longitude"],
                    "name": location  # 원래 한글 이름 유지
                }
            return None
        except Exception as e:
            logger.error(f"Geocoding error for {location}: {e}")
            return None
    
    def get_weather(self, location: str) -> Dict:
        """현재 날씨 조회"""
        coords = self.get_coordinates(location)
        if not coords:
            return {"error": f"위치 '{location}'를 찾을 수 없습니다"}
        
        try:
            response = requests.get(
                f"{self.base_url}/forecast",
                params={
                    "latitude": coords["lat"],
                    "longitude": coords["lon"],
                    "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
                    "timezone": "Asia/Seoul"
                },
                timeout=10
            )
            data = response.json()
            
            weather_codes = {
                0: "맑음", 1: "대체로 맑음", 2: "부분 흐림", 3: "흐림",
                45: "안개", 48: "서리 안개",
                51: "이슬비", 53: "이슬비", 55: "이슬비",
                61: "비", 63: "비", 65: "강한 비",
                71: "눈", 73: "눈", 75: "강설",
                80: "소나기", 81: "소나기", 82: "강한 소나기"
            }
            
            return {
                "location": coords["name"],
                "temperature": data["current"]["temperature_2m"],
                "feels_like": data["current"]["apparent_temperature"],
                "humidity": data["current"]["relative_humidity_2m"],
                "wind_speed": data["current"]["wind_speed_10m"],
                "precipitation": data["current"]["precipitation"],
                "weather": weather_codes.get(data["current"]["weather_code"], "알 수 없음")
            }
        except Exception as e:
            logger.error(f"Weather API error: {e}")
            return {"error": str(e)}
    
    def get_weather_context(self, weather_data: Dict) -> str:
        """날씨 데이터를 자연어로 포맷팅 (레거시 호환)"""
        if "error" in weather_data:
            return f"⚠️ {weather_data['error']}"
        
        location = weather_data.get("location", "알 수 없음")
        temp = weather_data.get("temperature", 0)
        feels_like = weather_data.get("feels_like", 0)
        humidity = weather_data.get("humidity", 0)
        wind = weather_data.get("wind_speed", 0)
        weather = weather_data.get("weather", "알 수 없음")
        
        return f"""🌤️ **{location} 날씨 정보**

• 날씨: {weather}
• 기온: {temp}°C (체감 {feels_like}°C)
• 습도: {humidity}%
• 풍속: {wind} m/s
""".strip()


# ==================== 뉴스 스킬 ====================
class NewsSkill:
    """RSS 피드 기반 뉴스 스킬 (완전 무료, API 키 불필요)"""
    
    def __init__(self, search_skill=None):
        self.search_skill = search_skill
        self.feeds = {
            # 종합
            "연합뉴스": "https://www.yna.co.kr/rss/news.xml",
            "YTN": "https://www.ytn.co.kr/_comm/rss_list.php",
            "KBS": "https://news.kbs.co.kr/rss/news.xml",
            "MBC": "https://imnews.imbc.com/rss/news/",
            "SBS": "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01",
            "조선일보": "https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml",
            "중앙일보": "http://rss.joinsmsn.com/joins_news_list.xml",
            "한겨레": "http://www.hani.co.kr/rss/",
        }
        # IT/기술 전문 피드
        self.it_feeds = {
            "ZDNet Korea": "https://www.zdnet.co.kr/rss/index.xml",
            "디지털투데이": "https://www.digitaltoday.co.kr/rss/allArticle.xml",
            "IT조선": "https://it.chosun.com/site/data/rss/rss.xml",
            "전자신문": "https://www.etnews.com/rss/allNews.xml",
            "블로터": "https://www.bloter.net/feed",
        }
        # 경제/금융 피드
        self.economy_feeds = {
            "한국경제": "https://www.hankyung.com/feed/economy",
            "매일경제": "https://www.mk.co.kr/rss/30000001/",
            "머니투데이": "https://rss.mt.co.kr/rss/economy.xml",
        }
    
    def _fetch_feed(self, url: str, source: str, limit: int = 5) -> List[Dict]:
        """단일 RSS 피드에서 기사 가져오기"""
        try:
            import feedparser
            feed = feedparser.parse(url)
            items = []
            for entry in feed.entries[:limit]:
                summary = entry.get("summary", "")
                # HTML 태그 제거
                import re
                summary = re.sub(r'<[^>]+>', '', summary)[:200]
                items.append({
                    "source": source,
                    "title": entry.get("title", "제목 없음"),
                    "link": entry.get("link", ""),
                    "published": entry.get("published", ""),
                    "summary": summary,
                })
            return items
        except Exception as e:
            logger.error(f"Feed fetch error [{source}]: {e}")
            return []

    def get_headlines(self, source: str = "all", limit: int = 5) -> List[Dict]:
        """뉴스 헤드라인 가져오기"""
        headlines = []

        if source == "all":
            sources = list(self.feeds.keys())[:3]
        elif source in self.feeds:
            sources = [source]
        else:
            return [{"error": f"지원하지 않는 언론사: {source}"}]

        for src in sources:
            headlines.extend(self._fetch_feed(self.feeds[src], src, limit))

        return headlines

    def get_it_news(self, limit: int = 5) -> List[Dict]:
        """IT/기술 전문 뉴스 가져오기 (ZDNet, 전자신문 등)"""
        results = []
        for src, url in self.it_feeds.items():
            items = self._fetch_feed(url, src, limit=3)
            results.extend(items)
            if len(results) >= limit:
                break
        return results[:limit]

    def get_economy_news(self, limit: int = 5) -> List[Dict]:
        """경제/금융 뉴스 가져오기"""
        results = []
        for src, url in self.economy_feeds.items():
            items = self._fetch_feed(url, src, limit=3)
            results.extend(items)
            if len(results) >= limit:
                break
        return results[:limit]
    
    def search_news(self, keyword: str, limit: int = 5, locale: str = "kr", language: str = "ko") -> List[Dict]:
        """키워드로 뉴스 검색 (Naver 검색 우선 활용)"""
        # 1. SearchSkill이 있으면 더 넓은 범위의 최신 뉴스 검색 기능 활용
        if self.search_skill:
            try:
                search_query = f"{keyword} 뉴스"
                search_results = self.search_skill.search(search_query)
                if isinstance(search_results, list) and search_results:
                    results = []
                    for res in search_results[:limit]:
                        results.append({
                            "source": "웹 검색",
                            "title": res.get("title", "제목 없음"),
                            "link": res.get("link", ""),
                            "published": "실시간",
                            "summary": res.get("snippet", "")
                        })
                    return results
            except Exception as e:
                logger.error(f"NewsSkill search fallback error: {e}")

        # 2. RSS 피드 검색 (Fallback)
        all_headlines = self.get_headlines("all", limit=20)
        results = []
        for news in all_headlines:
            if keyword.lower() in news["title"].lower() or keyword.lower() in news.get("summary", "").lower():
                results.append(news)
                if len(results) >= limit:
                    break
        return results
    
    def get_top_news(self, limit: int = 5, locale: str = "kr") -> List[Dict]:
        """주요 뉴스 가져오기 (레거시 호환)"""
        return self.get_headlines("all", limit=limit)
    
    def get_news_context(self, news_data: List[Dict]) -> str:
        """뉴스 데이터를 자연어로 포맷팅 (레거시 호환)"""
        if not news_data:
            return "📰 뉴스를 찾을 수 없습니다."
        
        if isinstance(news_data, list) and news_data and "error" in news_data[0]:
            return f"⚠️ {news_data[0]['error']}"
        
        formatted = "📰 **뉴스 헤드라인**\n\n"
        for i, news in enumerate(news_data[:5], 1):
            source = news.get("source", "출처 없음")
            title = news.get("title", "제목 없음")
            link = news.get("link", "")
            summary = news.get("summary", "")[:100]
            
            formatted += f"{i}. **[{source}] {title}**\n"
            if summary:
                formatted += f"   {summary}...\n"
            if link:
                formatted += f"   🔗 {link}\n"
            formatted += "\n"
        
        return formatted.strip()


# ==================== 주식 스킬 ====================
class StockSkill:
    """Yahoo Finance 기반 주식 스킬 (완전 무료, API 키 불필요!)"""
    
    def __init__(self):
        self.kr_stocks = {
            "삼성전자": "005930.KS", "SK하이닉스": "000660.KS", "NAVER": "035420.KS",
            "카카오": "035720.KS", "현대차": "005380.KS", "LG화학": "051910.KS",
            "삼성바이오로직스": "207940.KS", "기아": "000270.KS", "포스코홀딩스": "005490.KS"
        }
        self.us_stocks = {
            "애플": "AAPL", "마이크로소프트": "MSFT", "구글": "GOOGL",
            "아마존": "AMZN", "테슬라": "TSLA", "엔비디아": "NVDA",
            "메타": "META", "넷플릭스": "NFLX"
        }
    
    def get_stock_price(self, symbol: str) -> Dict:
        """주식 현재가 조회"""
        try:
            if symbol in self.kr_stocks:
                symbol = self.kr_stocks[symbol]
            elif symbol in self.us_stocks:
                symbol = self.us_stocks[symbol]
            
            import yfinance as yf
            stock = yf.Ticker(symbol)
            info = stock.info
            
            return {
                "symbol": symbol,
                "name": info.get("longName", symbol),
                "price": info.get("currentPrice", info.get("regularMarketPrice", 0)),
                "change": info.get("regularMarketChange", 0),
                "change_percent": info.get("regularMarketChangePercent", 0),
                "volume": info.get("volume", 0),
                "market_cap": info.get("marketCap", 0),
                "currency": info.get("currency", "KRW")
            }
        except Exception as e:
            logger.error(f"Stock API error for {symbol}: {e}")
            return {"error": f"주식 정보 조회 실패: {str(e)}"}
    
    def get_stock_quote(self, symbol: str) -> Dict:
        """주식 시세 조회 (레거시 호환)"""
        result = self.get_stock_price(symbol)
        if "error" in result:
            return result
        
        # Alpha Vantage 형식으로 변환
        return {
            "Global Quote": {
                "01. symbol": result.get("symbol", ""),
                "05. price": str(result.get("price", 0)),
                "09. change": str(result.get("change", 0)),
                "10. change percent": f"{result.get('change_percent', 0)}%"
            }
        }
    
    def get_quote_context(self, quote_data: Dict) -> str:
        """주식 시세 데이터를 자연어로 포맷팅 (레거시 호환)"""
        if "error" in quote_data:
            return f"⚠️ {quote_data['error']}"
        
        global_quote = quote_data.get("Global Quote", {})
        if not global_quote or not global_quote.get("05. price"):
            return "⚠️ 주식 정보를 찾을 수 없습니다."
        
        symbol = global_quote.get("01. symbol", "알 수 없음")
        price = global_quote.get("05. price", "0")
        change = global_quote.get("09. change", "0")
        change_percent = global_quote.get("10. change percent", "0%")
        
        # 변동 방향 이모지
        change_float = float(change) if change else 0
        emoji = "📈" if change_float > 0 else "📉" if change_float < 0 else "➡️"
        
        return f"""📊 **{symbol} 주가 정보**

• 현재가: {price}
• 변동: {change} ({change_percent}) {emoji}
""".strip()


# ==================== 환율 스킬 ====================
class CurrencySkill:
    """Yahoo Finance 기반 환율 스킬 (완전 무료, API 키 불필요!)"""
    
    def __init__(self, search_skill=None):
        self.search_skill = search_skill
        self.currency_pairs = {
            "달러": "USDKRW=X",
            "엔": "JPYKRW=X",
            "유로": "EURKRW=X",
            "위안": "CNYKRW=X",
            "파운드": "GBPKRW=X",
            "USD": "USDKRW=X",
            "JPY": "JPYKRW=X",
            "EUR": "EURKRW=X",
            "CNY": "CNYKRW=X",
            "GBP": "GBPKRW=X"
        }
    
    def get_exchange_rate(self, currency: str = "달러") -> Dict:
        """환율 조회"""
        try:
            # 통화 매핑
            symbol = self.currency_pairs.get(currency, currency)
            if currency in self.currency_pairs:
                symbol = self.currency_pairs[currency]
            elif not symbol.endswith("=X"):
                symbol = f"{symbol}KRW=X"
            
            import yfinance as yf
            # yfinance로 환율 조회
            ticker = yf.Ticker(symbol)
            
            # 최근 데이터 가져오기
            hist = ticker.history(period="1d")
            if hist.empty:
                # 5일 데이터로 재시도 (주말 등 대비)
                hist = ticker.history(period="5d")
                
            if hist.empty:
                return {"error": f"{currency} 환율 정보를 찾을 수 없습니다"}
            
            current_rate = hist['Close'].iloc[-1]
            prev_rate = hist['Open'].iloc[-1]
            if len(hist) > 1:
                prev_rate = hist['Close'].iloc[-2]
                
            change = current_rate - prev_rate
            change_percent = (change / prev_rate * 100) if prev_rate else 0
            
            return {
                "currency": currency,
                "symbol": symbol,
                "rate": round(current_rate, 2),
                "change": round(change, 2),
                "change_percent": round(change_percent, 2)
            }
        except Exception as e:
            logger.error(f"Currency API error for {currency}: {e}")
            return {"error": f"환율 정보 조회 실패: {str(e)}"}
    
    def get_exchange_rate_context(self, rate_data: Dict) -> str:
        """환율 데이터를 자연어로 포맷팅"""
        if "error" in rate_data:
            return f"⚠️ {rate_data['error']}"
        
        currency = rate_data.get("currency", "알 수 없음")
        rate = rate_data.get("rate", 0)
        change = rate_data.get("change", 0)
        change_percent = rate_data.get("change_percent", 0)
        
        # 변동 방향 이모지
        emoji = "📈" if change > 0 else "📉" if change < 0 else "➡️"
        sign = "+" if change > 0 else ""
        
        return f"""💱 **{currency} 환율 정보**

• 현재 환율: {rate:,.2f}원
• 전일 대비: {sign}{change:,.2f}원 ({sign}{change_percent:.2f}%) {emoji}
""".strip()


# ==================== 파일 관리 스킬 ====================
class FileSkill:
    """파일 생성/수정/삭제 스킬"""
    
    def __init__(self, base_dir: str = None):
        if base_dir:
            self.base_dir = Path(base_dir)
        else:
            self.base_dir = BASE_DIR / "workspace"
        self.base_dir.mkdir(parents=True, exist_ok=True)
    
    def create_file(self, filename: str, content: str) -> Dict:
        """파일 생성"""
        try:
            filepath = self.base_dir / filename
            filepath.parent.mkdir(parents=True, exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return {"success": True, "message": f"파일 생성 완료: {filepath}", "path": str(filepath)}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def read_file(self, filename: str) -> Dict:
        """파일 읽기"""
        try:
            filepath = self.base_dir / filename
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            return {"success": True, "content": content, "path": str(filepath)}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def delete_file(self, filename: str) -> Dict:
        """파일 삭제"""
        try:
            filepath = self.base_dir / filename
            filepath.unlink()
            return {"success": True, "message": f"파일 삭제 완료: {filepath}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def list_files(self, directory: str = ".") -> List[str]:
        """디렉토리 파일 목록"""
        try:
            dirpath = self.base_dir / directory
            return [f.name for f in dirpath.iterdir()]
        except Exception as e:
            return [f"Error: {str(e)}"]


# ==================== FTP 스킬 ====================
class FTPSkill:
    """FTP 파일 업로드/다운로드 스킬"""
    
    def __init__(self):
        self.ftp = None
    
    def connect(self, host: str, user: str, password: str, port: int = 21) -> Dict:
        """FTP 서버 연결"""
        try:
            self.ftp = FTP()
            self.ftp.connect(host, port)
            self.ftp.login(user, password)
            return {"success": True, "message": f"FTP 연결 성공: {host}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def upload_file(self, local_path: str, remote_path: str) -> Dict:
        """파일 업로드"""
        try:
            if not self.ftp:
                return {"success": False, "error": "FTP 연결이 필요합니다"}
            with open(local_path, 'rb') as f:
                self.ftp.storbinary(f'STOR {remote_path}', f)
            return {"success": True, "message": f"업로드 완료: {local_path} → {remote_path}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def disconnect(self) -> Dict:
        """FTP 연결 종료"""
        try:
            if self.ftp:
                self.ftp.quit()
                self.ftp = None
            return {"success": True, "message": "FTP 연결 종료"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ==================== 시스템 스킬 ====================
class SystemSkill:
    """시스템 명령 실행 및 프로세스 관리 스킬"""
    
    def run_command(self, command: str, shell: bool = True) -> Dict:
        """시스템 명령 실행"""
        try:
            result = subprocess.run(command, shell=shell, capture_output=True, text=True, timeout=30)
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_system_info(self) -> Dict:
        """시스템 정보 조회"""
        try:
            return {
                "platform": platform.system(),
                "cpu_count": psutil.cpu_count(),
                "cpu_percent": psutil.cpu_percent(interval=1),
                "memory_percent": psutil.virtual_memory().percent,
                "disk_percent": psutil.disk_usage(str(BASE_DIR)).percent
            }
        except Exception as e:
            return {"error": str(e)}
    
    def list_processes(self, limit: int = 10) -> List[Dict]:
        """실행 중인 프로세스 목록"""
        try:
            processes = []
            for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
                try:
                    processes.append(proc.info)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            processes.sort(key=lambda x: x.get('cpu_percent', 0), reverse=True)
            return processes[:limit]
        except Exception as e:
            return [{"error": str(e)}]


# ==================== 노트 스킬 ====================
class NoteSkill:
    """노트 관리 스킬 (로컬 JSON 기반)"""
    
    def __init__(self, notes_dir: str = None):
        if notes_dir:
            self.notes_dir = Path(notes_dir)
        else:
            self.notes_dir = BASE_DIR / "notes"
        self.notes_dir.mkdir(parents=True, exist_ok=True)
        self.notes_file = self.notes_dir / "notes.json"
        self._load_notes()
    
    def _load_notes(self):
        if self.notes_file.exists():
            with open(self.notes_file, 'r', encoding='utf-8') as f:
                self.notes = json.load(f)
        else:
            self.notes = []
    
    def _save_notes(self):
        with open(self.notes_file, 'w', encoding='utf-8') as f:
            json.dump(self.notes, f, ensure_ascii=False, indent=2)
    
    def create_note(self, title: str, content: str, tags: List[str] = None) -> Dict:
        """노트 생성"""
        try:
            note = {
                "id": len(self.notes) + 1,
                "title": title,
                "content": content,
                "tags": tags or [],
                "created_at": datetime.now().isoformat()
            }
            self.notes.append(note)
            self._save_notes()
            return {"success": True, "message": f"노트 생성 완료: {title}", "note_id": note["id"]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def list_notes(self, limit: int = 10) -> List[Dict]:
        """노트 목록"""
        return self.notes[:limit]
    
    def search_notes(self, keyword: str) -> List[Dict]:
        """노트 검색"""
        return [n for n in self.notes if keyword.lower() in n["title"].lower() or keyword.lower() in n["content"].lower()]


# ==================== 태스크 스킬 ====================
class TaskSkill:
    """태스크 관리 스킬 (로컬 JSON 기반)"""
    
    def __init__(self, tasks_dir: str = None):
        if tasks_dir:
            self.tasks_dir = Path(tasks_dir)
        else:
            self.tasks_dir = BASE_DIR / "tasks"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self.tasks_file = self.tasks_dir / "tasks.json"
        self._load_tasks()
    
    def _load_tasks(self):
        if self.tasks_file.exists():
            with open(self.tasks_file, 'r', encoding='utf-8') as f:
                self.tasks = json.load(f)
        else:
            self.tasks = []
    
    def _save_tasks(self):
        with open(self.tasks_file, 'w', encoding='utf-8') as f:
            json.dump(self.tasks, f, ensure_ascii=False, indent=2)
    
    def create_task(self, title: str, description: str = "", priority: str = "medium") -> Dict:
        """태스크 생성"""
        try:
            task = {
                "id": len(self.tasks) + 1,
                "title": title,
                "description": description,
                "priority": priority,
                "status": "todo",
                "created_at": datetime.now().isoformat()
            }
            self.tasks.append(task)
            self._save_tasks()
            return {"success": True, "message": f"태스크 생성 완료: {title}", "task_id": task["id"]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def list_tasks(self, status: str = None) -> List[Dict]:
        """태스크 목록"""
        if status:
            return [t for t in self.tasks if t["status"] == status]
        return self.tasks
    
    def complete_task(self, task_id: int) -> Dict:
        """태스크 완료"""
        for task in self.tasks:
            if task["id"] == task_id:
                task["status"] = "done"
                self._save_tasks()
                return {"success": True, "message": f"태스크 완료 (ID: {task_id})"}
        return {"success": False, "error": f"태스크를 찾을 수 없습니다 (ID: {task_id})"}


# ==================== 서버 스킬 ====================
class ServerSkill:
    """서버 관리 스킬 (로컬 서버 모니터링 및 관리)"""
    
    def get_server_status(self) -> Dict:
        """서버 상태 조회"""
        try:
            return {
                "hostname": socket.gethostname(),
                "ip_address": socket.gethostbyname(socket.gethostname()),
                "cpu_percent": psutil.cpu_percent(interval=1),
                "memory_percent": psutil.virtual_memory().percent,
                "disk_percent": psutil.disk_usage(str(BASE_DIR)).percent
            }
        except Exception as e:
            return {"error": str(e)}
    
    def check_port(self, port: int) -> Dict:
        """포트 상태 확인"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex(('localhost', port))
            sock.close()
            return {"port": port, "status": "open" if result == 0 else "closed"}
        except Exception as e:
            return {"error": str(e)}


# ==================== 검색 스킬 ====================
class SearchSkill:
    """Naver 기반 웹 검색 스킬 (API 키 불필요, 크롤링 방식)"""
    
    def __init__(self):
        self.base_url = "https://search.naver.com/search.naver"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        }

    def search(self, query: str, limit: int = 5) -> Dict:
        """웹 검색 수행 (Naver)"""
        try:
            logger.info(f"Performing no-key web search (Naver) for: {query}")
            response = requests.get(
                self.base_url,
                params={"query": query},
                headers=self.headers,
                timeout=15,
                verify=True
            )
            
            if response.status_code != 200:
                return {"error": f"Search failed with status code {response.status_code}"}
                
            html = response.text
            results = []
            
            # Naver Search result patterns (Broad fallback)
            matches = re.findall(r'<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL)
            
            seen_links = set()
            for link, title_html in matches:
                # HTML entity cleaning & Tag removal
                title = re.sub(r'<[^>]+>', '', title_html)
                title = title.replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').strip()
                
                # Filter out internal Naver links and short titles
                if any(x in link for x in ['naver.com', 'pstatic.net', 'adcr.naver.com']):
                    continue
                
                if len(title) > 8 and link not in seen_links:
                    results.append({
                        "title": title,
                        "link": link,
                        "description": ""
                    })
                    seen_links.add(link)
                
                if len(results) >= limit:
                    break

            return {
                "web": {
                    "results": results
                },
                "query": query
            }
            
        except Exception as e:
            logger.error(f"Search skill error: {e}")
            return {"error": str(e)}

    def get_search_context(self, search_results: Dict) -> str:
        """검색 결과를 자연어로 포맷팅"""
        if "error" in search_results:
            return f"⚠️ {search_results['error']}"
            
        query = search_results.get("query", "알 수 없음")
        results = search_results.get("web", {}).get("results", [])
        
        if not results:
            return f"🔍 '{query}'에 대한 검색 결과를 찾을 수 없습니다."
            
        formatted = f"🔍 **'{query}' 검색 결과**\n\n"
        for i, res in enumerate(results[:5], 1):
            title = res.get("title", "제목 없음")
            link = res.get("link", "")
            snippet = res.get("description", "")[:100]
            
            formatted += f"{i}. **{title}**\n"
            if snippet:
                formatted += f"   {snippet}...\n"
            if link:
                formatted += f"   🔗 {link}\n"
            formatted += "\n"
            
        return formatted.strip()


# ==================== 가상화폐 스킬 ====================
class CryptoSkill:
    """Upbit 기반 가상화폐 시세 조회 스킬 (pyupbit 사용)"""
    
    def __init__(self):
        self.tickers = {
            "비트코인": "KRW-BTC",
            "이더리움": "KRW-ETH",
            "리플": "KRW-XRP",
            "솔라나": "KRW-SOL",
            "도지코인": "KRW-DOGE",
            "BTC": "KRW-BTC",
            "ETH": "KRW-ETH",
            "XRP": "KRW-XRP",
            "SOL": "KRW-SOL",
            "DOGE": "KRW-DOGE"
        }

    def get_crypto_price(self, ticker: str = "BTC") -> Dict:
        """가상화폐 현재가 조회 (Upbit)"""
        try:
            # 티커 매핑 확인
            search_ticker = self.tickers.get(ticker, ticker)
            
            # KRW- 접두사 없으면 추가 (기본적으로 원화 마켓 가정)
            if not search_ticker.startswith("KRW-") and not search_ticker.startswith("BTC-") and not search_ticker.startswith("USDT-"):
                search_ticker = f"KRW-{search_ticker}"
                
            import pyupbit
            price = pyupbit.get_current_price(search_ticker)
            
            if not price:
                 return {"error": f"가상화폐 '{ticker}' 정보를 찾을 수 없습니다."}
                 
            # 24시간 변동률 등 상세 정보 조회 (get_ohlcv 대신 get_quotes 사용 가능하지만 pyupbit은 간단하게)
            # pyupbit.get_ohlcv(search_ticker, count=1)로 시가/종가 확인 가능
            import pyupbit
            df = pyupbit.get_ohlcv(search_ticker, count=1)
            change_rate = 0
            if df is not None and not df.empty:
                open_price = df['open'].iloc[0]
                close_price = df['close'].iloc[0]
                change_rate = ((close_price - open_price) / open_price) * 100
            
            return {
                "ticker": search_ticker,
                "price": price,
                "change_rate": round(change_rate, 2),
                "currency": "KRW"
            }
            
        except Exception as e:
            logger.error(f"Crypto API error: {e}")
            return {"error": str(e)}

    def get_crypto_context(self, crypto_data: Dict) -> str:
        """가상화폐 데이터를 자연어로 포맷팅"""
        if "error" in crypto_data:
            return f"⚠️ {crypto_data['error']}"
            
        ticker = crypto_data.get("ticker", "알 수 없음")
        price = crypto_data.get("price", 0)
        change_rate = crypto_data.get("change_rate", 0)
        
        emoji = "📈" if change_rate > 0 else "📉" if change_rate < 0 else "➡️"
        sign = "+" if change_rate > 0 else ""
        
        return f"""🪙 **{ticker} 시세 정보**
    
• 현재가: {price:,.0f}원
• 전일 대비: {sign}{change_rate}% {emoji}
""".strip()


    def get_search_context(self, search_data: Dict) -> str:
        """검색 결과 포맷팅"""
        if "error" in search_data:
            return f"⚠️ 검색 중 오류 발생: {search_data['error']}"
            
        results = search_data.get("web", {}).get("results", [])
        if not results:
            return "🔍 검색 결과를 찾을 수 없습니다."
            
        formatted = f"🔍 **'{search_data.get('query')}' 검색 결과:**\n\n"
        for i, res in enumerate(results[:5], 1):
            formatted += f"{i}. **{res['title']}**\n"
            if res.get('description'):
                formatted += f"   {res['description']}\n"
            formatted += f"   🔗 {res['link']}\n\n"
            
        from datetime import datetime
        formatted += f"\n📅 조회 일시: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        return formatted


# ==================== 주식 추천 스킬 ====================
class StockRecommendationSkill:
    """나스닥, 코스피, 코스닥 지수 및 뉴스를 분석하여 종목을 추천하는 스킬"""
    
    def __init__(self, stock_skill: StockSkill, news_skill: NewsSkill, search_skill: SearchSkill):
        self.stock_skill = stock_skill
        self.news_skill = news_skill
        self.search_skill = search_skill
        self.indices = {
            "나스닥": "^IXIC",
            "코스피": "^KS11",
            "코스닥": "^KQ11"
        }

    def get_market_indices(self) -> Dict:
        """주요 시장 지수 현황 조회"""
        results = {}
        try:
            import yfinance as yf
            for name, symbol in self.indices.items():
                ticker = yf.Ticker(symbol)
                hist = ticker.history(period="2d")
                if not hist.empty:
                    current = hist['Close'].iloc[-1]
                    prev = hist['Close'].iloc[-2] if len(hist) > 1 else current
                    change = current - prev
                    pct = (change / prev * 100) if prev else 0
                    results[name] = {
                        "price": round(current, 2),
                        "change": round(change, 2),
                        "percent": round(pct, 2)
                    }
            return results
        except Exception as e:
            logger.error(f"Error fetching indices: {e}")
            return {"error": str(e)}

    def get_market_news(self, limit: int = 5) -> List[Dict]:
        """경제/정치 뉴스 조회"""
        news = []
        try:
            # 경제 뉴스 검색
            econ_news = self.news_skill.search_news("경제", limit=3)
            if isinstance(econ_news, list):
                news.extend(econ_news)
            
            # 정치 뉴스 검색
            pol_news = self.news_skill.search_news("정치", limit=2)
            if isinstance(pol_news, list):
                news.extend(pol_news)
                
            return news
        except Exception as e:
            logger.error(f"Error fetching market news: {e}")
            return []

    def get_recommendation_context(self) -> Dict:
        """추천을 위한 종합 컨텍스트 생성"""
        indices = self.get_market_indices()
        news = self.get_market_news()
        
        return {
            "indices": indices,
            "news": news,
            "date": datetime.now().strftime("%Y-%m-%d %H:%M")
        }


# ==================== Gmail 스킬 ====================
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


# ===== DYNAMIC SKILLS START =====
# 이 마커 아래에 동적으로 생성된 스킬이 추가됩니다.
# 이 마커를 삭제하지 마세요!
# ===== DYNAMIC SKILLS END =====


from config import SKILLS_CONFIG, BASE_DIR

try:
    from project_skill import ProjectSkill
except ImportError as _e:
    ProjectSkill = None
    logger.warning(f"ProjectSkill unavailable (pymysql not installed?): {_e}")


# ==================== 통합 스킬 매니저 ====================
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
        self.project = (ProjectSkill() if ProjectSkill else None) if SKILLS_CONFIG.get("project") else None
        # 파일 스킬 — 항상 활성화 (memory/, data/ 접근에 필수)
        from skills.files import FileSkill as _FileSkill
        self.files = _FileSkill(base_dir=BASE_DIR) if SKILLS_CONFIG.get("file", True) else None

        # Gmail 스킬 초기화
        if SKILLS_CONFIG.get("gmail"):
            try:
                from gmail_client import GmailClient
                self.gmail = GmailSkill(gmail_client=GmailClient())
                logger.info("GmailSkill initialized.")
            except Exception as e:
                logger.warning(f"GmailSkill disabled (auth required): {e}")
                self.gmail = GmailSkill()  # lazy-init 모드로 유지
        else:
            self.gmail = None
        
        # 주식 추천 스킬 초기화
        if SKILLS_CONFIG.get("stock_recommendation") and self.stock and self.news:
            self.stock_recommendation = StockRecommendationSkill(self.stock, self.news, self.search)
        else:
            self.stock_recommendation = None
        
        enabled_list = [k for k, v in SKILLS_CONFIG.items() if v]
        logger.info(f"SkillsManager initialized with enabled skills: {enabled_list}")
    
    def get_skill(self, skill_name: str):
        """스킬 가져오기"""
        return getattr(self, skill_name, None)
