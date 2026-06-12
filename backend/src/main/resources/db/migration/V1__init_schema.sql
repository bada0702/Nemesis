CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE cluster_groups (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                   VARCHAR(100) NOT NULL,
    description            VARCHAR(500),
    vip                    VARCHAR(50),
    max_failover_count     INT DEFAULT 5,
    pingpong_guard_seconds INT DEFAULT 180,
    ai_enabled             BOOLEAN DEFAULT FALSE,
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE nodes (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    hostname         VARCHAR(255) NOT NULL,
    service_ip       VARCHAR(50),
    heartbeat_ip     VARCHAR(50),
    os_type          VARCHAR(20) NOT NULL CHECK (os_type IN ('AIX', 'LINUX')),
    role             VARCHAR(20) NOT NULL DEFAULT 'standby'
                         CHECK (role IN ('active', 'standby', 'fault', 'recovering')),
    agent_version    VARCHAR(50),
    last_seen_at     TIMESTAMP WITH TIME ZONE,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (cluster_group_id, hostname)
);

CREATE TABLE agent_keys (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    api_key          VARCHAR(100) NOT NULL UNIQUE,
    node_id          UUID REFERENCES nodes(id),
    expires_at       TIMESTAMP WITH TIME ZONE,
    revoked          BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id               BIGSERIAL PRIMARY KEY,
    event_type       VARCHAR(100) NOT NULL,
    actor            VARCHAR(255),
    cluster_group_id UUID REFERENCES cluster_groups(id),
    node_id          UUID REFERENCES nodes(id),
    details          TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_nodes_cluster    ON nodes(cluster_group_id);
CREATE INDEX idx_nodes_role       ON nodes(role);
CREATE INDEX idx_audit_created    ON audit_logs(created_at);
CREATE INDEX idx_agent_keys_key   ON agent_keys(api_key);
