
import logging
from typing import Dict, List, Optional
from datetime import datetime
try:
    import yfinance as yf
except ImportError:
    yf = None

logger = logging.getLogger(__name__)

class StockSkill:
    """Yahoo Finance 기반 주식 스킬 (완전 무료, API 키 불필요!)"""
    
    def __init__(self):
        self.kr_stocks = {
            "삼성전자": "005930.KS", "SK하이닉스": "000660.KS", "NAVER": "035420.KS",
            "카카오": "035720.KS", "현대차": "005380.KS", "LG화학": "051910.KS",
            "삼성바이오로직스": "207940.KS", "기아": "000270.KS", "포스코홀딩스": "005490.KS",
            "한국항공우주": "047810.KS", "한화에어로스페이스": "012450.KS"
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
            
            if not yf:
                return {"error": "yfinance module not installed"}

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

    def search_symbol(self, query: str) -> Dict:
        """종목 검색 (Alpha Vantage 호환 / 내부 딕셔너리 기반)"""
        best_matches = []
        
        # 1. 내부 딕셔너리 검색
        for name, code in self.kr_stocks.items():
            if query.replace(" ", "").lower() in name.replace(" ", "").lower():
                best_matches.append({"1. symbol": code, "2. name": name, "3. type": "Equity", "4. region": "South Korea"})
        
        for name, code in self.us_stocks.items():
            if query.replace(" ", "").lower() in name.replace(" ", "").lower():
                best_matches.append({"1. symbol": code, "2. name": name, "3. type": "Equity", "4. region": "United States"})
                
        # 2. 검색 결과가 없으면 입력값을 그대로 심볼로 간주 (단, 알파벳/숫자만 있을 때)
        if not best_matches and query.isalnum():
             best_matches.append({"1. symbol": query.upper(), "2. name": query, "3. type": "Unknown", "4. region": "Unknown"})

        return {"bestMatches": best_matches}
    
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
        try:
            change_float = float(change)
        except:
            change_float = 0
            
        emoji = "📈" if change_float > 0 else "📉" if change_float < 0 else "➡️"
        
        return f"""📊 **{symbol} 주가 정보**

• 현재가: {price}
• 변동: {change} ({change_percent}) {emoji}
""".strip()

    def get_tool_definition(self) -> dict:
        return {
            "name": "get_stock_price",
            "description": (
                "주식/코스피/코스닥 현재가를 실시간으로 조회합니다. "
                "한국 주식명(삼성전자, SK하이닉스, NAVER, 카카오, 현대차 등)이나 "
                "미국 주식명(애플, 테슬라, 엔비디아 등) 또는 "
                "심볼(005930.KS, AAPL, TSLA, ^KS11, ^KQ11 등)을 넣으면 됩니다. "
                "사용자가 주가를 물어보면 반드시 이 도구를 호출하세요. "
                "추측하거나 웹 검색으로 대체하지 마세요."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": (
                            "주식 심볼 또는 한국어 종목명. "
                            "예: '삼성전자', 'SK하이닉스', 'NAVER', '카카오', '현대차', "
                            "'애플', '테슬라', '엔비디아', "
                            "'005930.KS', 'AAPL', 'TSLA', '^KS11'(코스피), '^KQ11'(코스닥)"
                        )
                    }
                },
                "required": ["symbol"]
            }
        }

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "get_stock_price":
            return self.get_stock_price(args.get("symbol", ""))
        return {"error": "Unknown tool"}

class StockRecommendationSkill:
    """나스닥, 코스피, 코스닥 지수 및 뉴스를 분석하여 종목을 추천하는 스킬"""
    
    def __init__(self, stock_skill: StockSkill, news_skill, search_skill):
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
            if not yf:
                return {"error": "yfinance module not installed"}
                
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

    def get_tool_definition(self) -> dict:
        return {
            "name": "get_stock_recommendations",
            "description": "시장 지수(나스닥, 코스피, 코스닥)와 경제/정치 뉴스를 분석하여 오늘 단기 모멘텀이 기대되는 종목 3개를 추천받기 위한 정보를 수집합니다.",
            "parameters": {"type": "object", "properties": {}}
        }

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "get_stock_recommendations":
            return self.get_recommendation_context()
        return {"error": "Unknown tool"}
