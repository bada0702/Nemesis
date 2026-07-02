import subprocess

class ClaudeCodingSkill:
    def execute_tool(self, tool_name, args):
        if tool_name == "ask_claude_code":
            prompt = args.get("prompt")
            if not prompt:
                return "요청하실 코딩 내용을 알려주세요, 주인님! 🌸"
            
            try:
                # Claude CLI 명령어 실행 (설치된 명령어 이름이 'claude'라고 가정)
                # 실제 명령어 명칭에 따라 수정이 필요할 수 있습니다.
                result = subprocess.run(
                    ["claude", prompt], 
                    capture_output=True, 
                    text=True, 
                    timeout=60,
                    encoding='utf-8'
                )
                if result.returncode == 0:
                    return result.stdout
                else:
                    return f"Claude CLI 실행 중 오류가 발생했어요: {result.stderr}"
            except Exception as e:
                return f"앗, 오류가 났어요: {str(e)}"
        
        return "지원하지 않는 도구입니다."

    def get_tool_definitions(self):
        return [
            {
                "name": "ask_claude_code",
                "description": "Claude CLI를 통해 코딩 질문을 하고 답변을 받습니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {
                            "type": "string",
                            "description": "Claude에게 요청할 코딩 프롬프트 내용"
                        }
                    },
                    "required": ["prompt"]
                }
            }
        ]
