-- Nemesis Share S0: 공유 스토리지 인벤토리(조회 전용) — WWID 기반 디바이스 식별.
-- /dev/sdX 같은 경로는 재부팅·재설치로 바뀌므로 저장하지 않고, multipath WWID를
-- 영구 식별자로 사용한다(design doc §6 재참여 설계 참조).

CREATE TABLE storage_devices (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id   UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    wwid               VARCHAR(100) NOT NULL,
    label              VARCHAR(100),
    size_bytes         BIGINT,
    path_count         INT NOT NULL DEFAULT 0,
    source             VARCHAR(20) NOT NULL DEFAULT 'MANUAL',    -- SCAN | MANUAL
    discovered_node_id UUID,
    status             VARCHAR(20) NOT NULL DEFAULT 'REGISTERED', -- REGISTERED | MISSING
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(cluster_group_id, wwid)
);

CREATE INDEX idx_storage_devices_cluster ON storage_devices(cluster_group_id);
