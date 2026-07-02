import os
import logging
import asyncio
from typing import Optional, List, Dict, Any, Union
from dotenv import load_dotenv

# Import Config
import config
from config import (
    AI_PROVIDER,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    GEMINI_MODEL,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    OPENROUTER_BASE_URL,
    OPENROUTER_MODEL
)

# Import Components
from skills import SkillsManager
from memory_manager import MemoryManager
from tool_manager import ToolManager

# Import Providers
from providers.gemini import GeminiProvider
from providers.ollama import OllamaProvider
from providers.openrouter import OpenRouterProvider

# Configure logging
logger = logging.getLogger(__name__)

class AIBot:
    """
    Main AI Orchestrator.
    Wrapper class to maintain backward compatibility while delegating to specific providers.
    """
    
    def __init__(self, api_key: str = None, news_api_token: str = None, 
                 stock_api_key: str = None, weather_api_key: str = None,
                 calendar_client=None, reminder_manager=None, mcp_server=None):
        
        # Load environment variables
        load_dotenv()
        
        this_api_key = api_key or config.get_gemini_api_key()
        
        # Initialize Managers
        self.memory_manager = MemoryManager(base_dir=config.BASE_DIR / "memory")
        self.skills_manager = SkillsManager()
        
        # Tool Manager initialization
        self.tool_manager = ToolManager(
            skills_manager=self.skills_manager,
            memory_manager=self.memory_manager,
            reminder_manager=reminder_manager,
            weather_client=getattr(self.skills_manager, 'weather', None), # In case SkillsManager wraps it differently
            stock_client=getattr(self.skills_manager, 'stock', None),
            news_client=getattr(self.skills_manager, 'news', None),
            calendar_client=calendar_client,
            mcp_server=mcp_server
        )
        
        # Cron Scheduler placeholder (will be set by bot.py)
        self._cron_scheduler = None
        
        # Initialize Provider based on Config
        self.provider_name = config.AI_PROVIDER.lower()
        self.provider = None
        
        logger.info(f"Initializing AI with provider: {self.provider_name}")
        
        try:
            if self.provider_name == "gemini":
                self.provider = GeminiProvider(
                    api_key=this_api_key,
                    model_name=GEMINI_MODEL,
                    tool_manager=self.tool_manager,
                    memory_manager=self.memory_manager
                )
            elif self.provider_name == "ollama":
                self.provider = OllamaProvider(
                    base_url=OLLAMA_BASE_URL,
                    model_name=OLLAMA_MODEL,
                    api_key=config.get_ollama_api_key(), 
                    tool_manager=self.tool_manager,
                    memory_manager=self.memory_manager
                )
            elif self.provider_name == "openai":
                # Using OpenRouterProvider for OpenAI compatible API too for now or map it
                # If specifically OpenAI is needed differently, we can add OpenAIProvider
                # For now using OpenRouterProvider logic which is generic openai compatible
                self.provider = OpenRouterProvider(
                    api_key=config.get_openai_api_key(),
                    model_name=OPENAI_MODEL,
                    base_url=OPENAI_BASE_URL,
                    tool_manager=self.tool_manager,
                    memory_manager=self.memory_manager
                )
            elif self.provider_name == "openrouter":
                self.provider = OpenRouterProvider(
                    api_key=config.get_openrouter_api_key(),
                    model_name=OPENROUTER_MODEL,
                    base_url=OPENROUTER_BASE_URL,
                    tool_manager=self.tool_manager,
                    memory_manager=self.memory_manager
                )
            else:
                logger.error(f"Unknown provider: {self.provider_name}. Defaulting to Gemini.")
                self.provider = GeminiProvider(
                    api_key=this_api_key,
                    model_name=GEMINI_MODEL,
                    tool_manager=self.tool_manager,
                    memory_manager=self.memory_manager
                )
        except Exception as e:
            logger.error(f"Failed to initialize provider {self.provider_name}: {e}")
            # Fallback or raise?
            raise e

        # Initialize Fallback Provider (if configured)
        self.fallback_provider_name = config.AI_FALLBACK_PROVIDER.lower()
        self.fallback_provider = None
        
        if self.fallback_provider_name and self.fallback_provider_name != self.provider_name:
            logger.info(f"Initializing Fallback AI provider: {self.fallback_provider_name}")
            try:
                if self.fallback_provider_name == "gemini":
                    self.fallback_provider = GeminiProvider(
                        api_key=config.get_gemini_api_key(),
                        model_name=GEMINI_MODEL,
                        tool_manager=self.tool_manager,
                        memory_manager=self.memory_manager
                    )
                elif self.fallback_provider_name == "ollama":
                    self.fallback_provider = OllamaProvider(
                        base_url=OLLAMA_BASE_URL,
                        model_name=OLLAMA_MODEL,
                        api_key=config.get_ollama_api_key(), 
                        tool_manager=self.tool_manager,
                        memory_manager=self.memory_manager
                    )
                elif self.fallback_provider_name == "openrouter":
                    self.fallback_provider = OpenRouterProvider(
                        api_key=config.get_openrouter_api_key(),
                        model_name=OPENROUTER_MODEL,
                        base_url=OPENROUTER_BASE_URL,
                        tool_manager=self.tool_manager,
                        memory_manager=self.memory_manager
                    )
            except Exception as e:
                logger.error(f"Failed to initialize fallback provider {self.fallback_provider_name}: {e}")

    @property
    def cron_scheduler(self):
        return self._cron_scheduler
        
    @cron_scheduler.setter
    def cron_scheduler(self, value):
        self._cron_scheduler = value
        # Propagate to ToolManager and REFRESH tools
        self.tool_manager.cron_scheduler = value
        self.tool_manager.refresh_tools()
        # Propagate to Provider's tool wrapper if it has one (Ollama/OpenRouter)
        if hasattr(self.provider, 'ollama_tool_wrapper') and self.provider.ollama_tool_wrapper:
             self.provider.ollama_tool_wrapper.cron_scheduler = value
             
    @property
    def ollama_tool_wrapper(self):
        # Backward compatibility for bot.py checking hasattr
        return getattr(self.provider, 'ollama_tool_wrapper', None)

    async def generate_response(self, user_id: int, message: str, chat_id: Optional[int] = None) -> str:
        """
        Generate response using the selected provider.
        """
        if not self.provider:
            return "AI Provider initialization failed."
            
        # Ensure provider has the latest cron_scheduler if it wasn't set during init
        # (Already handled via setter used by bot.py, but good to be safe)
        
        # Async check: providers currently implement synchronous generate_response (except in legacy aibot)
        # But `bot.py` awaits it. So we should run it in executor if it's blocking, or make providers async.
        # My implementations of providers are synchronous (using `requests` or `genai`).
        # `genai` can be async but I used sync client.
        # So I should wrap in `run_in_executor` to avoid blocking event loop.
        
        loop = asyncio.get_running_loop()
        
        try:
            return await loop.run_in_executor(None, self.provider.generate_response, user_id, message, chat_id)
        except Exception as e:
            logger.error(f"Primary provider ({self.provider_name}) failed: {e}")
            
            if self.fallback_provider:
                logger.info(f"Attempting fallback to {self.fallback_provider_name}...")
                try:
                    # Fallback provider needs to know about the tool wrapper updates if any? 
                    # They share the same tool_manager, which is good.
                    return await loop.run_in_executor(None, self.fallback_provider.generate_response, user_id, message, chat_id)
                except Exception as fallback_error:
                    logger.error(f"Fallback provider ({self.fallback_provider_name}) also failed: {fallback_error}")
                    return f"죄송합니다. AI 서비스에 일시적인 장애가 발생했습니다. (1차: {str(e)}, 2차: {str(fallback_error)})"
            else:
                return f"죄송합니다. 처리 중 오류가 발생했습니다: {str(e)}"

    def clear_chat_session(self, user_id: int):
        if self.provider:
            self.provider.clear_chat_session(user_id)

    def _execute_tool(self, fc, user_id, chat_id):
        """
        Expose internal tool execution for testing/compatibility.
        fc: object with name and args attributes
        """
        return self.tool_manager.execute_tool(fc.name, fc.args, user_id, chat_id)
