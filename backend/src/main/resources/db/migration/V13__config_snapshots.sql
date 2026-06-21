-- 클러스터/노드 설정 스냅샷(백업·복구)
CREATE TABLE config_snapshots (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID NOT NULL,
    name             VARCHAR(200) NOT NULL,
    payload          TEXT NOT NULL,          -- {cluster:{...}, nodes:[...]} JSON
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX idx_config_snapshots_cluster ON config_snapshots(cluster_group_id);
