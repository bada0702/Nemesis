from .base import (
    BaseProvider, MockFunctionCall, MockPart, 
    MockContent, MockCandidate, MockResponse, MockFunctionResponse
)
import requests
import json
import logging
import re
import time
from typing import Optional
from pathlib import Path
from ollama_tool_wrapper import OllamaToolWrapper
from config import OLLAMA_TEMPERATURE

logger = logging.getLogger(__name__)

class OllamaProvider(BaseProvider):
    """
    Provider for Ollama (local LLM).
    """
    
    def __init__(self, base_url: str, model_name: str, api_key: str = None, **kwargs):
        super().__init__(**kwargs)
        self.base_url = base_url
        self.model_name = model_name
        self.api_key = api_key
        
        # Initialize OllamaToolWrapper
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
                project_skill=project_skill  # 프로젝트 스킬 연결 (핵심!)
            )
        else:
            self.ollama_tool_wrapper = None
            
        # Load tool guide
        self.ollama_tool_guide = ""
        try:
             # Assuming we are in providers/ollama.py, data is in ../data
             # But aibot.py was in c:/main/aibot/aibot.py
             # So data is in c:/main/aibot/data
            guide_path = Path(__file__).parent.parent / "data" / "ollama_tool_guide.md"
            if guide_path.exists():
                with open(guide_path, 'r', encoding='utf-8') as f:
                    self.ollama_tool_guide = f.read()
            else:
                logger.warning(f"Ollama tool guide not found at {guide_path}")
        except Exception as e:
            logger.warning(f"Failed to load Ollama tool guide: {e}")

    def generate_content_step(self, user_id: int, system_instruction: str, chat_id: Optional[int] = None) -> MockResponse:
        """
        Generate content step for Agent loop (mimics Google GenAI response)
        """
        # 1. Prepare Messages
        history = self.get_chat_history(user_id)
        
        # [NEW] Pre-execute tools via Wrapper (Keyword-based)
        # Ollama는 Function Calling이 약하므로, 키워드로 감지된 도구를 미리 실행하여 컨텍스트에 주입합니다.
        if self.ollama_tool_wrapper and history:
            try:
                # Find last user message
                last_user_text = ""
                for item in reversed(history):
                    role = getattr(item, 'role', '')
                    if role == 'user':
                        if hasattr(item, 'parts'):
                            # last_user_text = " ".join([p.text for p in item.parts if hasattr(p, 'text') and p.text])
                            # 단순 join보다 개행 유지
                            texts = [p.text for p in item.parts if hasattr(p, 'text') and p.text]
                            last_user_text = "\n".join(texts)
                            
                        elif isinstance(item, dict): # Fallback for dict history
                            last_user_text = item.get("content", "")
                        break
                
                if last_user_text:
                    # Execute tools (chat_id is now available!)
                    tool_result = self.ollama_tool_wrapper.detect_and_execute_tools(last_user_text, user_id=user_id, chat_id=chat_id)
                    
                    if tool_result:
                        tool_name = tool_result.get('tool')
                        logger.info(f"Ollama Wrapper executed tool: {tool_name}")
                        
                        # 시스템 지시사항인 경우 (예: 알림 설정 유도)
                        if tool_name == "system_instruction":
                             instruction = tool_result.get("results", {}).get("instruction", "")
                             system_instruction += f"\n\n{instruction}"
                        else:
                            # 일반 데이터 결과인 경우
                            formatted = self.ollama_tool_wrapper.format_tool_result(tool_result)
                            system_instruction += f"\n\n=== [실시간 데이터 (시스템 자동 제공)] ===\n{formatted}\n====================================\n위 실시간 데이터를 확인하고 답변에 활용하십시오."
            except Exception as e:
                logger.error(f"Error in Ollama tool wrapper execution: {e}")

        ollama_messages = []
        
        # System instruction
        if system_instruction:
            ollama_messages.append({"role": "system", "content": system_instruction})
            
        # Add Tool Guide to system instruction
        if self.ollama_tool_guide:
             ollama_messages.append({"role": "system", "content": self.ollama_tool_guide})

        # history conversion loop
        for item in history:
            role = "user"
            if hasattr(item, 'role'):
                role = "user" if item.role == "user" else "assistant"
            
            text = ""
            if hasattr(item, 'parts') and item.parts:
                for part in item.parts:
                    if hasattr(part, 'text') and part.text:
                        text += part.text
                    if hasattr(part, 'function_call') and part.function_call:
                        fc = part.function_call
                        fc_dict = {"tool": fc.name, **fc.args}
                        text += f"\n```json\n{json.dumps(fc_dict, ensure_ascii=False)}\n```\n"
                    # Tool output - more natural format
                    if hasattr(part, 'function_response') and part.function_response:
                        text += f"\n[시스템: {part.function_response.name} 도구 호출 결과]\n{part.function_response.response}"
            
            if text:
                ollama_messages.append({"role": role, "content": text})
            elif isinstance(item, dict):
                ollama_messages.append(item)

        # Truncate history to avoid context overflow (keep last 10 turns + system prompts)
        # System instructions are at the beginning
        # Find index where user/assistant messages start
        other_messages = [m for m in ollama_messages if m["role"] != "system"]
        system_messages = [m for m in ollama_messages if m["role"] == "system"]
        
        if len(other_messages) > 10:
            logger.info(f"Truncating Ollama history from {len(other_messages)} to 10 messages.")
            other_messages = other_messages[-10:]
            
        final_messages = system_messages + other_messages

        # 2. Call Ollama
        payload = {
            "model": self.model_name,
            "messages": final_messages,
            "stream": False,
            "options": {
                "temperature": OLLAMA_TEMPERATURE
            }
        }
        
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            
        logger.info(f"Sending request to Ollama ({self.model_name}). Messages: {len(final_messages)}")
        start_time = time.time()
        try:
            response = requests.post(
                f"{self.base_url}/api/chat", 
                json=payload,
                headers=headers,
                timeout=180
            )
            duration = time.time() - start_time
            logger.info(f"Ollama response received in {duration:.2f}s (Status: {response.status_code})")
            
            if response.status_code != 200:
                raise Exception(f"Ollama HTTP {response.status_code}: {response.text}")
                
            data = response.json()
            content_text = data.get("message", {}).get("content", "")
            
            # 3. Parse Tool Calls (JSON and XML)
            tool_calls_found = self._extract_json_objects(content_text)
            
            # XML parsing fallback (More robust regex)
            xml_tools = self._extract_xml_tool_calls(content_text)
            if xml_tools:
                # Merge or prioritize? Usually model uses one format.
                if not tool_calls_found:
                    tool_calls_found = xml_tools
                else:
                    tool_calls_found.extend(xml_tools)

            parts = []
            
            # Remove JSON/XML blocks from text to get "clean text"
            clean_text = content_text
            for tc in tool_calls_found:
                clean_text = clean_text.replace(tc["raw_block"], "").strip()
                
                # Create FunctionCall part
                func_name = tc["obj"].get("tool")
                func_args = {k: v for k, v in tc["obj"].items() if k != "tool"}
                parts.append(MockPart(function_call=MockFunctionCall(func_name, func_args)))
            
            # Additional Cleaning for Ollama:
            # 1. Strip leading/trailing thinking dialogue if tools are present
            if tool_calls_found:
                # Remove common intro phrases like "잠시만 기다려", "조회해 보겠습니다" etc.
                thinking_phrases = [
                    r"잠시만\s*기다려\s*(주십시오|주세요|주시겠습니까|주시옵소서|주소서)?",
                    r"조회해\s*(보겠습니다|드리겠습니다|드릴게요|보겠나이다|주겠나이다)",
                    r"확인해\s*(보겠습니다|드리겠습니다|드릴게요|보겠나이다|주겠나이다)",
                    r"찾아보겠습니다", r"검색해\s*드릴게요", r"일정을\s*확인",
                    r"wait\s*a\s*moment", r"let\s*me\s*check", r"let\s*me\s*look\s*up", r"searching\s*for",
                    r"전하,\s*", r"주인님,\s*"
                ]
                for phrase in thinking_phrases:
                    clean_text = re.sub(phrase, "", clean_text, flags=re.IGNORECASE | re.DOTALL).strip()
                
                # If only punctuation remains, clear it
                if clean_text and all(c in ".,!? " for c in clean_text):
                    clean_text = ""

            # 2. Prevent Mimicry of Internal Markers
            # If the model tried to generate [Call Tool: ...] or [Tool Result: ...] itself, strip it.
            clean_text = re.sub(r'\[Call Tool:.*?\]', "", clean_text, flags=re.IGNORECASE)
            clean_text = re.sub(r'\[Tool (Result|Output):.*?\]', "", clean_text, flags=re.IGNORECASE)
            
            # 3. Fallback for empty text (to avoid Agent retry loop if possible)
            if not clean_text and not tool_calls_found:
                # If the model produced something but we stripped it all, and there's no tool...
                # This could happen if it only said "Thinking...". 
                # Let's keep a tiny bit of text or return a placeholder so Agent doesn't think it failed.
                if content_text.strip():
                    clean_text = "(결과를 분석 중입니다...)"
                else:
                    clean_text = ""

            clean_text = clean_text.strip()

            # Add text part if exists
            if clean_text:
                parts.insert(0, MockPart(text=clean_text))
                
            # If no text and no tools (empty), add empty text
            if not parts:
                parts.append(MockPart(text=""))
                
            # 4. Wrap in Mock Response
            return MockResponse(
                text=clean_text,
                candidates=[MockCandidate(content=MockContent(role="assistant", parts=parts))]
            )
            
        except Exception as e:
            logger.error(f"Error in generate_content_step: {e}")
            raise

    def _extract_xml_tool_calls(self, text):
        """
        Extract tool calls from XML format with more robustness:
        <function_calls>
        <invoke name="tool_name">
        <parameter name="param_name">value</parameter>
        </invoke>
        </function_calls>
        """
        results = []
        # Find all function_calls blocks (in case there are multiple)
        for block_match in re.finditer(r'<function_calls>(.*?)</function_calls>', text, re.DOTALL | re.IGNORECASE):
            full_block = block_match.group(0)
            inner_content = block_match.group(1)
            
            # Find all invokes
            for invoke_match in re.finditer(r'<invoke\s+name=["\'](.*?)["\']\s*>(.*?)</invoke>', inner_content, re.DOTALL | re.IGNORECASE):
                tool_name = invoke_match.group(1)
                params_content = invoke_match.group(2)
                
                args = {}
                for param_match in re.finditer(r'<parameter\s+name=["\'](.*?)["\']\s*>(.*?)</parameter>', params_content, re.DOTALL | re.IGNORECASE):
                    param_name = param_match.group(1)
                    param_value = param_match.group(2).strip()
                    args[param_name] = param_value
                
                # Construct object structure compatible with JSON extraction
                obj = {"tool": tool_name.strip(), **args}
                results.append({"obj": obj, "raw_block": full_block})

        return results

    def _extract_json_objects(self, text):
        """Extract all valid JSON objects containing a 'tool', 'action', or 'name' key from text."""
        results = []
        for start_match in re.finditer(r'\{', text):
            start_pos = start_match.start()
            brace_count = 0
            for end_pos in range(start_pos, len(text)):
                if text[end_pos] == '{':
                    brace_count += 1
                elif text[end_pos] == '}':
                    brace_count -= 1
                if brace_count == 0:
                    candidate = text[start_pos:end_pos+1]
                    try:
                        # Support both "tool" (original), "action", and "name"
                        if '"tool":' in candidate or '"action":' in candidate or '"name":' in candidate:
                            obj = json.loads(candidate)
                            if isinstance(obj, dict) and ('tool' in obj or 'action' in obj or 'name' in obj):
                                # Normalize "action" or "name" to "tool" for internal use
                                if 'action' in obj and 'tool' not in obj:
                                    obj['tool'] = obj.pop('action')
                                if 'name' in obj and 'tool' not in obj:
                                    obj['tool'] = obj.pop('name')
                                    
                                # Flatten nested parameters/params if they exist
                                for nested_key in ['parameters', 'params', 'arguments', 'args']:
                                    if nested_key in obj and isinstance(obj[nested_key], dict):
                                        nested_data = obj.pop(nested_key)
                                        for k, v in nested_data.items():
                                            if k != 'tool': # Don't overwrite tool name if exists in nested
                                                obj[k] = v
                                    
                                full_block_start = start_pos
                                full_block_end = end_pos + 1
                                prefix = text[max(0, start_pos-10):start_pos].lower()
                                suffix = text[end_pos+1:end_pos+11].lower()
                                if "```json" in prefix:
                                    full_block_start = text.rfind("```json", 0, start_pos)
                                elif "```" in prefix:
                                    full_block_start = text.rfind("```", 0, start_pos)
                                if "```" in suffix:
                                    full_block_end = text.find("```", end_pos+1) + 3
                                results.append({"obj": obj, "raw_block": text[full_block_start:full_block_end]})
                    except: pass
                    break
        return results

    def generate_response(self, user_id: int, message: str, chat_id: Optional[int] = None) -> str:
        """
        Fallback implementation for potential direct calls.
        Uses the Agent internally to maintain consistency.
        """
        # This is for backward compatibility if any legacy code calls this.
        # But Agent should be the main entry point now.
        if hasattr(self, 'agent') and self.agent:
            return self.agent.run(user_id, message, chat_id)
        
        # Self-contained minimal loop if agent not available
        logger.warning("generate_response called but Agent not prepared. Falling back to simple call.")
        resp = self.generate_content_step(user_id, "")
        return resp.text

    def _is_valid_response(self, text: str, has_tool_calls: bool) -> bool:
        if has_tool_calls: return True
        if not text or len(text.strip()) < 5: return False
        thinking_patterns = [
            r"잠시만 기다려", r"조회해 드릴게요", r"확인해 보겠습니다",
            r"찾아보겠습니다", r"검색해 드릴게요", r"일정을 확인",
            r"등록하여 드리겠", r"추가하여 드리겠", r"처리하여 드리겠",
            r"바로 등록", r"바로 추가", r"바로 처리", r"즉시 등록", r"즉시 추가",
            r"하겠나이다", r"드리겠나이다", r"하겠습니다$", r"드리겠습니다$",
            r"wait a moment", r"let me check", r"let me look up", r"searching for"
        ]
        stripped = text.strip()
        for pattern in thinking_patterns:
            if re.search(pattern, stripped, re.IGNORECASE):
                if len(stripped) < 150: return False
        return True

    def _parse_and_apply_patches(self, text: str) -> str:
        """Parse JSON patches and apply them. Returns modified text if needed (not implemented here, matches Gemini behavior)"""
        # Reusing the logic from GeminiProvider, but here we just apply side effects.
        if not self.memory_manager: return text
        
        def find_memory_patches(t):
            results = []
            for start_match in re.finditer(r'\{', t):
                start_pos = start_match.start()
                brace_count = 0
                for end_pos in range(start_pos, len(t)):
                    if t[end_pos] == '{':
                        brace_count += 1
                    elif t[end_pos] == '}':
                        brace_count -= 1
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
            # Simple extraction logic (duplicated from aibot.py)
            updates = {'user_info': {}, 'facts': []}
            message_lower = user_message.lower()
            
            if '내 이름은' in message_lower:
                match = re.search(r'내 이름은 ([가-힣a-zA-Z]+)', user_message)
                if match: updates['user_info']['Name'] = match.group(1)
            
            # Detect AI Persona updates (User changing AI's name/role)
            # "너의 이름은 ~다", "너는 ~다"
            ai_updates = {}
            # Detect AI Persona updates (User changing AI's name/role)
            # "너의 이름은 ~다", "너는 ~다", "네 이름 알버트"
            ai_updates = {}
            if '이름' in message_lower:
                # Regex improvements:
                # 1. (너의|네|내) -> optional
                # 2. 이름(은)? -> particle optional
                # 3. Value capturing
                match = re.search(r'(너의|네|내)?\s*이름(은)?\s*([가-힣a-zA-Z0-9_ ]+?)(이|가)?\s*(야|이다|로 해|으로 변경|\n|$)', user_message)
                if match:
                    new_name = match.group(2).strip()
                    # Filter out trailing particles if regex didn't catch them
                    if new_name.endswith('이') or new_name.endswith('가'):
                        new_name = new_name[:-1]
                    ai_updates['Name'] = new_name

            if '너는' in message_lower and ('충신' in message_lower or '비서' in message_lower or '친구' in message_lower):
                 # Simple heuristic for role adoption
                 if '충신' in message_lower:
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
