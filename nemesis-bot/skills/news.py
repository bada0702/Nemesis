
import logging
import requests
from typing import List, Dict
import feedparser

logger = logging.getLogger(__name__)

class NewsSkill:
    """RSS 피드 기반 뉴스 스킬 (완전 무료, API 키 불필요)"""
    
    def __init__(self, search_skill=None):
        self.search_skill = search_skill
        self.feeds = {
            "조선일보": "https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml",
            "중앙일보": "http://rss.joinsmsn.com/joins_news_list.xml",
            "한겨레": "http://www.hani.co.kr/rss/",
            "연합뉴스": "https://www.yna.co.kr/rss/news.xml",
            "YTN": "https://www.ytn.co.kr/_comm/rss_list.php",
            "SBS": "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01",
            "MBC": "https://imnews.imbc.com/rss/news/",
            "KBS": "https://news.kbs.co.kr/rss/news.xml"
        }
        # IT 전문 RSS 피드
        self.it_feeds = {
            "ZDNet Korea": "https://www.zdnet.co.kr/rss/rss.aspx",
            "IT조선": "https://it.chosun.com/rss/allArticle.xml",
            "전자신문": "https://www.etnews.com/rss/allArticle.xml",
            "디지털타임스": "http://www.dt.co.kr/rss/rss.xml",
            "연합뉴스IT": "https://www.yna.co.kr/rss/it.xml",
        }
    
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
            try:
                feed = feedparser.parse(self.feeds[src])
                for entry in feed.entries[:limit]:
                    headlines.append({
                        "source": src,
                        "title": entry.get("title", "제목 없음"),
                        "link": entry.get("link", ""),
                        "published": entry.get("published", ""),
                        "summary": entry.get("summary", "")[:200]
                    })
            except Exception as e:
                logger.error(f"Error fetching {src}: {e}")
                continue
        
        return headlines
    
    def search_news(self, keyword: str, limit: int = 5, locale: str = "kr", language: str = "ko") -> List[Dict]:
        """키워드로 뉴스 검색 (Naver 검색 우선 활용)"""
        # 1. SearchSkill이 있으면 더 넓은 범위의 최신 뉴스 검색 기능 활용
        if self.search_skill:
            try:
                search_query = f"{keyword} 뉴스"
                search_results = self.search_skill.search(search_query)
                # search()는 dict를 반환: {"web": {"results": [...]}, "query": ...}
                web_results = []
                if isinstance(search_results, dict) and "web" in search_results:
                    web_results = search_results["web"].get("results", [])
                elif isinstance(search_results, list):
                    web_results = search_results
                if web_results:
                    results = []
                    for res in web_results[:limit]:
                        results.append({
                            "source": "웹 검색",
                            "title": res.get("title", "제목 없음"),
                            "link": res.get("link", ""),
                            "published": "실시간",
                            "summary": res.get("description", res.get("snippet", ""))
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
    
    def get_it_news(self, limit: int = 5) -> List[Dict]:
        """IT 전문 RSS 피드에서 최신 뉴스 가져오기"""
        results = []
        for src, url in self.it_feeds.items():
            if len(results) >= limit:
                break
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries[:2]:
                    title = entry.get("title", "").strip()
                    link = entry.get("link", "")
                    summary = entry.get("summary", "")
                    # HTML 태그 제거
                    import re
                    summary = re.sub(r'<[^>]+>', '', summary)[:150].strip()
                    published = entry.get("published", "")
                    if title:
                        results.append({
                            "source": src,
                            "title": title,
                            "link": link,
                            "published": published,
                            "summary": summary,
                        })
                    if len(results) >= limit:
                        break
            except Exception as e:
                logger.error(f"IT RSS fetch error {src}: {e}")
                continue
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

    def get_tool_definition(self) -> dict:
        return {
            "name": "news_search",
            "description": "최신 뉴스를 검색합니다. 뉴스, 시사, 최신 이슈 등 뉴스 관련 정보가 필요할 때 사용하세요.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "검색할 뉴스 키워드"
                    },
                    "locale": {
                        "type": "string",
                        "description": "지역 코드 (us=미국, kr=한국, gb=영국 등)",
                        "enum": ["us", "kr", "gb", "ca", "au"]
                    }
                },
                "required": ["query"]
            }
        }

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "news_search":
            query = args.get("query")
            locale = args.get("locale", "kr")
            results = self.search_news(query, locale=locale)
            if isinstance(results, list):
                return {"data": results}
            return results
        return {"error": "Unknown tool"}
