-- 시스템 설정에 AI(LLM) 제공자/모델/키 컬럼 추가.
-- 시스템 설정 화면에서 Ollama / Anthropic(Claude) / OpenAI 중 선택·모델·키를 관리한다.
ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS llm_provider          VARCHAR(20)  NOT NULL DEFAULT 'ollama',
    ADD COLUMN IF NOT EXISTS llm_ollama_base_url   VARCHAR(200) DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_ollama_model      VARCHAR(100) DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_anthropic_api_key VARCHAR(200) DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_anthropic_model   VARCHAR(100) DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_openai_api_key    VARCHAR(200) DEFAULT '',
    ADD COLUMN IF NOT EXISTS llm_openai_model      VARCHAR(100) DEFAULT '';
