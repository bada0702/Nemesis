CREATE TABLE ai_proposals (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID,
    node_id          UUID,
    trigger_type     VARCHAR(20) NOT NULL,
    trigger_reason   TEXT,
    diagnosis        TEXT,
    root_cause       TEXT,
    confidence       DOUBLE PRECISION DEFAULT 0,
    proposed_actions TEXT,                 -- JSON 배열 문자열
    status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    execution_log    TEXT,
    decided_by       VARCHAR(100),
    decided_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ
);
CREATE INDEX idx_ai_proposals_status ON ai_proposals(status);
