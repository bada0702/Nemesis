"""
YouTube 검색 스킬 — DuckDuckGo를 통한 YouTube 영상 검색 (API 키 불필요)
"""
import re
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)


class YouTubeSkill:
    """DuckDuckGo site:youtube.com 검색으로 YouTube 영상 정보를 가져옵니다."""

    def search_videos(self, query: str, max_results: int = 5) -> List[Dict]:
        """YouTube 영상 검색 — 실제 DuckDuckGo 검색 사용"""
        try:
            try:
                from ddgs import DDGS  # 최신 패키지명
            except ImportError:
                from duckduckgo_search import DDGS  # 구 패키지명 fallback
            results = []
            with DDGS() as ddgs:
                raw = list(ddgs.text(
                    f"site:youtube.com {query}",
                    max_results=max_results * 2
                ))
            for r in raw:
                url = r.get("href", "")
                # watch URL만 포함
                if "youtube.com/watch" in url or "youtu.be/" in url:
                    title = r.get("title", "").replace(" - YouTube", "").strip()
                    desc = re.sub(r"\s+", " ", r.get("body", ""))[:200]
                    results.append({
                        "title": title,
                        "url": url,
                        "description": desc,
                    })
                    if len(results) >= max_results:
                        break
            return results
        except Exception as e:
            logger.error(f"YouTubeSkill search error: {e}")
            return []

    def format_results(self, query: str, results: List[Dict]) -> str:
        if not results:
            return f"❌ '{query}' YouTube 검색 결과가 없습니다."
        lines = [f"🎥 **YouTube 검색: {query}**\n"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. **{r['title']}**")
            if r.get("description"):
                lines.append(f"   {r['description'][:120]}")
            lines.append(f"   🔗 {r['url']}")
        return "\n".join(lines)

    def get_tool_definitions(self) -> List[Dict]:
        return [{
            "name": "search_youtube",
            "description": "YouTube에서 영상을 실제로 검색하여 제목·설명·링크를 반환합니다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "검색어 (예: '아이유 좋은날', 'Python 튜토리얼')"},
                    "max_results": {"type": "integer", "description": "최대 결과 수 (기본 5)", "default": 5},
                },
                "required": ["query"],
            },
        }]

    def execute_tool(self, tool_name: str, args: Dict) -> str:
        if tool_name == "search_youtube":
            query = args.get("query", "")
            max_r = int(args.get("max_results", 5))
            results = self.search_videos(query, max_r)
            return self.format_results(query, results)
        return f"❌ 알 수 없는 도구: {tool_name}"
