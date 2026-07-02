"""
Configuration management for aibot
Loads API keys and settings from .env file
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory
BASE_DIR = Path(__file__).resolve().parent

# Load environment variables from .env file with absolute path
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(ENV_PATH, override=True)
else:
    print(f"WARNING: .env file not found at {ENV_PATH}")

# Database and storage
DATA_DIR = BASE_DIR / "data"
REMINDERS_DB = DATA_DIR / "reminders.json"
USER_CONTEXT_DB = DATA_DIR / "user_context.json"

# AI Provider Access
AI_PROVIDER = os.getenv("AI_PROVIDER", "ollama").strip()
AI_FALLBACK_PROVIDER = os.getenv("AI_FALLBACK_PROVIDER", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "qwen2.5:0.5b").strip()
AGENT_MAX_TURNS = int(os.getenv("AGENT_MAX_TURNS", "10").strip())
# 도구 결과 최대 문자수 (오픈클로드는 제한없음, 여기서는 15000)
TOOL_RESULT_MAX_CHARS = int(os.getenv("TOOL_RESULT_MAX_CHARS", "15000").strip())
# RAG 검색 청크 수 (벡터 검색 임시: 5로 증가)
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "5").strip())
# 영속 대화이력 저장 디렉토리
CHAT_HISTORY_DIR = BASE_DIR / os.getenv("CHAT_HISTORY_DIR", "data/chat_history")

# Gemini settings
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "0.7"))
GEMINI_MAX_TOKENS = int(os.getenv("GEMINI_MAX_TOKENS", "2048"))

# Ollama settings
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:31b-cloud")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_TEMPERATURE = float(os.getenv("OLLAMA_TEMPERATURE", "0.7"))

# OpenAI settings
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")


# Removed BRAVE_SEARCH_COUNT


# OpenRouter settings
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemma-4-31b-it:free")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

def get_together_api_key():
    return os.getenv("TOGETHER_API_KEY", "")

def get_openrouter_api_key():
    return os.getenv("OPENROUTER_API_KEY", "")

# Skills settings
SKILLS_CONFIG = {
    "weather": os.getenv("SKILL_WEATHER_ENABLED", "True").lower() == "true",
    "news": os.getenv("SKILL_NEWS_ENABLED", "True").lower() == "true",
    "stock": os.getenv("SKILL_STOCK_ENABLED", "True").lower() == "true",
    "currency": os.getenv("SKILL_CURRENCY_ENABLED", "True").lower() == "true",
    "file": os.getenv("SKILL_FILE_ENABLED", "True").lower() == "true",
    "ftp": os.getenv("SKILL_FTP_ENABLED", "True").lower() == "true",
    "system": os.getenv("SKILL_SYSTEM_ENABLED", "True").lower() == "true",
    "note": os.getenv("SKILL_NOTE_ENABLED", "True").lower() == "true",
    "task": os.getenv("SKILL_TASK_ENABLED", "True").lower() == "true",
    "server": os.getenv("SKILL_SERVER_ENABLED", "True").lower() == "true",
    "stock_recommendation": os.getenv("SKILL_STOCK_RECOMMENDATION_ENABLED", "True").lower() == "true",
    "gmail": os.getenv("SKILL_GMAIL_ENABLED", "True").lower() == "true",
    "crypto": os.getenv("SKILL_CRYPTO_ENABLED", "True").lower() == "true",
    "project": os.getenv("SKILL_PROJECT_ENABLED", "True").lower() == "true",
}

# Telegram settings
TELEGRAM_TIMEOUT = int(os.getenv("TELEGRAM_TIMEOUT", "30"))
TELEGRAM_POOL_TIMEOUT = int(os.getenv("TELEGRAM_POOL_TIMEOUT", "30"))
ALLOWED_USER_ID = os.getenv("ALLOWED_USER_ID", "").strip()
# 허용목록(ALLOWED_USER_ID)이 비어 있을 때의 동작.
# 기본 False = 아무도 허용하지 않음(fail-closed). 명시적으로 "true"로 둘 때만 전체 개방.
FAIL_OPEN_IF_NO_ALLOWLIST = os.getenv("FAIL_OPEN_IF_NO_ALLOWLIST", "false").lower() == "true"


def get_gemini_api_key() -> str:
    """Get Gemini API key from environment"""
    key = os.getenv("GEMINI_API_KEY", "")
    if not key and AI_PROVIDER == "gemini":
        raise ValueError("GEMINI_API_KEY not found in .env file")
    return key


def get_telegram_token() -> str:
    """Get Telegram bot token from environment"""
    token = os.getenv("TELEGRAM_TOKEN", "")
    if not token:
        raise ValueError("TELEGRAM_TOKEN not found in .env file")
    return token


# Removed get_brave_api_key


def get_openweathermap_api_key() -> str:
    """Get OpenWeatherMap API key from environment"""
    key = os.getenv("OPENWEATHERMAP_API_KEY", "")
    if not key:
        print("WARNING: OPENWEATHERMAP_API_KEY not found in .env file")
    return key


def get_ollama_api_key() -> str:
    """Get Ollama API key (optional) from environment"""
    return os.getenv("OLLAMA_API_KEY", "")


def get_openai_api_key() -> str:
    """Get OpenAI API key from environment"""
    key = os.getenv("OPENAI_API_KEY", "")
    if not key and AI_PROVIDER == "openai":
        raise ValueError("OPENAI_API_KEY not found in .env file")
    return key




def get_news_api_token() -> str:
    """Get News API token from environment"""
    token = os.getenv("NEWS_API_TOKEN", "")
    if not token:
        print("WARNING: NEWS_API_TOKEN not found in .env file")
    return token


def get_alpha_vantage_api_key() -> str:
    """Get Alpha Vantage API key from environment"""
    key = os.getenv("ALPHA_VANTAGE_API_KEY", "")
    if not key:
        print("WARNING: ALPHA_VANTAGE_API_KEY not found in .env file")
    return key


def get_allowed_user_ids() -> list[int]:
    """Get list of allowed Telegram user IDs from environment"""
    if not ALLOWED_USER_ID:
        return []
    
    try:
        # Support comma-separated list of IDs
        return [int(uid.strip()) for uid in ALLOWED_USER_ID.split(",") if uid.strip()]
    except ValueError:
        print(f"WARNING: Invalid ALLOWED_USER_ID format: {ALLOWED_USER_ID}")
        return []


def ensure_directories():
    """Ensure all required directories exist"""
    directories = [
        DATA_DIR,
        BASE_DIR / "logs",
        BASE_DIR / "memory",
        BASE_DIR / "workspace",
        BASE_DIR / "notes",
        BASE_DIR / "tasks"
    ]
    
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)
    
    print("[OK] All required directories created")


def migrate_from_keys_dir():
    """Migrate API keys from old keys/*.txt files to .env file"""
    keys_dir = BASE_DIR / "keys"
    env_file = BASE_DIR / ".env"
    
    if not keys_dir.exists():
        return
    
    print("[INFO] Migrating API keys from keys/ directory to .env file...")
    
    # Mapping of old file names to new env variable names
    key_mapping = {
        "gemini_api_key.txt": "GEMINI_API_KEY",
        "telegram_token.txt": "TELEGRAM_TOKEN",
        "brave_api_key.txt": "BRAVE_API_KEY",
        "openweathermap_api_key.txt": "OPENWEATHERMAP_API_KEY",
        "ollama_api_key.txt": "OLLAMA_API_KEY",
        "glm_api_key.txt": "GLM_API_KEY"
    }
    
    env_content = {}
    
    # Read existing .env if it exists
    if env_file.exists():
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_content[key.strip()] = value.strip()
    
    # Migrate keys from txt files
    migrated = False
    for txt_file, env_key in key_mapping.items():
        txt_path = keys_dir / txt_file
        if txt_path.exists():
            try:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    value = f.read().strip()
                    if value and env_key not in env_content:
                        env_content[env_key] = value
                        migrated = True
                        print(f"[OK] Migrated {txt_file} -> {env_key}")
            except Exception as e:
                print(f"[WARNING] Failed to migrate {txt_file}: {e}")
    
    # Write updated .env file
    if migrated:
        with open(env_file, 'w', encoding='utf-8') as f:
            f.write("# AI Bot Environment Configuration\n")
            f.write("# Migrated from keys/ directory\n\n")
            for key, value in env_content.items():
                f.write(f"{key}={value}\n")
        print("[OK] Migration complete. You can now delete the keys/ directory.")


def initialize_config():
    """Initialize configuration and create .env file if it doesn't exist"""
    ensure_directories()
    
    env_file = BASE_DIR / ".env"
    env_example = BASE_DIR / ".env.example"
    
    # Check if migration is needed
    migrate_from_keys_dir()
    
    # Create .env from .env.example if it doesn't exist
    if not env_file.exists():
        if env_example.exists():
            import shutil
            shutil.copy(env_example, env_file)
            print("[OK] Created .env file from .env.example")
            print("[WARNING] Please edit .env file and add your API keys")
        else:
            print("[WARNING] .env file not found. Please create one based on .env.example")
    else:
        print("[OK] .env file exists")
    
    # Create empty data files if they don't exist
    if not REMINDERS_DB.exists():
        with open(REMINDERS_DB, 'w', encoding='utf-8') as f:
            f.write('{}')
        print(f"[OK] Created {REMINDERS_DB.name}")
    
    if not USER_CONTEXT_DB.exists():
        with open(USER_CONTEXT_DB, 'w', encoding='utf-8') as f:
            f.write('{}')
        print(f"[OK] Created {USER_CONTEXT_DB.name}")


if __name__ == "__main__":
    initialize_config()
    print("\n=== Configuration Test ===")
    try:
        print(f"AI Provider: {AI_PROVIDER}")
        print(f"Gemini API Key: {'설정됨' if get_gemini_api_key() else '없음'}")
        print(f"Telegram Token: {'설정됨' if get_telegram_token() else '없음'}")
        # print(f"Brave API Key: {get_brave_api_key()[:20]}...")
        # print(f"OpenAI API Key: {get_openai_api_key()[:20]}...")
        print(f"Gemini Model: {GEMINI_MODEL}")
        print(f"Ollama Model: {OLLAMA_MODEL}")
        print(f"OpenAI Model: {OPENAI_MODEL}")
    except Exception as e:
        print(f"[ERROR] {e}")
        print("Please check your .env file and ensure all required keys are set.")
