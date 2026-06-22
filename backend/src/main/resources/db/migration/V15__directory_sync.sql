CREATE TABLE sync_jobs (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    name             VARCHAR(200) NOT NULL,
    source_path      TEXT NOT NULL,
    dest_path        TEXT NOT NULL,
    mirror_delete    BOOLEAN NOT NULL DEFAULT FALSE,
    excludes         TEXT,
    schedule_sec     INTEGER NOT NULL DEFAULT 0,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_jobs_cluster ON sync_jobs(cluster_group_id);

CREATE TABLE sync_history (
    id                BIGSERIAL PRIMARY KEY,
    sync_job_id       UUID NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
    trigger_type      VARCHAR(20) NOT NULL,
    status            VARCHAR(20) NOT NULL,
    from_node_id      UUID,
    to_node_id        UUID,
    bytes_transferred BIGINT NOT NULL DEFAULT 0,
    files_count       INTEGER NOT NULL DEFAULT 0,
    duration_ms       BIGINT NOT NULL DEFAULT 0,
    message           TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_history_job ON sync_history(sync_job_id, created_at DESC);
