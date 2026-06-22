-- SP3: 능동 모니터링 finding (상태추적 open/resolved)
CREATE TABLE ai_findings (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID,
    node_id          UUID,
    signal_type      VARCHAR(30)  NOT NULL,
    fingerprint      VARCHAR(200) NOT NULL,
    severity         VARCHAR(10)  NOT NULL,
    status           VARCHAR(10)  NOT NULL,
    summary          TEXT,
    diagnosis        TEXT,
    root_cause       TEXT,
    proposal_id      UUID,
    detail           TEXT,
    first_seen_at    TIMESTAMPTZ,
    last_seen_at     TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 노드별 같은 신호의 OPEN은 동시에 1건만(부분 유니크)
CREATE UNIQUE INDEX ux_ai_findings_open ON ai_findings (node_id, signal_type) WHERE status = 'OPEN';
CREATE INDEX ix_ai_findings_status ON ai_findings (status, last_seen_at DESC);
