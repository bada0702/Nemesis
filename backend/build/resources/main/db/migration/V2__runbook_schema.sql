CREATE TABLE runbooks (
    id           BIGSERIAL PRIMARY KEY,
    title        VARCHAR(255) NOT NULL,
    type         VARCHAR(50)  NOT NULL DEFAULT 'MAINTENANCE',
    target       VARCHAR(255),
    status       VARCHAR(20)  NOT NULL DEFAULT 'SCHEDULED',
    current_step INTEGER      NOT NULL DEFAULT 0,
    steps        JSONB        NOT NULL DEFAULT '[]',
    progress     INTEGER      NOT NULL DEFAULT 0,
    created_by   VARCHAR(100) DEFAULT 'admin',
    started_at   TIMESTAMP WITH TIME ZONE,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_runbooks_status ON runbooks(status);
