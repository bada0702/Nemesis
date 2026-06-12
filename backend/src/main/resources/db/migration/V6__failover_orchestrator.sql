-- Phase B 자동 페일오버 오케스트레이터
-- 가드(pingpong/max_count) 추적 컬럼 + VIP 이동 파라미터 + 페일오버 이력 저장소

-- VIP 이동에 필요한 네트워크 파라미터
ALTER TABLE nodes          ADD COLUMN IF NOT EXISTS net_iface VARCHAR(30) DEFAULT 'eth0';
ALTER TABLE cluster_groups ADD COLUMN IF NOT EXISTS vip_cidr  INT         DEFAULT 24;

-- 페일오버 가드 상태(핑퐁 방지/횟수 제한). 오케스트레이터가 실제 사용한다.
ALTER TABLE cluster_groups ADD COLUMN IF NOT EXISTS last_failover_at TIMESTAMP WITH TIME ZONE;

-- 페일오버 이력: 누가/언제/어떤 트리거로/결과가 무엇인지 감사 기록
CREATE TABLE failover_history (
    id               BIGSERIAL PRIMARY KEY,
    cluster_group_id UUID REFERENCES cluster_groups(id) ON DELETE CASCADE,
    from_node_id     UUID,
    to_node_id       UUID,
    trigger_type     VARCHAR(20) NOT NULL,   -- MANUAL, DETECTION, AI
    status           VARCHAR(20) NOT NULL,   -- SUCCESS, FAILED, SKIPPED
    reason           VARCHAR(500),
    vip              VARCHAR(50),
    duration_ms      BIGINT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_failover_cluster ON failover_history(cluster_group_id);
CREATE INDEX idx_failover_created ON failover_history(created_at);
