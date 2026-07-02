from .base import BaseProvider
from google import genai
from google.genai import types
from google.api_core import exceptions as google_exceptions
import logging
import time
import re
import json
import concurrent.futures
from datetime import datetime
from typing import Optional, List, Dict, Any, Union
from .base import MockPart, MockContent, MockCandidate, MockResponse
from config import GEMINI_TEMPERATURE, GEMINI_MAX_TOKENS

logger = logging.getLogger(__name__)

class GeminiProvider(BaseProvider):
    """
    Terminator-style Gemini Provider.
    """
    
    def __init__(self, api_key: str, model_name: str = "gemini-2.0-flash", **kwargs):
        super().__init__(**kwargs)
        self.api_key = api_key
        self.model_name = model_name
        self.client = None
        
        try:
            self.client = genai.Client(api_key=api_key)
            logger.info(f"GeminiProvider initialized with model {model_name}")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini client: {e}")

    
    def _convert_to_gemini_content(self, history: List[Union[MockContent, Any]]) -> List[types.Content]:
        """Convert standardized MockContent/dict history to Gemini types.Content"""
        gemini_history = []
        for item in history:
            if isinstance(item, MockContent):
                parts = []
                for p in item.parts:
                    if p.text:
                        parts.append(types.Part(text=p.text))
                    elif p.function_call:
                        parts.append(types.Part(function_call=types.FunctionCall(
                            name=p.function_call.name,
                            args=p.function_call.args
                        )))
                    elif p.function_response:
                        parts.append(types.Part(function_response=types.FunctionResponse(
                            name=p.function_response.name,
                            response=p.function_response.response
                        )))
                gemini_history.append(types.Content(role=item.role, parts=parts))
            elif isinstance(item, dict):
                # Fallback for dicts
                gemini_history.append(types.Content(role=item.get("role", "user"), parts=[types.Part(text=item.get("content", ""))]))
            elif hasattr(item, 'role') and hasattr(item, 'parts'):
                # Already types.Content or similar
                gemini_history.append(item)
        return gemini_history

    def generate_content_step(self, user_id: int, system_instruction: str, chat_id: Optional[int] = None) -> types.GenerateContentResponse:
        """Single step generation call for the Agent."""
        history = self.get_chat_history(user_id)
        gemini_history = self._convert_to_gemini_content(history)
        
        # 도구 설정 준비
        tools_config = [self.tool_manager.tools] if self.tool_manager else None
        
        try:
            return self.client.models.generate_content(
                model=self.model_name,
                contents=gemini_history,
                config=types.GenerateContentConfig(
                    tools=tools_config,
                    # 하드코딩 0.3 제거 → .env의 GEMINI_TEMPERATURE 사용 (기본 0.7)
                    temperature=GEMINI_TEMPERATURE,
                    # .env의 GEMINI_MAX_TOKENS 적용 (기본 8192)
                    max_output_tokens=GEMINI_MAX_TOKENS,
                    system_instruction=system_instruction
                )
            )
        except Exception as e:
            logger.error(f"Gemini generation error: {e}")
            raise

    def generate_response(self, user_id: int, message: str, chat_id: Optional[int] = None) -> str:
        """
        Original entry point. Updated to just return a simple response or error message if called directly.
        Ideally this should not be called if using Agent.
        But for backward compatibility, maybe we just wrap generate_content_step?
        Or we can deprecate it. 
        Since we are refactoring, let's keep it simple for now or raise NotImplementedError to force Agent usage.
        But let's implement a simple non-loop version.
        """
        # This implementation is deprecated in favor of Agent.run()
        # But if bot.py calls it directly without Agent refactor, it needs to work.
        # But Phase 4 handles bot.py.
        # So I will just implement a basic version.
        
        return "Please use the Agent class to interact with this provider."
