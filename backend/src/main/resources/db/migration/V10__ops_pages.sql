-- V10: 운영 페이지 백엔드(점검/시스템설정/알람규칙/리포트/HA 시퀀스)
-- 그동안 프론트의 ComingSoon 배너로 막아둔 페이지들을 실 데이터로 전환한다.

-- ── 점검 관리 ──────────────────────────────────────────────────
CREATE TABLE inspections (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title      VARCHAR(200) NOT NULL,
    target     VARCHAR(200),
    type       VARCHAR(20)  NOT NULL DEFAULT 'REGULAR',   -- REGULAR, EMERGENCY, SPECIAL
    status     VARCHAR(20)  NOT NULL DEFAULT 'SCHEDULED',  -- SCHEDULED, IN_PROGRESS, COMPLETED
    insp_date  DATE,
    inspector  VARCHAR(100),
    notes      VARCHAR(1000),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_inspections_status ON inspections(status);

-- ── 시스템 설정(전역 단일 행) ─────────────────────────────────
CREATE TABLE system_settings (
    id                     INT PRIMARY KEY DEFAULT 1,
    polling_interval_sec   INT NOT NULL DEFAULT 5,
    metrics_retention_days INT NOT NULL DEFAULT 30,
    alert_retention_days   INT NOT NULL DEFAULT 30,
    max_failover_count     INT NOT NULL DEFAULT 5,
    pingpong_guard_sec     INT NOT NULL DEFAULT 180,
    ai_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    notification_email     VARCHAR(500) DEFAULT '',
    notification_slack     VARCHAR(500) DEFAULT '',
    timezone               VARCHAR(50)  NOT NULL DEFAULT 'Asia/Seoul',
    language               VARCHAR(10)  NOT NULL DEFAULT 'ko',
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT system_settings_singleton CHECK (id = 1)
);
INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── 알람 규칙(임계치) ─────────────────────────────────────────
CREATE TABLE alert_rules (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(200) NOT NULL,
    metric       VARCHAR(50)  NOT NULL,   -- cpu, memory, disk, node_state, failover, packet_loss
    threshold    INT          NOT NULL DEFAULT 0,
    level        VARCHAR(20)  NOT NULL DEFAULT 'WARNING',  -- WARNING, CRITICAL
    cooldown_min INT          NOT NULL DEFAULT 5,
    enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_order   INT          NOT NULL DEFAULT 0
);
INSERT INTO alert_rules (name, metric, threshold, level, cooldown_min, enabled, sort_order) VALUES
    ('CPU 사용률 경고',   'cpu',         85, 'WARNING',  5,  TRUE, 1),
    ('메모리 사용률 경고', 'memory',      85, 'WARNING',  5,  TRUE, 2),
    ('디스크 사용률 위험', 'disk',        90, 'CRITICAL', 10, TRUE, 3),
    ('노드 장애 감지',     'node_state',   0, 'CRITICAL', 1,  TRUE, 4),
    ('Failover 발생',     'failover',     0, 'CRITICAL', 1,  TRUE, 5),
    ('패킷 손실률 경고',   'packet_loss',  5, 'WARNING',  5,  FALSE, 6);

-- ── 리포트 ─────────────────────────────────────────────────────
CREATE TABLE reports (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title      VARCHAR(300) NOT NULL,
    type       VARCHAR(20)  NOT NULL DEFAULT 'MONTHLY',  -- MONTHLY, INCIDENT, PERFORMANCE, SECURITY
    status     VARCHAR(20)  NOT NULL DEFAULT 'READY',    -- READY, GENERATING
    content    TEXT,
    size       VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_reports_created ON reports(created_at);

-- ── HA 운영 절차(클러스터별 STARTUP/SHUTDOWN/FAILOVER 단계) ────
CREATE TABLE ha_sequences (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    type             VARCHAR(20) NOT NULL,   -- STARTUP, SHUTDOWN, FAILOVER
    steps            JSONB NOT NULL DEFAULT '[]',
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (cluster_group_id, type)
);
CREATE INDEX idx_ha_sequences_cluster ON ha_sequences(cluster_group_id);
