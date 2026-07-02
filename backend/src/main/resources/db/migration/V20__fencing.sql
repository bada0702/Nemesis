-- Track 0: Fencing / Quorum (스플릿브레인 방지)
-- 페일오버 전 구 active를 강제 격리(soft-fence)하고, 격리 시도 이력을 감사 기록한다.

-- 클러스터별 fencing 메서드. 'ssh-soft'(에이전트 명령 채널로 self-fence),
-- 'none'(비활성 — 기존 best-effort vip-down 동작 유지). 향후 ipmi/hmc/gpfs 확장.
ALTER TABLE cluster_groups
    ADD COLUMN IF NOT EXISTS fence_method VARCHAR(20) NOT NULL DEFAULT 'ssh-soft';

-- Fencing 이력: 누가(target)·언제·어떤 방식으로·결과가 무엇인지.
CREATE TABLE fence_history (
    id               BIGSERIAL PRIMARY KEY,
    cluster_group_id UUID REFERENCES cluster_groups(id) ON DELETE CASCADE,
    target_node_id   UUID,
    method           VARCHAR(20) NOT NULL,   -- ssh-soft | none | (ipmi/hmc/gpfs 예정)
    outcome          VARCHAR(20) NOT NULL,   -- CONFIRMED | PRESUMED_DEAD | FAILED | DISABLED
    detail           VARCHAR(500),
    duration_ms      BIGINT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_fence_cluster ON fence_history(cluster_group_id);
CREATE INDEX idx_fence_created ON fence_history(created_at);
