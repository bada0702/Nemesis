import requests
from bs4 import BeautifulSoup

class MedicalKnowledgeSkill:
    def execute_tool(self, tool_name, args):
        if tool_name == "get_medical_info":
            query = args.get("query")
            if not query:
                return "검색할 질병명이나 증상을 입력해주십시오."
            
            # 검색 쿼리 최적화 (신뢰도 높은 사이트 유도)
            search_query = f"{query} 원인 증상 치료법 가이드라인"
            url = f"https://www.google.com/search?q={search_query}"
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
            
            try:
                response = requests.get(url, headers=headers, timeout=10)
                if response.status_code != 200:
                    return "정보를 가져오는 중 오류가 발생하였사옵니다."
                
                soup = BeautifulSoup(response.text, 'html.parser')
                # 구글 검색 결과의 스니펫 및 주요 텍스트 추출
                snippets = soup.find_all('div', {'class': 'V7Sbe'}) # 구글 검색 결과 요약 클래스 (변경 가능성 있음)
                if not snippets:
                    snippets = soup.find_all('div', {'class': 'BNeawe'})
                
                results = [s.get_text() for s in snippets[:5]]
                
                if not results:
                    return f"'{query}'에 대한 구체적인 의학 정보를 찾지 못하였사옵니다. 전문의와 상담하시기를 권장하옵니다."
                
                summary = "\n\n".join(results)
                return f"【 {query} 에 대한 의학 정보 】\n\n{summary}\n\n※ 본 정보는 참고용이며, 반드시 전문의의 진단과 처방을 따르셔야 하옵니다."
            
            except Exception as e:
                return f"오류가 발생하였사옵니다: {str(e)}"

        return "존재하지 않는 도구이옵니다."

    def get_tool_definitions(self):
        return [
            {
                "name": "get_medical_info",
                "description": "질병명, 증상, 의학 용어에 대해 전문적인 정보를 검색하여 제공합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "검색할 의학 키워드 (예: 'PFIC', '간경화', '감기')"
                        }
                    },
                    "required": ["query"]
                }
            }
        ]
