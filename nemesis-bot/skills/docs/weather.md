# weather — 날씨 조회

## 설명
OpenWeatherMap API를 이용해 현재 날씨 및 예보를 조회합니다.

## 도구 목록
- `get_weather(location)` — 현재 날씨 (기온, 습도, 날씨 상태)
- `get_weather_forecast(location, days)` — N일 예보 (기본 3일)

## 사용 예시
- `get_weather(location="서울")` — 서울 현재 날씨
- `get_weather_forecast(location="부산", days=5)` — 부산 5일 예보

## 제약사항
- location은 한국어 도시명 또는 영문 도시명 모두 가능
- API 키 없으면 동작 안 함 (OPENWEATHER_API_KEY 환경변수)

## 실패 경험 기록
| 날짜 | 오류 | 원인 | 해결책 |
|------|------|------|--------|
