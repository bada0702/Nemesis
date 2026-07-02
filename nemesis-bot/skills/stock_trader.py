import os
import requests
import datetime
import json
from pathlib import Path

TOKEN_CACHE_FILE = Path(__file__).parent.parent / "data" / "kis_token.json"

class StockTraderSkill:
    def __init__(self):
        self.app_key = os.getenv("KIS_APP_KEY", "")
        self.app_secret = os.getenv("KIS_APP_SECRET", "")
        self.cano = os.getenv("KIS_CANO", "")
        self.acnt_prtnl = os.getenv("KIS_ACNT_PRTNL", "01")
        self.access_token = None
        self.token_expiry = None
        self.base_url = "https://openapi.koreainvestment.com:9443"
        self._load_cached_token()

    def _load_cached_token(self):
        try:
            if TOKEN_CACHE_FILE.exists():
                cache = json.loads(TOKEN_CACHE_FILE.read_text())
                expiry = datetime.datetime.fromisoformat(cache["expiry"])
                if datetime.datetime.now() < expiry:
                    self.access_token = cache["token"]
                    self.token_expiry = expiry
        except Exception:
            pass

    def _save_token_cache(self):
        try:
            TOKEN_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            TOKEN_CACHE_FILE.write_text(json.dumps({
                "token": self.access_token,
                "expiry": self.token_expiry.isoformat(),
            }))
        except Exception:
            pass

    def _get_access_token(self):
        url = f"{self.base_url}/oauth2/tokenP"
        payload = {
            "grant_type": "client_credentials",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
        }
        resp = requests.post(url, json=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if "access_token" not in data:
            raise Exception(f"토큰 발급 실패: {data}")
        self.access_token = data["access_token"]
        self.token_expiry = datetime.datetime.now() + datetime.timedelta(hours=23)
        self._save_token_cache()
        return self.access_token

    def _ensure_token(self):
        if not self.access_token or (self.token_expiry and datetime.datetime.now() >= self.token_expiry):
            return self._get_access_token()
        return self.access_token

    def _headers(self, tr_id):
        return {
            "Authorization": f"Bearer {self._ensure_token()}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": tr_id,
            "Content-Type": "application/json; charset=utf-8",
        }

    def _get_realtime_price(self, symbol):
        url = f"{self.base_url}/uapi/domestic-stock/v1/quotations/inquire-price"
        params = {"FID_COND_MRKT_C_SCODE": symbol}
        try:
            resp = requests.get(url, headers=self._headers("C00001"), params=params, timeout=5)
            resp.raise_for_status()
            data = resp.json()
            if data.get("rt_cd") == "0":
                return self._safe_int(data.get("output", {}).get("stck_prpr", 0))
        except Exception:
            pass
        return None

    def execute_tool(self, tool_name, args):
        if tool_name == "get_balance":
            return self.get_balance(args)
        elif tool_name == "buy_stock":
            return self.buy_stock(args)
        elif tool_name == "sell_stock":
            return self.sell_stock(args)
        else:
            return f"알 수 없는 도구: {tool_name}"

    def _safe_int(self, val, default=0):
        try:
            if val is None or str(val).strip() == "":
                return default
            return int(float(val))
        except (ValueError, TypeError):
            return default

    def get_balance(self, args):
        if not self.app_key or self.app_key == "YOUR_APP_KEY":
            return "KIS API 키가 설정되지 않았습니다. .env에서 KIS_APP_KEY를 확인하세요."
        
        url = f"{self.base_url}/uapi/domestic-stock/v1/trading/inquire-balance"
        params = {
            "CANO": self.cano,
            "ACNT_PRDT_CD": self.acnt_prtnl,
            "AFHR_FLPR_YN": "N",
            "OFL_YN": "",
            "INQR_DVSN": "02",
            "UNPR_DVSN": "01",
            "FUND_STTL_ICLD_YN": "N",
            "FNCG_AMT_AUTO_RDPT_YN": "N",
            "PRCS_DVSN": "01",
            "CTX_AREA_FK100": "",
            "CTX_AREA_NK100": "",
        }
        resp = requests.get(url, headers=self._headers("TTTC8434R"), params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        rt_cd = data.get("rt_cd", "")
        if rt_cd != "0":
            return f"잔고 조회 실패: {data.get('msg1', data)}"

        output2 = data.get("output2", [{}])
        summary = output2[0] if output2 else {}
        deposit = self._safe_int(summary.get("dnca_tot_amt", 0))
        
        total_pchs_amt = self._safe_int(summary.get("pchs_amt_smtl_amt", 0))
        total_evlu_amt = self._safe_int(summary.get("evlu_amt_smtl_amt", 0))
        total_asset = self._safe_int(summary.get("tot_evlu_amt", 0))
        
        profit = self._safe_int(summary.get("evlu_pfls_smtl_amt", 0))
        profit_rt = summary.get("evlu_pfls_rt", "0.00")

        holdings = []
        for item in data.get("output1", []):
            name = item.get("prdt_name", "")
            symbol = item.get("stck_shrn_code", "")
            qty = self._safe_int(item.get("hldg_qty", 0))
            pchs_avg = self._safe_int(item.get("pchs_avg_pric", 0))
            
            curr_price = self._get_realtime_price(symbol)
            if curr_price is None:
                curr_price = self._safe_int(item.get("prpr", 0))

            evlu_amt = curr_price * qty
            pchs_amt = pchs_avg * qty
            pfls = evlu_amt - pchs_amt
            pfls_rt = (pfls / pchs_amt * 100) if pchs_amt != 0 else 0
            
            holdings.append(
                f"  • {name}({symbol}): {qty}주 | "
                f"매입가 {pchs_amt:,}원 (평균 {pchs_avg:,}원) | "
                f"현재가 {curr_price:,}원 (평가 {evlu_amt:,}원) | "
                f"손익 {pfls:,}원 ({pfls_rt:.2f}%)"
            )

        result = (
            f"[계좌 총괄 현황]\n"
            f"예수금: {deposit:,}원\n"
            f"주식 매입 총액: {total_pchs_amt:,}원\n"
            f"주식 평가 총액: {total_evlu_amt:,}원\n"
            f"총 자산(평가금액): {total_asset:,}원\n"
            f"전체 평가손익: {profit:,}원 ({profit_rt}%)\n"
        )
        if holdings:
            result += "\n[보유 종목 상세]\n" + "\n".join(holdings)
        else:
            result += "\n보유 종목 없음"
        return result

    def buy_stock(self, args):
        symbol = args.get("symbol", "")
        quantity = args.get("quantity", 0)
        price = args.get("price", "0")
        is_market = str(price) in ("0", "시장가", "")
        url = f"{self.base_url}/uapi/domestic-stock/v1/trading/order-cash"
        payload = {
            "CANO": self.cano,
            "ACNT_PRDT_CD": self.acnt_prtnl,
            "PDNO": symbol,
            "ORD_DVSN": "01" if is_market else "00",
            "ORD_QTY": str(quantity),
            "ORD_UNPR": "0" if is_market else str(price),
        }
        resp = requests.post(url, headers=self._headers("TTTC0802U"), json=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("rt_cd") != "0":
            return f"매수 실패: {data.get('msg1', data)}"
        odno = data.get("output", {}).get("ODNO", "")
        return f"[매수 주문 완료] {symbol} {quantity}주 | 주문번호: {odno}"

    def sell_stock(self, args):
        symbol = args.get("symbol", "")
        quantity = args.get("quantity", 0)
        url = f"{self.base_url}/uapi/domestic-stock/v1/trading/order-cash"
        payload = {
            "CANO": self.cano,
            "ACNT_PRDT_CD": self.acnt_prtnl,
            "PDNO": symbol,
            "ORD_DVSN": "01",
            "ORD_QTY": str(quantity),
            "ORD_UNPR": "0",
        }
        resp = requests.post(url, headers=self._headers("TTTC0801U"), json=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("rt_cd") != "0":
            return f"매도 실패: {data.get('msg1', data)}"
        odno = data.get("output", {}).get("ODNO", "")
        return f"[매도 주문 완료] {symbol} {quantity}주 | 주문번호: {odno}"

    def get_tool_definitions(self):
        return [
            {
                "name": "get_balance",
                "description": "한국투자증권 계좌의 잔고와 보유 주식 목록을 실시간으로 조회합니다.",
                "parameters": {"type": "OBJECT", "properties": {}}
            },
            {
                "name": "buy_stock",
                "description": "주식을 매수합니다.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "symbol": {"type": "STRING", "description": "종목코드 (예: 005930)"},
                        "quantity": {"type": "INTEGER", "description": "매수 수량"},
                        "price": {"type": "STRING", "description": "매수 가격 (0 또는 생략 시 시장가)"}
                    },
                    "required": ["symbol", "quantity"]
                }
            },
            {
                "name": "sell_stock",
                "description": "주식을 시장가로 매도합니다.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "symbol": {"type": "STRING", "description": "종목코드 (예: 005930)"},
                        "quantity": {"type": "INTEGER", "description": "매도 수량"}
                    },
                    "required": ["symbol", "quantity"]
                }
            }
        ]
