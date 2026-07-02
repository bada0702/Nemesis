
import logging
import requests
from typing import Dict, Optional

logger = logging.getLogger(__name__)

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
        # Simplify location if it's a detailed address
        major_cities = [
            "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
            "수원", "창원", "성남", "고양", "용인", "제주", "춘천", "강릉",
            "청주", "천안", "전주", "포항", "경주"
        ]
        for city in major_cities:
            if city in location:
                location = city
                break

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

    def get_tool_definition(self) -> dict:
        return {
            "name": "get_weather",
            "description": "특정 지역의 현재 날씨 정보를 조회합니다. 기온, 습도, 풍속 등 상세한 기상 정보를 제공합니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "날씨를 조회할 지역명 (예: '서울', '창원', 'New York')"
                    }
                },
                "required": ["location"]
            }
        }

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "get_weather":
            location = args.get("location", "서울")
            return self.get_weather(location)
        return {"error": "Unknown tool"}
