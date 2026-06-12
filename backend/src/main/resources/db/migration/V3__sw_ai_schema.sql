-- V3 (V2는 runbook_schema)
CREATE TABLE sw_process (
    id            BIGSERIAL PRIMARY KEY,
    node_id       UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    cluster_id    UUID REFERENCES cluster_groups(id) ON DELETE SET NULL,
    name          VARCHAR(200) NOT NULL,
    display_name  VARCHAR(200),
    type          VARCHAR(20)  NOT NULL DEFAULT 'KNOWN',
    status        VARCHAR(20)  DEFAULT 'unknown',
    pid           INTEGER,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (node_id, name)
);

CREATE TABLE ai_fault_analysis (
    id            BIGSERIAL PRIMARY KEY,
    node_id       UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    error_logs    TEXT,
    root_cause    TEXT,
    fix_commands  JSONB,
    trigger_type  VARCHAR(10)  DEFAULT 'AUTO',
    status        VARCHAR(20)  DEFAULT 'PENDING',
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sw_process_node     ON sw_process(node_id);
CREATE INDEX idx_ai_analysis_node    ON ai_fault_analysis(node_id);
CREATE INDEX idx_ai_analysis_created ON ai_fault_analysis(created_at);
