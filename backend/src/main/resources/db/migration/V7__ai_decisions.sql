-- Phase C AI 판단 연동
-- LLM이 내린 페일오버 판단(결정 보조)을 적재. 성공지표(latency, 채택 여부) 측정용.

CREATE TABLE ai_decisions (
    id               BIGSERIAL PRIMARY KEY,
    cluster_group_id UUID REFERENCES cluster_groups(id) ON DELETE CASCADE,
    node_id          UUID REFERENCES nodes(id) ON DELETE SET NULL,
    provider         VARCHAR(20),                 -- ollama / openai / anthropic / rule-fallback
    action           VARCHAR(20) NOT NULL,        -- FAILOVER_NOW / HOLD / SELF_HEAL_FIRST
    confidence       DOUBLE PRECISION DEFAULT 0,
    reason           TEXT,
    latency_ms       BIGINT,
    fallback         BOOLEAN DEFAULT FALSE,        -- LLM 실패로 Rule 폴백했는지
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ai_decisions_cluster ON ai_decisions(cluster_group_id);
CREATE INDEX idx_ai_decisions_created ON ai_decisions(created_at);
