-- 시스템 설정 AI(LLM) 제공자에 Google Gemini 추가.
-- 시스템 설정 화면에서 Ollama / Anthropic(Claude) / OpenAI / Gemini 중 선택 가능.
ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS llm_gemini_api_key VARCHAR(200) DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_gemini_model   VARCHAR(100) DEFAULT '';
