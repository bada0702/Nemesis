from .base import (
    BaseProvider, MockFunctionCall, MockPart, 
    MockContent, MockCandidate, MockResponse, MockFunctionResponse
)
import requests
import json
import logging
import re
import time
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path
from ollama_tool_wrapper import OllamaToolWrapper

logger = logging.getLogger(__name__)

class OpenRouterProvider(BaseProvider):
    """
    Provider for OpenRouter (OpenAI-compatible) with reasoning support.
    """
    
    def __init__(self, api_key: str, model_name: str, base_url: str = "https://openrouter.ai/api/v1", **kwargs):
        super().__init__(**kwargs)
        self.api_key = api_key
        self.model_name = model_name
        self.base_url = base_url
        
        # Initialize OllamaToolWrapper (reused for compatibility/formatting)
        if self.tool_manager:
            tm = self.tool_manager
            # Access skills from SkillsManager if available
            search_skill = tm.skills_manager.search if tm.skills_manager else None
            system_skill = tm.skills_manager.system if tm.skills_manager else None
            stock_rec_skill = tm.skills_manager.stock_recommendation if tm.skills_manager else None
            gmail_skill = tm.skills_manager.gmail if tm.skills_manager else None
            project_skill = tm.skills_manager.project if tm.skills_manager else None
            
            self.ollama_tool_wrapper = OllamaToolWrapper(
                search_skill=search_skill,
                mcp_server=tm.mcp_server,
                weather_client=tm.weather_client,
                cron_scheduler=tm.cron_scheduler,
                stock_client=tm.stock_client,
                news_client=tm.news_client,
                calendar_client=tm.calendar_client,
                currency_client=getattr(tm.skills_manager, 'currency', None) if tm.skills_manager else None,
                crypto_client=getattr(tm.skills_manager, 'crypto', None) if tm.skills_manager else None,
                system_skill=system_skill,
                stock_recommendation_skill=stock_rec_skill,
                reminder_manager=tm.reminder_manager,
                gmail_skill=gmail_skill,
                project_skill=project_skill  # 프로젝트 스킬 연결
            )
        else:
            self.ollama_tool_wrapper = None
            
        # Load tool guide (using Ollama tool guide as base for consistent tool usage instructions)
        self.tool_guide = ""
        try:
            guide_path = Path(__file__).parent.parent / "data" / "ollama_tool_guide.md"
            if guide_path.exists():
                with open(guide_path, 'r', encoding='utf-8') as f:
                    self.tool_guide = f.read()
        except Exception as e:
            logger.warning(f"Failed to load tool guide: {e}")

    def generate_content_step(self, user_id: int, system_instruction: str, chat_id: Optional[int] = None) -> MockResponse:
        """Unified interface for Agent loop - handles single API turn"""
        history = self.get_chat_history(user_id)
        
        # 1. Add system instructions (RAG + Tool Guide)
        messages_with_context = []
        if self.memory_manager:
            memory_context = self.memory_manager.get_memory_context()
            if memory_context:
                messages_with_context.append({
                    "role": "system",
                    "content": f"다음은 너의 **장기 기억(Long-term Memory)**이다.\n\n{memory_context}"
                })
        
        # Add basic system instruction provided by Agent
        messages_with_context.append({"role": "system", "content": system_instruction})
        
        # Add tool guide if available
        if self.tool_guide:
             messages_with_context.append({"role": "system", "content": self.tool_guide})

        # 2. History Conversion: MockContent -> dict for API
        converted_history = []
        for item in history:
            if isinstance(item, dict):
                converted_history.append(item)
            elif hasattr(item, 'role') and hasattr(item, 'parts'):
                text = ""
                for p in item.parts:
                    if hasattr(p, 'text') and p.text:
                        text += p.text
                    elif hasattr(p, 'function_call') and p.function_call:
                        fc = p.function_call
                        fc_dict = {"tool": fc.name, **fc.args}
                        text += f"\n```json\n{json.dumps(fc_dict, ensure_ascii=False)}\n```\n"
                    elif hasattr(p, 'function_response') and p.function_response:
                        text += f"\n[도구 결과: {p.function_response.name}]\n{p.function_response.response}"
                role = "user" if item.role == "user" else "assistant"
                if text:
                    converted_history.append({"role": role, "content": text})

        # History Truncation (consistent with Ollama)
        current_turn_messages = messages_with_context + converted_history[-10:]
        
        # 3. API Payload
        payload = {
            "model": self.model_name,
            "messages": current_turn_messages,
            "stream": False,
            "temperature": 0.3 # Lower temperature for tool calls
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://github.com/Gamma-410/vibro", 
            "X-Title": "Vibro AI Bot"
        }
        
        try:
            logger.info(f"OpenRouter Turn Injection ({self.model_name})...")
            # If base_url already contains /chat/completions, use as-is; otherwise append it
            if "/chat/completions" in self.base_url:
                api_url = self.base_url
            else:
                api_url = self.base_url.rstrip('/') + "/chat/completions"
            response = requests.post(api_url, json=payload, headers=headers, timeout=60)
            
            if response.status_code == 200:
                data = response.json()
                choice = data.get("choices", [{}])[0]
                message_obj = choice.get("message", {})
                content = message_obj.get("content", "")
                
                # Convert content to MockResponse parts
                parts = []
                if content:
                    # Extract Tool Calls (JSON)
                    tool_calls = self._extract_json_objects(content)
                    
                    clean_text = content
                    for tc in tool_calls:
                        clean_text = clean_text.replace(tc["raw_block"], "").strip()
                        obj = tc["obj"]
                        name = obj.get("tool")
                        args = {k: v for k, v in obj.items() if k != 'tool'}
                        parts.append(MockPart(function_call=MockFunctionCall(name=name, args=args)))
                    
                    clean_text = re.sub(r'\[Call Tool:.*?\]', "", clean_text, flags=re.IGNORECASE)
                    clean_text = re.sub(r'\[Tool (Result|Output):.*?\]', "", clean_text, flags=re.IGNORECASE)
                    
                    if clean_text:
                        parts.insert(0, MockPart(text=clean_text))
                    elif not parts:
                        parts.append(MockPart(text=""))
                
                # Create standard response
                res_content = MockContent(role="assistant", parts=parts)
                res = MockResponse(text=content, candidates=[MockCandidate(content=res_content)])
                return res
            else:
                logger.error(f"OpenRouter API error: {response.text}")
                return MockResponse(text=f"Error: {response.status_code}", candidates=[])
        except Exception as e:
            logger.error(f"OpenRouter request error: {e}")
            return MockResponse(text=f"Error: {str(e)}", candidates=[])

    def generate_response(self, user_id: int, message: str, chat_id: Optional[int] = None) -> str:
        """Original generate_response (should be replaced by Agent.run in handlers)"""
        # For compatibility if still called somewhere
        # We can implement it using the new Agent flow or keep the old one.
        # But wait, we want to fix the error. The error happens when Agent.run is called.
        # So providing generate_content_step is the priority.
        
        # Let's keep the existing logic here but ensure it doesn't conflict.
        # Actually, if Agent.run is used, this logic is bypassed.
        return self._old_generate_response(user_id, message, chat_id)

    def _old_generate_response(self, user_id: int, message: str, chat_id: Optional[int] = None) -> str:
        # Same as previous implementation
        if chat_id is None:
            chat_id = user_id

        history = self.get_chat_history(user_id)
        # ... (keep existing implementation for backward compatibility)
        # Actually, let's just make it call Agent.run?
        # No, Agent.run requires the provider instance.
        # The best way is to let bot.py use Agent.
        return "Please use Agent.run()"



    def _extract_json_objects(self, text):
        """Extract all valid JSON objects containing a 'tool', 'action', or 'name' key from text."""
        results = []
        for start_match in re.finditer(r'\{', text):
            start_pos = start_match.start()
            brace_count = 0
            for end_pos in range(start_pos, len(text)):
                if text[end_pos] == '{': brace_count += 1
                elif text[end_pos] == '}': brace_count -= 1
                if brace_count == 0:
                    candidate = text[start_pos:end_pos+1]
                    try:
                        if '"tool":' in candidate or '"action":' in candidate or '"name":' in candidate:
                            obj = json.loads(candidate)
                            if isinstance(obj, dict) and ('tool' in obj or 'action' in obj or 'name' in obj):
                                if 'action' in obj and 'tool' not in obj:
                                    obj['tool'] = obj.pop('action')
                                if 'name' in obj and 'tool' not in obj:
                                    obj['tool'] = obj.pop('name')
                                    
                                for nested_key in ['parameters', 'params', 'arguments', 'args']:
                                    if nested_key in obj and isinstance(obj[nested_key], dict):
                                        nested_data = obj.pop(nested_key)
                                        for k, v in nested_data.items():
                                            if k != 'tool':
                                                obj[k] = v

                                full_block_start = start_pos
                                full_block_end = end_pos + 1
                                prefix = text[max(0, start_pos-10):start_pos].lower()
                                suffix = text[end_pos+1:end_pos+11].lower()
                                if "```json" in prefix: full_block_start = text.rfind("```json", 0, start_pos)
                                elif "```" in prefix: full_block_start = text.rfind("```", 0, start_pos)
                                if "```" in suffix: full_block_end = text.find("```", end_pos+1) + 3
                                results.append({"obj": obj, "raw_block": text[full_block_start:full_block_end]})
                    except: pass
                    break
        return results

    def _is_valid_response(self, text: str, has_tool_calls: bool) -> bool:
        if has_tool_calls: return True
        if not text or len(text.strip()) < 5: return False
        thinking_patterns = [
            r"잠시만 기다려", r"조회해 드릴게요", r"확인해 보겠습니다",
            r"찾아보겠습니다", r"검색해 드릴게요", r"일정을 확인",
            r"wait a moment", r"let me check", r"let me look up", r"searching for"
        ]
        text_lower = text.lower()
        for pattern in thinking_patterns:
            if re.search(pattern, text_lower):
                if len(text.strip()) < 100: return False
        return True

    def _parse_and_apply_patches(self, text: str) -> str:
        if not self.memory_manager: return text
        def find_memory_patches(t):
            results = []
            for start_match in re.finditer(r'\{', t):
                start_pos = start_match.start()
                brace_count = 0
                for end_pos in range(start_pos, len(t)):
                    if t[end_pos] == '{': brace_count += 1
                    elif t[end_pos] == '}': brace_count -= 1
                    if brace_count == 0:
                        candidate = t[start_pos:end_pos+1]
                        try:
                            if '"file":' in candidate and '"memory/' in candidate:
                                patch = json.loads(candidate)
                                if all(k in patch for k in ["file", "action", "new"]):
                                    results.append(patch)
                        except: pass
                        break
            return results
        patches = find_memory_patches(text)
        for patch in patches:
            self.memory_manager.apply_json_patch(patch)
        return text

    def _process_memory_updates(self, user_id: int, user_message: str, assistant_message: str):
        if not self.memory_manager: return
        try:
            updates = {'user_info': {}, 'facts': []}
            message_lower = user_message.lower()
            if '내 이름은' in message_lower:
                match = re.search(r'내 이름은 ([가-힣a-zA-Z]+)', user_message)
                if match: updates['user_info']['Name'] = match.group(1)

            # Detect AI Persona updates (User changing AI's name/role)
            ai_updates = {}
            if '이름' in message_lower:
                 match = re.search(r'(너의|네|내)?\s*이름(은)?\s*([가-힣a-zA-Z0-9_ ]+?)(이|가)?\s*(야|이다|로 해|으로 변경|\n|$)', user_message)
                 if match:
                     new_name = match.group(3).strip()
                     if new_name.endswith('이') or new_name.endswith('가'):
                         new_name = new_name[:-1]
                     ai_updates['Name'] = new_name

            if '너는' in message_lower and '충신' in message_lower:
                 ai_updates['Role'] = '조선시대 충신'
                 ai_updates['Tone'] = '극존칭 (전하, 하옵소서)'
            
            if ai_updates:
                self.memory_manager.update_soul(ai_updates)
            instruction_keywords = ['좋아해', '선호', '기억해', '기억해줘']
            if any(word in message_lower for word in instruction_keywords):
                updates['facts'].append(user_message)
            if updates.get('user_info'):
                self.memory_manager.update_user_profile(user_id, updates['user_info'])
            for fact in updates.get('facts', []):
                self.memory_manager.add_to_long_term_memory(fact, "User Preferences")
            self.memory_manager.save_daily_log(
                user_message=user_message,
                assistant_decision=assistant_message
            )
        except Exception as e:
            logger.error(f"Error processing memory updates: {e}")
