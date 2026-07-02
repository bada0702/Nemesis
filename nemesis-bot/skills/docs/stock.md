# stock — 주식·시장 조회

## 설명
yfinance 및 KIS API를 통해 주식 시세, 시장 개요, 실거래를 지원합니다.

## 도구 목록
- `get_stock_price(symbol)` — 개별 종목 현재가 (yfinance)
- `get_market_overview()` — 코스피/나스닥/환율 한눈에
- `get_exchange_rate(from_currency, to_currency)` — 환율
- `get_stock_recommendations()` — 추천 종목
- `kis_get_balance()` — KIS 잔고 조회
- `kis_buy_stock(symbol, quantity)` — KIS 매수
- `kis_sell_stock(symbol, quantity)` — KIS 매도

## 심볼 규칙
- 국내: `005930.KS` (삼성전자), `000660.KS` (SK하이닉스), `^KS11` (코스피)
- 해외: `PLTR`, `TSLA`, `NVDA` (티커 그대로)

## 제약사항
- 실거래(KIS)는 KIS_APP_KEY 등 환경변수 필요
- 숫자 데이터는 반드시 도구 결과값 그대로 인용, 추측 금지

## 실패 경험 기록
| 날짜 | 오류 | 원인 | 해결책 |
|------|------|------|--------|
