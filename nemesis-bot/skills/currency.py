
import logging
import requests
from typing import Dict

logger = logging.getLogger(__name__)

# 한글/영문 통화명 → ISO 코드
CURRENCY_MAP = {
    "달러": "USD", "미달러": "USD", "미국달러": "USD", "usd": "USD",
    "엔": "JPY", "일본엔": "JPY", "엔화": "JPY", "jpy": "JPY",
    "유로": "EUR", "eur": "EUR",
    "위안": "CNY", "중국위안": "CNY", "인민폐": "CNY", "cny": "CNY",
    "파운드": "GBP", "영국파운드": "GBP", "gbp": "GBP",
    "홍콩달러": "HKD", "hkd": "HKD",
    "호주달러": "AUD", "aud": "AUD",
    "캐나다달러": "CAD", "cad": "CAD",
    "스위스프랑": "CHF", "chf": "CHF",
}


class CurrencySkill:
    """환율 조회 스킬 — open.er-api.com 무료 API (API 키 불필요)"""

    def __init__(self, search_skill=None):
        self.search_skill = search_skill

    # ------------------------------------------------------------------ #
    #  내부 헬퍼                                                           #
    # ------------------------------------------------------------------ #
    @staticmethod
    def _to_iso(currency_input: str) -> str:
        """한글/영문 통화명 → ISO 코드. 이미 ISO면 그대로 반환."""
        key = currency_input.strip().lower()
        return CURRENCY_MAP.get(key, currency_input.upper())

    # ------------------------------------------------------------------ #
    #  핵심 조회 메서드                                                     #
    # ------------------------------------------------------------------ #
    def get_exchange_rate(self, currency: str = "USD") -> Dict:
        """
        환율 조회. currency 는 ISO 코드('USD') 또는 한글('달러') 모두 허용.
        반환: {"currency": "USD", "rate_to_krw": 1350.12, "date": "..."}
        """
        iso = self._to_iso(currency)

        try:
            # open.er-api.com: /v6/latest/{BASE} → BASE 기준 각 통화 환율
            url = f"https://open.er-api.com/v6/latest/{iso}"
            resp = requests.get(url, timeout=8)
            resp.raise_for_status()
            data = resp.json()

            if data.get("result") == "success":
                krw_rate = data["rates"].get("KRW")
                if krw_rate:
                    return {
                        "currency": iso,
                        "rate_to_krw": round(krw_rate, 4),
                        "date": data.get("time_last_update_utc", ""),
                        "next_update": data.get("time_next_update_utc", ""),
                    }
            logger.warning(f"open.er-api returned unexpected data: {data}")
        except requests.exceptions.Timeout:
            logger.error("Currency API timeout")
        except Exception as e:
            logger.error(f"Currency API error: {e}")

        # Fallback: 검색 스킬
        if self.search_skill:
            try:
                results = self.search_skill.search(f"{iso} KRW 환율 오늘")
                return {"currency": iso, "search_fallback": True, "results": results}
            except Exception as e:
                logger.error(f"Currency search fallback error: {e}")

        return {"error": f"{iso} 환율 정보를 가져올 수 없습니다."}

    def get_multiple_rates(self) -> Dict:
        """주요 통화 환율 한꺼번에 조회 (KRW 기준)."""
        try:
            url = "https://open.er-api.com/v6/latest/KRW"
            resp = requests.get(url, timeout=8)
            resp.raise_for_status()
            data = resp.json()

            if data.get("result") == "success":
                rates = data["rates"]
                major = {
                    "USD": round(1 / rates["USD"], 4) if rates.get("USD") else None,
                    "JPY": round(1 / rates["JPY"], 4) if rates.get("JPY") else None,
                    "EUR": round(1 / rates["EUR"], 4) if rates.get("EUR") else None,
                    "CNY": round(1 / rates["CNY"], 4) if rates.get("CNY") else None,
                    "GBP": round(1 / rates["GBP"], 4) if rates.get("GBP") else None,
                }
                return {
                    "base": "KRW",
                    "rates": major,
                    "date": data.get("time_last_update_utc", ""),
                }
        except Exception as e:
            logger.error(f"Multiple rates error: {e}")
        return {"error": "환율 정보를 가져올 수 없습니다."}

    # ------------------------------------------------------------------ #
    #  포맷팅 (두 이름 모두 지원)                                           #
    # ------------------------------------------------------------------ #
    def get_exchange_rate_context(self, data: Dict) -> str:
        """환율 데이터를 사람이 읽기 좋은 문자열로 변환."""
        if data.get("error"):
            return f"⚠️ {data['error']}"

        if data.get("search_fallback"):
            return f"💱 {data.get('currency', '')} 환율 검색 결과를 참고하세요."

        iso = data.get("currency", "USD")
        rate = data.get("rate_to_krw", 0)
        date = data.get("date", "")

        currency_names = {v: k for k, v in CURRENCY_MAP.items()
                         if k not in ("usd", "jpy", "eur", "cny", "gbp", "hkd", "aud", "cad", "chf")}
        name = currency_names.get(iso, iso)

        lines = [f"💱 **{name}({iso}) 환율 정보**", f"• 1 {iso} = **{rate:,.2f} 원**"]
        if date:
            lines.append(f"• 기준: {date}")
        return "\n".join(lines)

    # 구 이름 호환
    def get_currency_context(self, data: Dict) -> str:
        return self.get_exchange_rate_context(data)

    # ------------------------------------------------------------------ #
    #  Tool definitions                                                    #
    # ------------------------------------------------------------------ #
    def get_tool_definitions(self) -> list:
        return [
            {
                "name": "get_exchange_rate",
                "description": "특정 통화의 현재 환율(원화 기준)을 조회합니다. 달러, 엔, 유로, 위안, 파운드 등 지원.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "currency": {
                            "type": "string",
                            "description": "조회할 통화. 한글('달러', '엔', '유로') 또는 ISO 코드('USD', 'JPY', 'EUR') 모두 가능."
                        }
                    },
                    "required": ["currency"]
                }
            },
            {
                "name": "get_multiple_exchange_rates",
                "description": "달러·엔·유로·위안·파운드 주요 환율을 한 번에 조회합니다.",
                "parameters": {"type": "object", "properties": {}}
            }
        ]

    # 구 단수 이름 호환 (ToolManager가 get_tool_definition 으로 호출할 경우 대비)
    def get_tool_definition(self) -> dict:
        return self.get_tool_definitions()[0]

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "get_exchange_rate":
            raw = args.get("currency", "USD")
            return self.get_exchange_rate(raw)          # _to_iso 내부에서 변환
        if tool_name == "get_multiple_exchange_rates":
            return self.get_multiple_rates()
        return {"error": "Unknown tool"}
