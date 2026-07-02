"""
Ollama Tool Wrapper - 키워드 기반 자동 도구 호출
Ollama는 function calling을 지원하지 않으므로 키워드를 감지하여 수동으로 도구를 호출합니다.
"""
import re
from typing import Optional, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


def _format_multiple_rates(data: dict) -> str:
    """주요 환율 딕셔너리를 사람이 읽기 좋은 문자열로 변환."""
    if data.get("error"):
        return f"⚠️ {data['error']}"
    rates = data.get("rates", {})
    name_map = {"USD": "달러", "JPY": "엔화", "EUR": "유로", "CNY": "위안", "GBP": "파운드"}
    lines = ["💱 **주요 환율 (원화 기준)**"]
    for iso, krw in rates.items():
        if krw:
            lines.append(f"• 1 {name_map.get(iso, iso)} ({iso}) = {krw:,.2f} 원")
    if data.get("date"):
        lines.append(f"• 기준: {data['date']}")
    return "\n".join(lines)


class OllamaToolWrapper:
    """Ollama를 위한 도구 호출 래퍼"""
    
    def __init__(self, search_skill, mcp_server, weather_client=None, cron_scheduler=None, stock_client=None, news_client=None, calendar_client=None, currency_client=None, crypto_client=None, system_skill=None, stock_recommendation_skill=None, reminder_manager=None, gmail_skill=None, project_skill=None):
        self.search_skill = search_skill
        self.mcp_server = mcp_server
        self.weather_client = weather_client
        self.cron_scheduler = cron_scheduler
        self.stock_client = stock_client
        self.news_client = news_client
        self.calendar_client = calendar_client
        self.currency_client = currency_client
        self.crypto_client = crypto_client
        self.system_skill = system_skill
        self.stock_recommendation_skill = stock_recommendation_skill
        self.reminder_manager = reminder_manager
        self.gmail_skill = gmail_skill
        self.project_skill = project_skill
    
    @staticmethod
    def _skill_enabled(config_key: str) -> bool:
        """SKILLS_CONFIG 를 런타임에 재확인하여 스킬 활성화 여부 반환."""
        try:
            from config import SKILLS_CONFIG
            return bool(SKILLS_CONFIG.get(config_key, True))
        except Exception:
            return True  # 읽기 실패 시 허용

    def detect_and_execute_tools(self, user_message: str, user_id: Optional[int] = None, chat_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        사용자 메시지에서 키워드를 감지하고 해당 도구를 실행.
        SKILLS_CONFIG 에서 비활성화된 스킬은 키워드 감지 단계에서도 차단합니다.

        Args:
            user_message: 사용자 메시지
            user_id: 사용자 ID (일정/알림 등록 시 필요)
            chat_id: 채팅방 ID

        Returns:
            도구 실행 결과 또는 None
        """
        message_lower = user_message.lower()
        
        # 0. 기억/저장/메모 의도 우선 확인
        # 사용자가 "기억해", "저장해"라고 할 때는 본문의 키워드(날씨, 뉴스 등)로 인해 도구가 실행되는 것을 방지해야 함
        save_keywords = ['기억해', '저장해', '메모해', '기록해', '기억 저장', '기억해줘', '저장해줘']
        if any(keyword in message_lower for keyword in save_keywords):
            return None

        # 0.2. 중복 호출 방지 (이미 주입된 정보가 있으면 건너뜀)
        if '[실시간 정보 감지:' in user_message:
            return None
            logger.info("Detected memory/save intent - suppressing other auto-tools to avoid distraction")
            # LLM이 직접 memory patch를 생성하도록 유도하기 위해 검색 도구 등을 실행하지 않음
            # 단, NoteSkill을 명시적으로 사용하고 싶다면 여기서 호출 가능
            return None

        # 0.5. 주식 종목 추천 (오늘의 모멘텀 스킬)
        recommendation_keywords = ['오늘의 종목', '유망 종목', '상승 종목', '종목 추천']
        if self._skill_enabled("stock_recommendation") and \
           any(keyword in message_lower for keyword in recommendation_keywords) and \
           not any(k in message_lower for k in ['일정', '프로젝트', '알림']):
            logger.info("Detected stock recommendation query")
            if self.stock_recommendation_skill:
                try:
                    results = self.stock_recommendation_skill.get_recommendation_context()
                    return {
                        "tool": "get_stock_recommendations",
                        "results": results
                    }
                except Exception as e:
                    logger.error(f"Stock recommendation logic error: {e}")

        # 0.7. Gmail 메일 확인 / 전송
        gmail_check_keywords = ['메일 확인', '이메일 확인', '메일 봐줘', '메일 보여줘', '받은편지함', '미읽은 메일', '안읽은 메일', '새 메일']
        gmail_send_keywords = ['메일 보내', '이메일 보내', '메일 전송', '이메일 전송', '메일 발송', '이메일 발송']

        if self._skill_enabled("gmail") and any(k in message_lower for k in gmail_check_keywords):
            logger.info("Detected Gmail CHECK request")
            if self.gmail_skill:
                try:
                    summary = self.gmail_skill.get_unread_summary(max_results=5)
                    return {"tool": "check_gmail", "results": {"summary": summary}}
                except Exception as e:
                    logger.error(f"Gmail check error: {e}")
            else:
                return {
                    "tool": "system_instruction",
                    "results": {"instruction": "Gmail 스킬이 초기화되지 않았습니다. 서버에서 Gmail 인증을 먼저 완료해야 합니다."}
                }

        if self._skill_enabled("gmail") and any(k in message_lower for k in gmail_send_keywords):
            logger.info("Detected Gmail SEND request - injecting system instruction")
            return {
                "tool": "system_instruction",
                "results": {
                    "instruction": f"""[Gmail 이메일 전송 요청 감지]
사용자가 이메일을 전송하려고 합니다.
반드시 아래 JSON 형식을 응답에 포함하세요:

```json
{{"tool": "send_gmail", "to": "수신자@이메일.com", "subject": "제목", "body": "본문 내용"}}
```

사용자 메시지: {user_message}

참고:
- 수신자 이메일 주소, 제목, 본문이 명확하지 않으면 사용자에게 먼저 물어보세요.
- 확인 후 JSON 도구 호출을 출력하세요."""
                }
            }


        # 1. 날씨 검색
        weather_keywords = ['날씨', '기온', '미세먼지', '강수', '비', '눈']
        # 알림/설정 키워드가 함께 있으면 날씨 조회가 아닌 날씨 알림 등록 요청임 → 건너뜀
        is_weather_reminder = any(k in message_lower for k in ['알림', '설정', '등록', '리마인드']) and \
                              any(k in message_lower for k in ['날씨', '기온'])
        # '비'가 '비트코인'의 일부일 수 있으므로 예외 처리
        if self._skill_enabled("weather") and any(keyword in message_lower for keyword in weather_keywords) and not is_weather_reminder:
            # 비트코인 예외 처리
            if '비트코인' in message_lower and '비' in message_lower and not any(k in message_lower for k in ['날씨', '오나', '오는지', '그치']):
                 # '비트코인'만 있고 날씨 관련 명확한 서술어가 없으면 날씨로 탐지하지 않음
                 pass
            else:
                # 지역 추출
                location = self._extract_location(user_message)
                if not location:
                    location = "서울"  # 기본값
                
                query = f"{location} 현재 기온"
                logger.info(f"Detected weather query: {query}")
                
                try:
                    # Use OpenWeatherMap if available
                    if self.weather_client:
                        logger.info(f"Using OpenWeatherMap for location: {location}")
                        results = self.weather_client.get_weather(location)
                        
                        # Check for errors in results
                        if "error" not in results:
                            # Use context formatter if available
                            formatted = ""
                            if hasattr(self.weather_client, 'get_weather_context'):
                                formatted = self.weather_client.get_weather_context(results)
                                
                            return {
                                "tool": "get_weather",
                                "location": location,
                                "results": results,
                                "formatted": formatted
                            }
                        else:
                            logger.warning(f"Weather client returned error: {results['error']}. Falling back to search.")
                    
                    # Fallback to No-Key Search Skill
                    if self.search_skill:
                        results = self.search_skill.search(f"{location} 현재 날씨")
                        formatted = ""
                        if hasattr(self.search_skill, 'get_search_context'):
                            formatted = self.search_skill.get_search_context(results)
                            
                        return {
                            "tool": "web_search",
                            "query": f"{location} 현재 날씨",
                            "results": results,
                            "formatted": formatted
                        }
                except Exception as e:
                    logger.error(f"Weather search error: {e}")
        
        # 1.5. 날씨 알림 설정 전용 처리 ("오전 7:00 날씨 알림 설정", "날씨 알림 등록")
        if is_weather_reminder:
            logger.info("Detected weather REMINDER setup request (not weather query)")
            location = self._extract_location(user_message) or "서울"
            time_expr = self._extract_time_expression(user_message) or user_message
            
            # cron_scheduler가 있으면 직접 등록
            if self.cron_scheduler and user_id and chat_id:
                try:
                    from cron_scheduler import parse_natural_cron
                    cron_expr = parse_natural_cron(time_expr)
                    if not cron_expr:
                        # 전체 메시지로 한번 더 시도
                        cron_expr = parse_natural_cron(user_message)
                    if cron_expr:
                        ai_task = f"{location} 날씨 알려줘"
                        sid = self.cron_scheduler.add_schedule(
                            user_id=user_id,
                            chat_id=chat_id,
                            ai_task=ai_task,
                            cron_expression=cron_expr,
                            name=f"날씨 알림 ({time_expr})",
                            description=f"매일 {time_expr}에 {location} 날씨 알림"
                        )
                        return {
                            "tool": "create_schedule",
                            "results": {
                                "success": True,
                                "schedule_id": sid,
                                "cron": cron_expr,
                                "ai_task": ai_task,
                                "message": f"{time_expr}마다 {location} 날씨 알림이 등록되었습니다. (ID: {sid})"
                            }
                        }
                except Exception as e:
                    logger.error(f"Weather reminder setup error: {e}")
            
            # cron_scheduler가 없으면 LLM에게 위임
            return {
                "tool": "system_instruction",
                "results": {
                    "instruction": f"""[날씨 알림 등록 요청]
사용자가 날씨 알림을 설정하려 합니다: "{user_message}"
반드시 아래 JSON을 출력하여 create_schedule 도구를 호출하세요:

```json
{{"tool": "create_schedule", "time_expression": "{time_expr}", "ai_task": "{location} 날씨 알려줘"}}
```

- time_expression은 사용자가 말한 시간(예: "오전 7:00", "매일 오전 7시")을 그대로 씁니다.
- 절대로 "설정하겠습니다"만 쓰고 JSON 없이 끝내지 마세요."""
                }
            }
        
        # 2. 시스템 상태 조회
        if self._skill_enabled("server") and any(keyword in message_lower for keyword in ['시스템 상태', '서버 상태', 'cpu 점유율', '메모리 점유율', '디스크 잔량', '서버 리소스', '리소스 상태', '살아있어']):
            logger.info("Detected system status query")
            
            try:
                resources = self.mcp_server.get_system_resources()
                formatted = f"💻 **시스템 상태**\n• CPU: {resources.get('cpu_usage', 0)}%\n• 메모리: {resources.get('memory_usage', 0)}%\n• 디스크: {resources.get('disk_usage', 0)}%"
                return {
                    "tool": "get_system_resources",
                    "results": resources,
                    "formatted": formatted
                }
            except Exception as e:
                logger.error(f"System resources error: {e}")
        
        # 3. 시간 조회
        if any(keyword in message_lower for keyword in ['시간', '몇 시', '현재 시각', '지금']):
            logger.info("Detected time query")
            
            try:
                time_info = self.mcp_server.get_server_time()
                formatted = f"⏰ **현재 시간**: {time_info.get('time', '')}"
                return {
                    "tool": "get_server_time",
                    "results": time_info,
                    "formatted": formatted
                }
            except Exception as e:
                logger.error(f"Server time error: {e}")
        
        # 3.5. 가상화폐 정보 (주가보다 우선)
        crypto_keywords = ['비트코인', '이더리움', '리플', '솔라나', '도지코인', '가상화폐', '코인', 'btc', 'eth', 'xrp']
        if self._skill_enabled("crypto") and any(keyword in message_lower for keyword in crypto_keywords):
            logger.info("Detected crypto query")
            
            ticker = "BTC"
            if '이더' in message_lower or 'eth' in message_lower: ticker = "ETH"
            elif '리플' in message_lower or 'xrp' in message_lower: ticker = "XRP"
            elif '솔라' in message_lower or 'sol' in message_lower: ticker = "SOL"
            elif '도지' in message_lower or 'doge' in message_lower: ticker = "DOGE"
            
            if self.crypto_client:
                try:
                    logger.info(f"Using CryptoSkill for: {ticker}")
                    results = self.crypto_client.get_crypto_price(ticker)
                    if not results.get("error"):
                         # Context addition
                         context = self.crypto_client.get_crypto_context(results)
                         results["context"] = context
                         return {
                             "tool": "get_crypto_price",
                             "ticker": ticker,
                             "results": results,
                             "formatted": context
                         }
                    else:
                        logger.warning(f"Crypto client error: {results.get('error')}")
                except Exception as e:
                    logger.error(f"Crypto client error: {e}")
            
            # Fallback
            query = f"{ticker} 시세"
            if self.search_skill:
                try:
                    results = self.search_skill.search(query)
                    formatted = ""
                    if hasattr(self.search_skill, 'get_search_context'):
                        formatted = self.search_skill.get_search_context(results)
                    return {
                        "tool": "web_search",
                        "query": query,
                        "results": results,
                        "formatted": formatted
                    }
                except Exception as e:
                    logger.error(f"Crypto search error: {e}")

        # 4. 주가 정보
        if self._skill_enabled("stock") and any(keyword in message_lower for keyword in ['주가', '주식', '코스피', '코스닥', '삼성', 'sk하이닉스', '네이버', '카카오', '애플', '테슬라']):
            stock_name = self._extract_stock_name(user_message)
            
            # 주식 클라이언트가 있고, 종목명이 추출된 경우
            logger.info(f"Stock keyword check: client={self.stock_client is not None}, name={stock_name}")
            
            if self.stock_client and stock_name:
                try:
                    # 바로 심볼인 경우 (예: 005930.KS)
                    if "." in stock_name or (len(stock_name) <= 5 and stock_name.isupper()):
                        symbol = stock_name
                    else:
                        # 1. 심볼 검색
                        search_result = self.stock_client.search_symbol(stock_name)
                        best_matches = search_result.get("bestMatches", [])
                        
                        symbol = None
                        if best_matches:
                            # 한국 종목 우선 순위
                            symbol = best_matches[0].get("1. symbol")
                            for match in best_matches:
                                match_symbol = match.get("1. symbol", "")
                                if ".KS" in match_symbol or ".KQR" in match_symbol:
                                    symbol = match_symbol
                                    break
                    
                    if symbol:
                        logger.info(f"Stock check: {stock_name} -> {symbol}")
                        # 2. 주가 조회
                        quote = self.stock_client.get_stock_quote(symbol)
                        
                        # 데이터 확인 (Note나 Error가 아닌 실제 데이터가 있는지)
                        if quote.get("Global Quote", {}).get("05. price") and "error" not in quote:
                            gq = quote.get("Global Quote", {})
                            formatted = f"📈 **주가 정보 ({symbol})**\n• 현재가: {gq.get('05. price')}\n• 변화: {gq.get('09. change')} ({gq.get('10. change percent')})\n• 거래량: {gq.get('06. volume')}"
                            return {
                                "tool": "get_stock_price",
                                "symbol": symbol,
                                "results": quote,
                                "formatted": formatted
                            }
                        else:
                            logger.warning(f"Stock data empty or error for {symbol}: {quote}")
                    
                except Exception as e:
                    logger.error(f"Stock client error: {e}")
            
            # Fallback to No-Key Search Skill if client fails or not available
            query = f"{stock_name} 주가" if stock_name else "코스피 주가"
            logger.info(f"Detected stock query (fallback): {query}")
            
            if self.search_skill:
                try:
                    results = self.search_skill.search(query)
                    if results:
                        formatted = ""
                        if hasattr(self.search_skill, 'get_search_context'):
                            formatted = self.search_skill.get_search_context(results)
                        return {
                            "tool": "web_search",
                            "query": query,
                            "results": results,
                            "formatted": formatted
                        }
                except Exception as e:
                    logger.error(f"Stock search error: {e}")
        
        # 5. 환율 정보
        currency_keywords = ['환율', '달러', '엔화', '위안', '유로', '파운드']
        if self._skill_enabled("currency") and any(keyword in message_lower for keyword in currency_keywords):
            logger.info("Detected currency exchange query")
            
            # 통화 추출 (한글 → currency.py 내부에서 ISO 변환)
            currency = "달러"
            if '엔' in message_lower or '일본' in message_lower:
                currency = "엔"
            elif '유로' in message_lower or '유럽' in message_lower:
                currency = "유로"
            elif '위안' in message_lower or '중국' in message_lower:
                currency = "위안"
            elif '파운드' in message_lower or '영국' in message_lower:
                currency = "파운드"
            elif '호주' in message_lower:
                currency = "호주달러"
            elif '캐나다' in message_lower:
                currency = "캐나다달러"

            # 주요 통화 전체 조회 요청
            if any(k in message_lower for k in ['주요 환율', '전체 환율', '환율 목록', '여러 환율']):
                if hasattr(self, 'currency_client') and self.currency_client:
                    try:
                        results = self.currency_client.get_multiple_rates()
                        if results and not results.get("error"):
                            context = _format_multiple_rates(results)
                            return {"tool": "get_multiple_exchange_rates", "results": results, "formatted": context}
                    except Exception as e:
                        logger.error(f"Multiple rates error: {e}")

            # 단일 통화 조회 — execute_tool 경유로 한글→ISO 변환 보장
            if hasattr(self, 'currency_client') and self.currency_client:
                try:
                    logger.info(f"Using CurrencySkill for: {currency}")
                    results = self.currency_client.execute_tool(
                        "get_exchange_rate", {"currency": currency}
                    )
                    if results and not results.get("error"):
                        context = self.currency_client.get_exchange_rate_context(results)
                        results["context"] = context
                        return {
                            "tool": "get_exchange_rate",
                            "currency": currency,
                            "results": results,
                            "formatted": context
                        }
                    else:
                        logger.warning(f"Currency client error: {results.get('error')}. Falling back to search.")
                except Exception as e:
                    logger.error(f"Currency client error: {e}")

            # Fallback: 검색 스킬
            query = f"{currency} 환율 오늘"
            logger.info(f"Currency fallback to search: {query}")
            if self.search_skill:
                try:
                    results = self.search_skill.search(query)
                    if results:
                        formatted = self.search_skill.get_search_context(results) if hasattr(self.search_skill, 'get_search_context') else ""
                        return {"tool": "web_search", "query": query, "results": results, "formatted": formatted}
                except Exception as e:
                    logger.error(f"Currency search error: {e}")

        # (Moved Crypto logic to priority #4)
        # "it"와 "뉴스/소식/동향"이 같이 있거나, "테크", "기술" 관련 키워드
        it_keywords = ['ai', '인공지능', 'tech', '테크', '소프트웨어', '하드웨어', '기술', 'it']
        news_keywords = ['뉴스', '소식', '동향', '트렌드', '정보']
        
        has_it_keyword = any(k in message_lower for k in it_keywords)
        has_news_keyword = any(k in message_lower for k in news_keywords)
        
        if self._skill_enabled("news") and ((has_it_keyword and has_news_keyword) or any(k in message_lower for k in ['it뉴스', '기술뉴스', '테크뉴스', 'ai뉴스'])):
            # IT 뉴스 키워드 추출
            news_subject = "IT 기술"
            # 우선순위가 높은(앞에 있는) 키워드부터 매칭
            for k in it_keywords:
                if k in message_lower:
                    news_subject = k.upper() if k == "ai" else k
                    break
            
            query = f"{news_subject} 뉴스" if news_subject != "IT 기술" else "IT 기술"
            logger.info(f"Detected IT news query: {query}")
            
            # News API 사용
            news_data = None
            if self.news_client:
                try:
                    # news_data가 리스트인 경우와 딕셔너리인 경우 모두 대응
                    news_data = self.news_client.search_news(query, limit=5, locale="kr") 
                    
                    articles = []
                    if isinstance(news_data, list):
                        articles = news_data
                    elif isinstance(news_data, dict):
                        articles = news_data.get("data", [])
                    
                    if articles and len(articles) > 0:
                        formatted = ""
                        if hasattr(self.news_client, 'get_news_context'):
                             formatted = self.news_client.get_news_context(articles)
                        return {
                            "tool": "news_search",
                            "query": query,
                            "results": news_data,
                            "formatted": formatted
                        }
                    else:
                        logger.warning(f"News search returned empty results or error for: {query}")
                except Exception as e:
                    logger.error(f"News client error: {e}")
            
            # Fallback to No-Key Search if news_data is empty or news_client failed
            if self.search_skill:
                try:
                    web_query = f"{query} 최신"
                    logger.info(f"Falling back to No-Key Search: {web_query}")
                    results = self.search_skill.search(web_query)
                    if results:
                        formatted = ""
                        if hasattr(self.search_skill, 'get_search_context'):
                            formatted = self.search_skill.get_search_context(results)
                        return {
                            "tool": "web_search",
                            "query": web_query,
                            "results": results,
                            "formatted": formatted
                        }
                except Exception as e:
                    logger.error(f"IT news search error: {e}")
        
        # 7. 일반 뉴스/정보 검색 (위의 카테고리에 속하지 않은 경우)
        if self._skill_enabled("news") and has_news_keyword:
            # 일반 뉴스 쿼리 정제
            generic_keywords = ['뉴스', '알려줘', '오늘', '보여줘', '최신', '소식', '속보']
            query = user_message
            for k in generic_keywords:
                query = query.replace(k, '')
            query = query.strip()
                
            logger.info(f"Detected news query. Topic: '{query}'")
            
            try:
                # 로케일 감지 및 언어 설정
                locale = "kr"
                language = "ko"
                if any(k in message_lower for k in ['us', 'usa', 'america', 'world']):
                    locale = "us"
                    language = "en"
                
                news_data = None
                query_label = "주요 뉴스"
                
                # 쿼리가 비어있거나 너무 짧으면 'Top News' 호출
                if self.news_client:
                    if not query or len(query) < 2:
                        logger.info(f"Using get_top_news for generic request (locale: {locale})")
                        news_data = self.news_client.get_top_news(limit=5, locale=locale)
                    else:
                        # 쿼리가 있으면 검색 호출
                        logger.info(f"Searching news for: {query}")
                        news_data = self.news_client.search_news(keyword=query, limit=5, locale=locale, language=language)
                        query_label = query
                
                if news_data:
                    # articles 추출 (리스트/딕셔너리 대응)
                    articles = []
                    if isinstance(news_data, list):
                        articles = news_data
                    elif isinstance(news_data, dict):
                        articles = news_data.get("data", [])
                    
                    if articles:
                        formatted = ""
                        if hasattr(self.news_client, 'get_news_context'):
                            formatted = self.news_client.get_news_context(articles)
                        
                        return {
                            "tool": "news_search",
                            "query": query_label,
                            "results": news_data,
                            "formatted": formatted
                        }
            except Exception as e:
                logger.error(f"News client error: {e}")
            
            # Fallback to No-Key Search
            if self.search_skill:
                try:
                    results = self.search_skill.search(query)
                    if results:
                        formatted = ""
                        if hasattr(self.search_skill, 'get_search_context'):
                            formatted = self.search_skill.get_search_context(results)
                        return {
                            "tool": "web_search",
                            "query": query,
                            "results": results,
                            "formatted": formatted
                        }
                except Exception as e:
                    logger.error(f"General news search error: {e}")

        # 8-0. 업무일지/작업일지 생성 (캘린더보다 먼저 처리)
        worklog_keywords = ['업무일지', '작업일지', '일일보고', '일지 작성', '일지를', '일지 만들', '업무 보고', '작업 보고']
        if any(k in message_lower for k in worklog_keywords):
            logger.info("Detected work log generation request")
            date_param = "오늘"
            if '어제' in message_lower or 'yesterday' in message_lower:
                date_param = "어제"
            elif '내일' in message_lower or 'tomorrow' in message_lower:
                date_param = "내일"
            import re
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', user_message)
            if date_match:
                date_param = date_match.group(1)
            if self.calendar_client:
                try:
                    from skills.worklog import WorkLogSkill
                    from config import BASE_DIR
                    wl = WorkLogSkill(calendar_client=self.calendar_client, project_skill=self.project_skill, base_dir=BASE_DIR)
                    result = wl.generate(date=date_param)
                    return {
                        "tool": "generate_work_log",
                        "results": result
                    }
                except Exception as e:
                    logger.error(f"WorkLog skill error: {e}")
            else:
                return {
                    "tool": "system_instruction",
                    "results": {
                        "instruction": "캘린더 연동이 없어 업무일지를 자동 생성할 수 없습니다. 구글 캘린더를 연결하세요."
                    }
                }

        # 7.5. 프로젝트 관리 (간트 차트)
        project_keywords = ['프로젝트', '간트', '작업 리스트', '프로젝트 리스트', '프로젝트 작업']
        # '프로젝트 작업 확인', '오늘 프로젝트 일정' 등 다양한 표현 감지
        has_project_keyword = any(k in message_lower for k in project_keywords)
        if self._skill_enabled("project") and has_project_keyword:
            logger.info("Detected Project Management query")
            if self.project_skill:
                try:
                    # 1. 프로젝트 목록 자체 요청 (먼저 확인)
                    if any(k in message_lower for k in ['프로젝트 목록', '프로젝트들', '프로젝트 리스트', '프로젝트만', '어떤 프로젝트']):
                        results = self.project_skill.get_projects()
                        return {
                            "tool": "list_projects",
                            "results": results
                        }
                    # 2. 목록/작업/일정 조회 의도 확인 (확인/조회/보여줘/오늘/이번주 등)
                    view_keywords = ['조회', '확인', '보여', '목록', '리스트', '뭐 있어', '오늘', '이번주', '이번달', '이번 주', '작업', '일정']
                    if any(k in message_lower for k in view_keywords):
                        results = self.project_skill.get_tasks()
                        formatted = self.project_skill.get_schedule_context(results) if hasattr(self.project_skill, 'get_schedule_context') else ""
                        return {
                            "tool": "list_project_tasks",
                            "results": results,
                            "formatted": formatted
                        }
                    
                    # 3. 그 외 프로젝트 언급 시 작업 목록 조회로 기본 처리
                    results = self.project_skill.get_tasks()
                    formatted = self.project_skill.get_schedule_context(results) if hasattr(self.project_skill, 'get_schedule_context') else ""
                    return {
                        "tool": "list_project_tasks",
                        "results": results,
                        "formatted": formatted
                    }
                except Exception as e:
                    logger.error(f"Project skill execution error: {e}")
                    return {"tool": "error", "results": f"프로젝트 스킬 실행 중 오류: {str(e)}"}
            else:
                # project_skill이 없을 때: LLM에게 도구 호출 유도
                return {
                    "tool": "system_instruction",
                    "results": {
                        "instruction": "사용자가 프로젝트 관련 요청을 했습니다. list_project_tasks 도구를 호출하여 프로젝트 일정을 조회하세요. 추측하거나 텍스트로만 답변하지 마세요."
                    }
                }

        # 8. 구글 캘린더 일정 추가/조회/삭제
        # (웹 검색보다 높은 우선순위 부여)
        calendar_keywords = ['캘린더', '일정', '스케줄 구글', '구글 일정', '약속', '미팅', '회의', '생일', '기념일', '투두']
        action_add = ['추가', '등록', '잡아줘', '만들어']
        action_list = ['조회', '보여줘', '목록', '확인', '뭐 있어', '언제', '머야', '뭐야', '어때', '찾아', '어딨어', '어케', '어떻게']
        action_delete = ['취소', '삭제', '지워', '없애']

        # '일정' 등의 키워드가 있으면 캘린더 우선
        # 단, '뉴스' 관련 키워드가 있으면 뉴스 기능에 양보하도록 제외 처리 추가
        # 단!! '프로젝트' 단어가 있으면 프로젝트 스킬에 양보하도록 제외 처리 추가
        has_calendar_ref = any(k in message_lower for k in calendar_keywords)
        is_calendar_action = any(k in message_lower for k in action_add + action_list + action_delete)
        
        # 뉴스 키워드 확인 (상단 IT/일반 뉴스 로직에서 사용한 동일 키워드 활용)
        has_news_conflict = any(k in message_lower for k in ['뉴스', 'news', '소식', '속보', '동향'])
        has_project_conflict = '프로젝트' in message_lower or '간트' in message_lower

        if (has_calendar_ref or (is_calendar_action and any(k in message_lower for k in ['오늘', '내일', '이번주', '주말']))) and not has_news_conflict and not has_project_conflict:
            logger.info("Detected Google Calendar query")
            
            # 목록 조회 (추가/삭제 키워드가 없을 때만)
            if not any(k in message_lower for k in action_add + action_delete):
                # 1. 상대 시간 감지
                day_param = None
                if '오늘' in message_lower:
                    day_param = 'today'
                elif '내일' in message_lower:
                    day_param = 'tomorrow'
                
                # 2. 검색어 추출
                query = user_message
                clean_keywords = calendar_keywords + action_list + ['알려줘', '있어', '확인이', '일정에서', '오늘', '내일', '이번주']
                for k in clean_keywords:
                     query = query.replace(k, '')
                query = query.strip().replace('?', '').replace('!', '')
                
                if self.calendar_client:
                    try:
                        # 쿼리가 있거나 day_param이 있으면 검색
                        if query or day_param:
                            logger.info(f"Searching calendar events: query='{query}', day={day_param}")
                            results = self.calendar_client.search_events(query, day=day_param, max_results=10)
                            if results:
                                return {
                                    "tool": "search_calendar",
                                    "query": query or day_param,
                                    "results": results
                                }
                            else:
                                logger.info("Calendar search returned no results, falling back to list")
                        
                        # 명시적으로 "일정 다 보여줘" 같은 경우 또는 검색 결과 없을 때
                        logger.info("Listing upcoming calendar events")
                        results = self.calendar_client.list_upcoming_events(10)
                        return {
                            "tool": "list_google_calendar_events",
                            "results": results
                        }
                    except Exception as e:
                        logger.error(f"Calendar search/list error: {e}")
            
            # 일정 추가: LLM이 JSON 도구 호출을 생성하도록 강제 유도
            elif any(k in message_lower for k in action_add):
                logger.info("Detected Calendar ADD request - injecting system instruction")
                current_time_str = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
                return {
                    "tool": "system_instruction",
                    "results": {
                        "instruction": f"""[캘린더 일정 등록 요청 감지]
현재 시간: {current_time_str}

사용자가 캘린더에 일정을 등록하려고 합니다.
반드시 아래 JSON 형식을 응답에 포함하세요. 절대로 JSON 없이 "등록했습니다"라고만 답변하지 마세요.

```json
{{"tool": "add_calendar_event", "summary": "일정 제목", "start_time": "YYYY-MM-DDTHH:MM:SS", "end_time": "YYYY-MM-DDTHH:MM:SS"}}
```

사용자 메시지: {user_message}

참고:
- start_time은 ISO 8601 형식으로 변환하세요 (예: 2월 24일 → 2026-02-24T09:00:00)
- 시간이 명시되지 않으면 오전 9시(09:00:00)를 기본값으로 사용하세요
- end_time이 명시되지 않으면 start_time + 1시간으로 설정하세요
- JSON을 출력한 후에 "등록합니다" 등의 자연어 답변을 추가하세요"""
                    }
                }
            
            # 일정 삭제: LLM이 JSON 도구 호출을 생성하도록 강제 유도
            elif any(k in message_lower for k in action_delete):
                logger.info("Detected Calendar DELETE request - injecting system instruction")
                return {
                    "tool": "system_instruction",
                    "results": {
                        "instruction": f"""[캘린더 일정 삭제 요청 감지]

사용자가 캘린더에서 일정을 삭제하려고 합니다.
반드시 아래 JSON 형식을 응답에 포함하세요.

```json
{{"tool": "delete_calendar_event", "query": "검색어", "day": "YYYY-MM-DD"}}
```

사용자 메시지: {user_message}

참고:
- query에는 삭제할 일정을 찾을 수 있는 검색어를 넣으세요
- day는 특정 날짜를 알 경우 추가하세요 (선택사항)"""
                    }
                }

        # 9. 명시적 일반 검색 요청 ("검색해줘", "찾아줘")
        # 단, 주식/날씨/캘린더 등이 이미 감지되었다면 이리로 오지 않음.
        if any(keyword in message_lower for keyword in ['검색해', '찾아줘', '구글링']):
            query = user_message.replace('검색해줘', '').replace('찾아줘', '').replace('구글링', '').replace('검색', '').strip()
            if query and self.search_skill:
                logger.info(f"Detected explicit search query: {query}")
                try:
                    results = self.search_skill.search(query)
                    if results:
                        return {
                            "tool": "web_search",
                            "query": query,
                            "results": results
                        }
                except Exception as e:
                    logger.error(f"Explicit search error: {e}")
        
        # 10. 알림 및 스케줄 조회/삭제 (통합)
        if any(keyword in message_lower for keyword in ['스케줄', '알림', '예약', '일정']):
            # 조회 ("확인", "보여줘", "목록")
            if any(keyword in message_lower for keyword in ['확인', '보여', '목록', '뭐', '어떤', '조회']):
                logger.info("Detected schedule/reminder LIST query")
                
                results = {}
                # 1. Cron Schedules
                if self.cron_scheduler:
                    try:
                        results['recurring_schedules'] = self.cron_scheduler.get_user_schedules(user_id) if user_id else []
                    except Exception as e:
                        logger.error(f"Cron list error: {e}")
                
                # 2. One-time Reminders
                if self.reminder_manager and user_id:
                     try:
                         # ReminderManager.get_user_reminders 활용
                         reminders = self.reminder_manager.get_user_reminders(user_id)
                         results['one_time_reminders'] = reminders
                     except Exception as e:
                         logger.error(f"Reminder list error: {e}")
                
                if results:
                    return {
                        "tool": "list_all_reminders", # Wrapper 내부 통합 툴
                        "results": results
                    }

            # 삭제 (LLM 위임)
            if any(keyword in message_lower for keyword in ['삭제', '취소', '지워', '없애']):
                 logger.info("Detected schedule/reminder DELETE query - delegating to LLM")
                 return {
                     "tool": "system_instruction",
                     "results": {
                         "instruction": f"""[알림/스케줄 삭제 요청]
사용자가 알림이나 스케줄을 삭제하려고 합니다.
1. `list_reminders` 및 `list_schedules` 도구를 사용하여 ID를 확인하세요.
2. 삭제할 대상의 ID를 찾아서 `delete_reminder` (일회성) 또는 `delete_schedule` (반복) 도구를 호출하세요.
3. ID를 모르면 사용자에게 목록을 보여주고 삭제할 번호를 물어보세요.
4. JSON 도구 호출을 생성하세요."""
                     }
                 }
        
        # 11. 문서 검색 (RAG)
        if any(keyword in message_lower for keyword in ['문서 검색', '내용 검색', '자료 검색']):
            # 검색어 추출: "검색해줘" 등을 제외
            query = user_message.replace('문서 검색', '').replace('내용 검색', '').strip()
            if query:
                logger.info(f"Detected document search query: {query}")
                try:
                    results = self.mcp_server.search_documents(query)
                    return {
                        "tool": "search_documents",
                        "query": query,
                        "results": results
                    }
                except Exception as e:
                    logger.error(f"Document search error: {e}")

        # 12. IP 차단 및 네트워크 제어 (보안)
        # 키워드: "차단", "block", "ban" + IP 주소
        if self.system_skill and any(k in message_lower for k in ['차단', 'block', 'ban', '막아']):
            # IP 주소 추출 (IPv4)
            ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
            ips = re.findall(ip_pattern, user_message)
            
            if ips:
                target_ip = ips[0]
                logger.info(f"Detected IP block request for: {target_ip}")
                
                # iptables 명령어 구성 (입/출력 모두 차단)
                # sudo 권한 필요 가정
                command = f"sudo iptables -A INPUT -s {target_ip} -j DROP && sudo iptables -A OUTPUT -d {target_ip} -j DROP"
                
                try:
                    logger.info(f"Executing IP block command: {command}")
                    result = self.system_skill.run_command(command)
                    
                    # 결과 메시지 구성
                    if not result.strip():
                        result = "명령어가 성공적으로 실행되었습니다 (출력 없음)."
                    
                    return {
                        "tool": "run_command",
                        "command": command,
                        "results": f"🔒 IP {target_ip} 차단 조치 완료.\n실행 결과: {result}"
                    }
                except Exception as e:
                    logger.error(f"IP block error: {e}")
                    return {
                        "tool": "error",
                        "results": f"IP 차단 실패: {str(e)}"
                    }

        # 13. 시스템 명령 실행 (run_command)
        if self.system_skill and any(keyword in message_lower for keyword in ['실행', '스크립트', '커맨드', '커맨드라인', '명령어', 'sh 실행', 'bat 실행']):
             logger.info("Detected command execution request")
             # 명령어/스크립트 추출 시도
             command = self._extract_command(user_message)
             if command:
                 try:
                     logger.info(f"Executing command via ToolWrapper: {command}")
                     result = self.system_skill.run_command(command)
                     return {
                         "tool": "run_command",
                         "command": command,
                         "results": result
                     }
                 except Exception as e:
                     logger.error(f"Command execution error: {e}")
             else:
                 # LLM에게 JSON으로 명확히 요청하라고 지시 (Fallback)
                 logger.info("Command execution intent detected but failed to extract command. Delegating to LLM.")
                 return {
                     "tool": "system_instruction",
                     "results": {
                         "instruction": f"""[SYSTEM_INSTRUCTION]
The user wants to EXECUTE a command/script: "{user_message}".
I could not automatically determine the exact command.
You MUST:
1. If the file is known (e.g. "security_check.sh"), output a JSON tool call for `run_shell_command` with the correct path.
2. If unknown, use `list_files` to find it first.
3. DO NOT just say "I will do it". OUTPUT THE JSON."""
                     }
                 }

        # 13. 알림 및 스케줄 설정 (New)
        if any(keyword in message_lower for keyword in ['알림', '예약', '일정 추가', '스케줄 추가', '리마인드']):
            logger.info("Detected reminder/schedule request")
            
            # 시간 표현 추출 시도
            # 예: "2분후 알림설정", "내일 오전 9시 알람"
            time_expr = self._extract_time_expression(user_message)
            
            # 메시지/내용 추출
            # "2분후 알림설정" -> 내용은 "알림" 정도로 처리되거나 비어있을 수 있음
            task_msg = user_message
            for k in ['알림', '예약', '일정 추가', '스케줄 추가', '리마인드', '설정', '해줘', '해']:
                task_msg = task_msg.replace(k, '')
            task_msg = task_msg.replace(time_expr or "", "").strip()
            
            if not task_msg:
                task_msg = "알림!"  # 기본 메시지
            
            # [CRITICAL] If this is a schedule request, force instruction to LLM to parse cron
            if any(k in user_message for k in ['매일', '매주', '매달', '반복']):
                logger.info("Detected recurring schedule. Delegating to LLM for Cron parsing.")
                return {
                    "tool": "system_instruction",
                    "results": {
                        "instruction": f"""[SYSTEM_INSTRUCTION]
The user wants to create a RECURRING schedule: "{user_message}".
You MUST generate a JSON tool call for either `create_schedule` or `set_reminder`.
- time_expression: "{time_expr}" or the full time part from the message.
- ai_task: "{task_msg}"
DO NOT say "checked" or "will do", just OUTPUT THE JSON."""
                    }
                }

            if time_expr:
                try:
                    # 1. 반복 스케줄 여부 확인 (매일, 매주...)
                    if any(k in user_message for k in ['매일', '매주', '매달']):
                        if self.cron_scheduler and user_id:
                            # Parse natural language time to cron
                            # This is complex, so we might want to let the LLM handle it via JSON tool call in the loop.
                            # BUT the user complaint is that it "says registered but isn't".
                            # If we return "intent_detected", the LLM claims success.
                            # So we either:
                            # A) Return None here and let the LLM generate the JSON tool call (Better for complex parsing)
                            # B) Try to execute it here.
                            
                            # Given the complexity of "Every day at 9am", letting LLM handle it is safer.
                            # So we return DEFAULT intent response BUT with a flag telling LLM to generate JSON.
                            
                            # However, for simple "5 minutes later", we can handle it if we have ReminderManager.
                            pass

                    else:
                        # 2. 일회성 알림 (Reminder)
                        if self.reminder_manager and user_id and chat_id:
                            # Parse delay/time
                            # Simple parsing for "N minutes later"
                            delay_seconds = 0
                            
                            # Parse "N minutes later"
                            minutes_match = re.search(r'(\d+)\s*분\s*후', time_expr)
                            hours_match = re.search(r'(\d+)\s*시간\s*후', time_expr)
                            seconds_match = re.search(r'(\d+)\s*초\s*후', time_expr)
                            
                            if minutes_match:
                                delay_seconds += int(minutes_match.group(1)) * 60
                            if hours_match:
                                delay_seconds += int(hours_match.group(1)) * 3600
                            if seconds_match:
                                delay_seconds += int(seconds_match.group(1))
                            
                            if delay_seconds > 0:
                                from datetime import timedelta
                                run_at = datetime.now() + timedelta(seconds=delay_seconds)
                                run_at_iso = run_at.isoformat()
                                
                                result = self.reminder_manager.add_reminder(
                                    user_id=user_id,
                                    chat_id=chat_id,
                                    message=task_msg,
                                    trigger_time=run_at
                                )
                                return {
                                    "tool": "set_reminder",
                                    "time_expression": time_expr,
                                    "message": task_msg,
                                    "run_at_str": run_at_iso,
                                    "results": result
                                }
                            
                            # If it's absolute time (e.g. "tomorrow at 9am") or complex recurring,
                            # return instruction for LLM to handle it via JSON tool call.
                            
                            # Valid strategy: If we can't parse it confidently, return "system_instruction" so LLM handles it.
                            logger.info(f"Complex reminder/schedule detected ('{time_expr}'). Delegating to LLM.")
                            return {
                                "tool": "system_instruction",
                                "results": {
                                    "instruction": f"""[SYSTEM_INSTRUCTION]
The user wants to set a schedule or reminder: "{user_message}".
You MUST generate a JSON tool call for either `set_reminder` (one-time) or `create_schedule` (recurring).
- Use `create_schedule` if the user said "매일", "매주", "every day", etc.
- Use `set_reminder` otherwise.
- Extract the time expression carefully from the user's message.
DO NOT say you will do it, just OUTPUT THE JSON."""
                                }
                            }
                except Exception as e:
                    logger.error(f"Reminder/Schedule extraction error: {e}")
                    
        return None

        return None
    
    def _extract_time_expression(self, message: str) -> Optional[str]:
        # 메시지에서 시간 표현 추출 (개선됨)
        # 더욱 다양한 시간/날짜 패턴 지원
        patterns = [
            r'(\d+분\s*후)',
            r'(\d+시간\s*후)',
            r'(\d+일\s*후)',
            r'(내일\s*(오전|오후)?\s*\d+시(\s*\d+분)?)',
            r'((오전|오후)\s*\d+시(\s*\d+분)?)',
            r'(\d+시(\s*\d+분)?)',
            r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})',
            r'(매일\s*(오전|오후)?\s*\d+시(\s*\d+분)?)', # 매일 9시
            r'(매주\s*(\w+요일)?\s*(오전|오후)?\s*\d+시(\s*\d+분)?)', # 매주 월요일 9시
            r'(주말\s*(오전|오후)?\s*\d+시(\s*\d+분)?)', # 주말 9시
            r'(평일\s*(오전|오후)?\s*\d+시(\s*\d+분)?)'  # 평일 9시
        ]
        
        for pattern in patterns:
            match = re.search(pattern, message)
            if match:
                return match.group(1)
        
        # '내일', '오늘' 등 키워드만 있는 경우
        if '내일' in message: return '내일'
        if '오늘' in message: return '오늘'
        if '매일' in message: return '매일'
        
        return None

    def _extract_command(self, message: str) -> Optional[str]:
        # 메시지에서 실행할 명령어나 스크립트 경로 추출
        message_lower = message.lower()
        
        # 0. 명시적 제외 키워드 확인 (파일 생성/읽기 요청과 혼동 방지)
        if any(k in message_lower for k in ['생성', '만들', '작성', '읽어', '보여']):
            return None

        # 1. 파일 경로 형태 감지 (data/test.sh, scripts/check.bat, ./run.sh 등) - arguments 포함 가능
        # 예: "./start.sh -v", "python scripts/main.py"
        path_match = re.search(r'([a-zA-Z0-9_/. -]+\.(sh|bat|py|exe|js)(\s+[a-zA-Z0-9_/. -]+)?)', message)
        if path_match:
            candidate = path_match.group(1).strip()
            return candidate
            
        # 2. 따옴표 안의 명령어 감지
        quote_match = re.search(r"['\"]([^'\"]+)['\"]", message)
        if quote_match:
            return quote_match.group(1)
            
        # 3. 키워드 이후 텍스트 추출 (향상된 로직)
        keywords = ['실행해줘', '실행해', '실행', '스크립트', '커맨드', '명령어', 'run']
        
        for k in keywords:
            if k in message:
                parts = message.split(k, 1)
                
                # "XX 실행해줘" -> 앞부분
                pre_part = parts[0].strip()
                # "실행해 XX" -> 뒷부분
                post_part = parts[1].strip()
                
                # 뒷부분이 명령어일 가능성
                if post_part and len(post_part) > 1:
                    # 불필요한 조사/접속사 제거 (은, 는, 및, 그리고...)
                    # "실행: ls -la" -> "ls -la"
                    # "실행 및 결과" -> "및" 제거 필요 -> 근데 "및"만 남으면 명령어가 아님
                    
                    cleaned = post_part
                    if cleaned.startswith(':') or cleaned.startswith('은') or cleaned.startswith('는'):
                        cleaned = cleaned[1:].strip()
                    
                    # 접속사로 시작하면 제거
                    for conj in ['및', '그리고', '하고', '랑', '와', '과']:
                        if cleaned.startswith(conj + " "):
                            cleaned = cleaned[len(conj)+1:].strip()
                        elif cleaned == conj:
                             cleaned = "" # 접속사만 있으면 무효
                    
                    if cleaned and len(cleaned) > 1:
                        return cleaned
                
                # 앞부분이 명령어일 가능성
                if pre_part and len(pre_part) > 1:
                    cleaned = pre_part
                    # 조사 제거 (을/를)
                    if cleaned.endswith('을'): cleaned = cleaned[:-1]
                    elif cleaned.endswith('를'): cleaned = cleaned[:-1]
                    
                    cleaned = cleaned.strip()
                    if cleaned and len(cleaned) > 1:
                        # "보안 스크립트" -> 이건 파일명이 아님. 
                        # 하지만 run_command로 넘기면 SystemSkill이 못 찾아서 에러 남.
                        # 여기서 "스크립트" 단어 자체를 명령어로 인식하면 안됨.
                        # [NEW] Alias Mapping
                        script_aliases = {
                            '보안 스크립트': './data/security_check.sh',
                            '보안 점검': './data/security_check.sh',
                            '시스템 점검': './data/security_check.sh',
                            '업데이트': './scripts/update.sh'
                        }
                        
                        if cleaned in script_aliases:
                            return script_aliases[cleaned]

                        if cleaned in ['스크립트', '명령', '그거']:
                            return None # Fallback to instruction
                        return cleaned
                    
        return None
    
    def _extract_location(self, message: str) -> Optional[str]:
        # 메시지에서 지역명 추출 (확장됨)
        # 1. 주요 광역시/도 및 시/군/구 리스트
        locations = [
            # 광역시/도
            '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', 
            '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
            # 주요 도시 (창원 포함)
            '창원', '수원', '성남', '의정부', '안양', '부천', '광명', '평택', '동두천', '안산', 
            '고양', '과천', '구리', '남양주', '오산', '시흥', '군포', '의왕', '하남', '용인', 
            '파주', '이천', '안성', '김포', '화성', '광주', '양주', '포천', '여주', '연천', 
            '가평', '양평', '춘천', '원주', '강릉', '동해', '태백', '속초', '삼척', '홍천', 
            '횡성', '영월', '평창', '정선', '철원', '화천', '양구', '인제', '고성', '양양',
            '청주', '충주', '제천', '보은', '옥천', '영동', '증평', '진천', '괴산', '음성', '단양',
            '천안', '공주', '보령', '아산', '서산', '논산', '계룡', '당진', '금산', '부여', '서천', 
            '청양', '홍성', '예산', '태안', '전주', '군산', '익산', '정읍', '남원', '김제', '완주', 
            '진안', '무주', '장수', '임실', '순창', '고창', '부안', '목포', '여수', '순천', '나주', 
            '광양', '담양', '곡성', '구례', '고흥', '보성', '화순', '장흥', '강진', '해남', '영암', 
            '무안', '함평', '영광', '장성', '완도', '진도', '신안', '포항', '경주', '김천', '안동', 
            '구미', '영주', '영천', '상주', '문경', '경산', '군위', '의성', '청송', '영양', '영덕', 
            '청도', '고령', '성주', '칠곡', '예천', '봉화', '울진', '울릉', '진주', '통영', '사천', 
            '김해', '밀양', '거제', '양산', '의령', '함안', '창녕', '고성', '남해', '하동', '산청', 
            '함양', '거창', '합천', '서귀포'
        ]
        
        # 2. 리스트 매칭
        for location in locations:
            if location in message:
                return location
                
        # 3. 정규식 매칭 (OO시, OO군, OO구, OO동)
        import re
        # "무슨 시", "어떤 구" 같은 의문사가 아닌 실제 지명 패턴
        # 수정: 동/읍/면은 날씨 API 인식률이 낮으므로 제외하고 시/군/구만 추출
        pattern = r'([가-힣]{2,})(시|군|구)'
        matches = re.findall(pattern, message)
        
        for match in matches:
            full_name = match[0] + match[1]
            # "혹시", "역시", "무슨시" 같은 오매칭 제외
            if full_name not in ['혹시', '역시', '반드시', '무슨시', '어떤시']:
                return full_name
        
        return None
    
    def _extract_stock_name(self, message: str) -> Optional[str]:
        # 메시지에서 주식명 추출
        # 매핑: 사용자가 입력할 법한 이름 -> Alpha Vantage 검색에 적합한 이름 또는 직접 심볼
        stock_map = {
            '삼성전자': '005930.KS',
            '삼성': '005930.KS',
            'sk하이닉스': '000660.KS',
            '하이닉스': '000660.KS',
            '네이버': '035420.KS',
            '카카오': '035720.KS',
            '현대차': '005380.KS',
            '현대자동차': '005380.KS',
            '기아': '000270.KS',
            '현대모비스': '012330.KS',
            '포스코': '005490.KS',
            'posco': '005490.KS',
            'lg화학': '051910.KS',
            'lg전자': '066570.KS',
            '애플': 'AAPL',
            '테슬라': 'TSLA',
            '엔비디아': 'NVDA',
            '구글': 'GOOGL',
            '마소': 'MSFT',
            '마이크로소프트': 'MSFT',
            '아마존': 'AMZN'
        }
        
        # 1. 매핑된 이름 우선 검색
        for key, value in stock_map.items():
            if key in message:
                return value
                
        # 2. 매핑되지 않은 경우, '주가' 앞의 단어 추출 시도 (간단한 휴리스틱)
        # 예: "LG전자 주가" -> "LG전자"
        import re
        match = re.search(r'([가-힣a-zA-Z0-9]+)\s*주가', message)
        if match:
            potential_name = match.group(1)
            if potential_name not in ['오늘', '지금', '현재', '실시간', '내일']:
                return potential_name
        
        return None
    
    def format_tool_result(self, tool_result: Dict[str, Any]) -> str:
        # 도구 실행 결과를 자연어로 포맷팅
        if not tool_result:
            return ""
        
        tool_name = tool_result.get("tool")
        results = tool_result.get("results")
        
        if tool_name == "get_weather":
            # OpenWeatherMap weather context (condensed for AI)
            if self.weather_client:
                return self.weather_client.get_weather_context(results)
            return str(results)
            
        elif tool_name == "get_exchange_rate":
            # 환율 정보 포맷팅
            if hasattr(self, 'currency_client') and self.currency_client:
                return self.currency_client.get_exchange_rate_context(results)
            return str(results)
            
        elif tool_name == "web_search" or tool_name == "brave_web_search":
            # 웹 검색 결과 포맷팅
            if self.search_skill:
                return self.search_skill.get_search_context(results)
            return str(results)
        
        elif tool_name == "get_system_resources":
            # 시스템 리소스 포맷팅
            cpu = results.get('cpu', {})
            memory = results.get('memory', {})
            disk = results.get('disk', {})
            
            formatted = "💻 시스템 상태:\n\n"
            formatted += f"• CPU: {cpu.get('usage_percent', 0)}% 사용 중 ({cpu.get('cores', 0)}코어)\n"
            formatted += f"• 메모리: {memory.get('used_gb', 0):.1f}GB / {memory.get('total_gb', 0):.1f}GB ({memory.get('usage_percent', 0)}%)\n"
            formatted += f"• 디스크: {disk.get('used_gb', 0):.1f}GB / {disk.get('total_gb', 0):.1f}GB ({disk.get('usage_percent', 0)}%)\n"
            return formatted
        
        elif tool_name == "get_server_time":
            # 시간 정보 포맷팅
            formatted = f"🕐 현재 시간: {results.get('current_time', 'N/A')}\n"
            formatted += f"   시간대: {results.get('timezone', 'N/A')}\n"
            return formatted
        
        elif tool_name == "list_schedules":
            # 스케줄 목록 포맷팅
            if not results:
                return "📅 등록된 스케줄이 없습니다."
            
            formatted = "📅 등록된 스케줄 목록:\n\n"
            for i, schedule in enumerate(results, 1):
                status_emoji = "✅" if schedule.get('enabled', True) else "❌"
                formatted += f"{i}. {status_emoji} **{schedule.get('name', 'N/A')}** (ID: `{schedule.get('id')}`)\n"
                formatted += f"   ⏰ {schedule.get('cron', 'N/A')} | ⚙️ {schedule.get('ai_task', 'N/A')}\n"
                if schedule.get('description'):
                    formatted += f"   📝 {schedule.get('description')}\n\n"
                else:
                    formatted += "\n"
            return formatted
        
        elif tool_name == "list_files":
            if results.get("error"):
                return f"⚠️ 파일 목록 조회 실패: {results.get('error')}"
                
            files = results.get("files", [])
            formatted = f"📂 **{results.get('path', '.')}** 파일 목록:\n\n"
            if not files:
                formatted += "(파일 없음)"
            for f in files:
                formatted += f"- 📄 `{f['name']}` ({f.get('size_bytes', 0)} bytes)\n"
            return formatted

        elif tool_name == "read_file":
            if results.get("error"):
                return f"⚠️ 파일 읽기 실패: {results.get('error')}"
                
            content = results.get("content", "")
            # 내용이 너무 길면 잘라서 보여줌
            if len(content) > 1000:
                content = content[:1000] + "\n...(생략)..."
                
            return f"📄 **{results.get('path')}** 내용:\n```\n{content}\n```"

        elif tool_name == "search_documents":
            matches = results.get("results", [])
            if not matches:
                return f"🔍 문서 검색 결과 없음: '{results.get('query')}'"
                
            formatted = f"🔍 **문서 검색 결과** ('{results.get('query')}'):\n\n"
            for match in matches:
                formatted += f"📄 **{match['file']}** ({match['matches']}개 일치)\n"
                for excerpt in match.get("relevant_excerpts", []):
                    formatted += f"> ...{excerpt['context'].strip()}...\n\n"
            return formatted
            
        elif tool_name == "set_reminder":
            # Check if results is a string (success, reminder_id) or a dict (error or struct)
            if isinstance(results, str):
                run_at = tool_result.get("run_at_str", "N/A")
                return f"✅ **알림이 등록되었습니다!**\n시간: {run_at}\nID: `{results}`"
            elif isinstance(results, dict) and results.get("status") == "success":
                return f"✅ **알림이 등록되었습니다!**\n시간: {results.get('run_at')}\nID: `{results.get('id')}`"
            else:
                error_msg = results.get('error', '알 수 없는 오류') if isinstance(results, dict) else str(results)
                return f"❌ 알림 등록 실패: {error_msg}"

        elif tool_name == "system_instruction":
            # 시스템 지시사항 반환 (LLM에게 행동 유도)
            return results.get("instruction", "")

        elif tool_name == "get_stock_price":
            # 주식 정보 포맷팅
            if self.stock_client:
                return self.stock_client.get_quote_context(results)
            return str(results)

        elif tool_name == "news_search":
            # 뉴스 검색 결과 포맷팅
            if self.news_client:
                return self.news_client.get_news_context(results)
            return str(results)

        elif tool_name == "get_stock_recommendations":
            # 주식 추천 컨텍스트 포맷팅
            indices = results.get("indices", {})
            news = results.get("news", [])
            date = results.get("date", "N/A")
            
            formatted = f"📈 **오늘의 주식 시장 분석 ({date})**\n\n"
            formatted += "📊 **시장 지수:**\n"
            if "error" in indices:
                formatted += f"  - 지수 정보를 가져올 수 없습니다: {indices['error']}\n"
            else:
                for name, data in indices.items():
                    formatted += f"  - {name}: {data['price']} ({data['percent']}%)\n"
            
            formatted += "\n📰 **주요 뉴스 헤드라인:**\n"
            if not news:
                formatted += "  - 최근 경제/정치 뉴스가 없습니다.\n"
            else:
                for i, item in enumerate(news[:5], 1):
                    formatted += f"  {i}. {item.get('title')} ({item.get('source', 'N/A')})\n"
            
            formatted += "\n💡 **AI 안내:** 위 데이터를 바탕으로 단기 모멘텀이 기대되는 종목 3개를 선정하여 분석 리포트를 작성하세요."
            return formatted

        elif tool_name == "generate_work_log":
            # 업무일지 생성 결과 포맷팅
            if isinstance(results, dict):
                if results.get("error"):
                    return f"❌ 업무일지 생성 실패: {results['error']}"
                content = results.get("content", "")
                file_path = results.get("file_path")
                saved = results.get("saved", False)
                out = "📋 **업무일지 생성 결과**\n"
                out += "-------------------------------------------------\n"
                out += f"{content}\n"
                out += "-------------------------------------------------\n"
                if saved and file_path:
                    out += f"💾 파일 저장 위치: `{file_path}`\n"
                else:
                    out += "⚠️ 파일이 저장되지 않았습니다.\n"
                out += "\n💡 **AI 안내:** 위 일지 내용을 그대로 사용자에게 보여주고, 추가 수정이 필요한지 물어보세요."
                return out
            return str(results)

        elif tool_name == "search_calendar":
            # 캘린더 검색 결과 포맷팅
            events = results
            if not events:
                return f"📅 '{tool_result.get('query')}' 관련 일정을 찾을 수 없습니다."
            
            formatted = f"📅 '{tool_result.get('query')}' 검색 결과:\n"
            for event in events:
                formatted += f"- {event['summary']} ({event['start']})\n"
            return formatted

        elif tool_name in ("add_calendar_event", "add_google_calendar_event"):
            # 캘린더 일정 등록 결과 포맷팅
            if isinstance(results, dict):
                if results.get("success"):
                    return f"✅ 일정이 등록되었습니다: **{results.get('message', '')}**\n🔗 {results.get('link', '')}"
                elif results.get("error"):
                    return f"❌ 일정 등록 실패: {results['error']}"
            return str(results)

        elif tool_name == "delete_calendar_event" or tool_name == "delete_google_calendar_event":
            # 캘린더 일정 삭제 결과 포맷팅
            if isinstance(results, dict):
                if results.get("success"):
                    return f"✅ {results.get('message', '일정이 삭제되었습니다.')}"
                elif results.get("error"):
                    return f"❌ {results['error']}"
            return str(results)

        elif tool_name == "list_project_tasks":
            # 프로젝트 작업(일정) 포맷팅
            if not results:
                return "📂 조회된 프로젝트 작업(일정)이 없습니다."
            
            # API returns results['data']
            tasks = results if isinstance(results, list) else results.get("data", [])
            if not tasks:
                return "📂 조회된 프로젝트 작업(일정)이 없습니다."
                
            formatted = "📂 **프로젝트 일정(작업) 목록**:\n\n"
            for task in tasks:
                status_map = {"todo": "📝", "in-progress": "🔄", "done": "✅", "delayed": "⚠️"}
                status_emoji = status_map.get(task.get('status'), "🔹")
                progress = task.get('progress', 0)
                formatted += f"{status_emoji} **{task.get('name')}** (ID: `{task.get('id')}`)\n"
                formatted += f"   📅 {task.get('startDate')} ~ {task.get('endDate')} ({progress}%)\n"
                if task.get('assignee'):
                    formatted += f"   👤 담당자: {task.get('assignee')}\n"
                if task.get('description'):
                    formatted += f"   💬 {task.get('description')}\n"
                formatted += "\n"
            return formatted

        elif tool_name == "list_projects":
            # 프로젝트 목록 포맷팅
            if not results:
                return "🏗️ 등록된 프로젝트가 없습니다."
                
            # API returns results['data']
            projects = results if isinstance(results, list) else results.get("data", [])
            if not projects:
                return "🏗️ 등록된 프로젝트가 없습니다."
                
            formatted = "🏗️ **프로젝트 목록**:\n\n"
            for project in projects:
                formatted += f"📁 **{project.get('name')}** (ID: `{project.get('id')}`)\n"
                formatted += f"   📅 {project.get('startDate')} ~ {project.get('endDate')} ({project.get('progress', 0)}%)\n"
                if project.get('description'):
                    formatted += f"   📄 {project.get('description')}\n"
                formatted += "\n"
            return formatted

        elif tool_name == "run_command":
            # 명령어 실행 결과 포맷팅
            success = results.get("success", False)
            status_emoji = "✅" if success else "❌"
            command = tool_result.get("command", "명령어 없음")
            
            stdout = results.get("stdout", "").strip()
            stderr = results.get("stderr", "").strip()
            returncode = results.get("returncode") if "returncode" in results else results.get("exit_code", "N/A")
            
            formatted = f"{status_emoji} **명령어 실행 결과**\n"
            formatted += f"💻 `cmd: {command}`\n"
            formatted += f"🔢 `exit code: {returncode}`\n\n"
            
            if stdout:
                formatted += f"📄 **표준 출력 (stdout):**\n```\n{stdout}\n```\n"
            if stderr:
                formatted += f"⚠️ **표준 에러 (stderr):**\n```\n{stderr}\n```\n"
            
            if not stdout and not stderr:
                formatted += "(출력 내용 없음)"
                
            return formatted

        elif tool_name in ("check_gmail",):
            summary = results.get("summary", "") if isinstance(results, dict) else str(results)
            return summary if summary else "📭 미읽은 메일이 없습니다."

        elif tool_name == "send_gmail":
            if isinstance(results, dict):
                if results.get("success"):
                    return f"✅ {results.get('message', '이메일이 전송되었습니다.')}"
                elif results.get("error"):
                    return f"❌ 이메일 전송 실패: {results['error']}"
            return str(results)

        elif tool_name == "list_all_reminders":
            # 통합 알림/스케줄 목록 포맷팅 (스케쥴 확인 요청 시)
            recurring = results.get("recurring_schedules", [])
            one_time = results.get("one_time_reminders", [])
            formatted = ""

            if recurring:
                formatted += "🔁 **반복 스케줄 목록:**\n\n"
                for i, s in enumerate(recurring, 1):
                    enabled = "✅" if s.get("enabled", True) else "❌"
                    cron_str = s.get("cron", "N/A")
                    # cron을 사람이 읽기 좋게 변환 (간단히)
                    formatted += f"{i}. {enabled} **{s.get('name', '이름 없음')}** (ID: `{s.get('id')}`)\n"
                    formatted += f"   ⏰ cron: `{cron_str}` | 작업: {s.get('ai_task', 'N/A')}\n\n"
            else:
                formatted += "🔁 등록된 반복 스케줄이 없습니다.\n\n"

            if one_time:
                formatted += "⏰ **일회성 알림 목록:**\n\n"
                for i, r in enumerate(one_time, 1):
                    import datetime as _dt
                    try:
                        dt = _dt.datetime.fromisoformat(r.get("trigger_time", ""))
                        time_str = dt.strftime("%Y-%m-%d %H:%M")
                    except Exception:
                        time_str = r.get("trigger_time", "N/A")
                    formatted += f"{i}. ⏰ **{r.get('message', '내용 없음')}** - {time_str} (ID: `{r.get('id')}`)\n"
            else:
                formatted += "⏰ 등록된 일회성 알림이 없습니다.\n"

            return formatted.strip() if formatted.strip() else "📭 등록된 알림 및 스케줄이 없습니다."

        elif tool_name == "create_schedule":
            # 스케줄 등록 결과 포맷팅
            if isinstance(results, dict):
                if results.get("success"):
                    msg = results.get("message", "")
                    sid = results.get("schedule_id", "N/A")
                    cron = results.get("cron", "")
                    task = results.get("ai_task", "")
                    out = f"✅ **스케줄이 등록되었습니다!**\n"
                    if msg:
                        out += f"📋 {msg}\n"
                    if cron:
                        out += f"⏰ 실행 주기: `{cron}`\n"
                    if task:
                        out += f"🤖 실행 작업: {task}\n"
                    out += f"🆔 스케줄 ID: `{sid}`"
                    return out
                elif results.get("error"):
                    return f"❌ 스케줄 등록 실패: {results['error']}"
            return str(results)

        return str(results)

