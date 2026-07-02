from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
import logging

logger = logging.getLogger(__name__)

# Mock classes to mimic Google GenAI response structure for Agent compatibility
class MockFunctionCall:
    def __init__(self, name, args):
        self.name = name
        self.args = args

class MockFunctionResponse:
    def __init__(self, name, response):
        self.name = name
        self.response = response

class MockPart:
    def __init__(self, text=None, function_call=None, function_response=None):
        self.text = text
        self.function_call = function_call
        self.function_response = function_response

class MockContent:
    def __init__(self, role, parts):
        self.role = role
        self.parts = parts

class MockCandidate:
    def __init__(self, content):
        self.content = content

class MockResponse:
    def __init__(self, text, candidates):
        self.text = text
        self.candidates = candidates

class BaseProvider(ABC):
    """
    Abstract base class for AI providers.
    """
    
    def __init__(self, tool_manager=None, memory_manager=None, **kwargs):
        """
        Initialize the provider.
        
        Args:
            tool_manager: Manager for executing tools
            memory_manager: Manager for handling long-term memory
            **kwargs: Provider-specific configuration
        """
        self.tool_manager = tool_manager
        self.memory_manager = memory_manager
        self.max_history_messages = 10
        self.chat_sessions = {}
        
    def get_chat_history(self, user_id: int) -> List[Any]:
        """Get or create chat history for a user"""
        if user_id not in self.chat_sessions:
            self.chat_sessions[user_id] = []
        
        # Trim history
        if len(self.chat_sessions[user_id]) > self.max_history_messages:
            self.chat_sessions[user_id] = self.chat_sessions[user_id][-self.max_history_messages:]
            
        return self.chat_sessions[user_id]
        
    def clear_chat_session(self, user_id: int):
        """Clear chat session for a user"""
        if user_id in self.chat_sessions:
            del self.chat_sessions[user_id]
            logger.info(f"Cleared chat session for user {user_id}")

    @abstractmethod
    def generate_response(self, user_id: int, message: str, chat_id: Optional[int] = None) -> str:
        """
        Generate a response from the AI.
        
        Args:
            user_id: The ID of the user sending the message
            message: The user's message
            chat_id: Optional chat ID (e.g. Telegram chat ID)
            
        Returns:
            The AI's response text
        """
        pass

    @abstractmethod
    def generate_content_step(self, user_id: int, system_instruction: str, chat_id: Optional[int] = None) -> Any:
        """
        Generate a single step content for the Agent loop.
        
        Args:
            user_id: The ID of the user
            system_instruction: System prompt/instruction
            chat_id: Optional chat ID for context (e.g. sending notifications)
            
        Returns:
            Review object (MockResponse or similar) with text and function calls
        """
        pass
