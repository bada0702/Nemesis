
import logging
from typing import Dict

try:
    import pyupbit
except ImportError:
    pyupbit = None

logger = logging.getLogger(__name__)

class CryptoSkill:
    """암호화폐 시세 조회 (Upbit 기반)"""
    
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
            if not pyupbit:
                return {"error": "pyupbit module not installed"}
                
            # 티커 매핑 확인
            search_ticker = self.tickers.get(ticker, ticker)
            
            # KRW- 접두사 없으면 추가 (기본적으로 원화 마켓 가정)
            if not search_ticker.startswith("KRW-") and not search_ticker.startswith("BTC-") and not search_ticker.startswith("USDT-"):
                search_ticker = f"KRW-{search_ticker}"
                
            price = pyupbit.get_current_price(search_ticker)
            
            if not price:
                 return {"error": f"가상화폐 '{ticker}' 정보를 찾을 수 없습니다."}
                 
            # 24시간 변동률 등 상세 정보 조회
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

    def get_tool_definition(self) -> dict:
        return {
            "name": "get_crypto_price",
            "description": "가상화폐(비트코인 등)의 현재 시세 정보를 조회합니다. (업비트 기준)",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {
                        "type": "string",
                        "description": "가상화폐 이름 또는 티커 (예: 비트코인, 이더리움, BTC, ETH, XRP)"
                    }
                },
                "required": ["ticker"]
            }
        }

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "get_crypto_price":
            return self.get_crypto_price(args.get("ticker", "BTC"))
        return {"error": "Unknown tool"}
