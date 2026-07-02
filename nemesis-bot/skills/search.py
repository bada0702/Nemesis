
import logging
import requests
import re
from typing import List, Dict

logger = logging.getLogger(__name__)

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

    def get_tool_definition(self) -> dict:
        return {
            "name": "web_search",
            "description": "일반 웹 검색을 수행합니다. 최신 정보, 일반 상식 등 웹에서 검색이 필요할 때 사용하세요. (API 키 불필요)",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "검색할 키워드 또는 질문"
                    }
                },
                "required": ["query"]
            }
        }

    def execute_tool(self, tool_name: str, args: Dict) -> Dict:
        if tool_name == "web_search":
            return self.search(args.get("query"))
        return {"error": "Unknown tool"}
