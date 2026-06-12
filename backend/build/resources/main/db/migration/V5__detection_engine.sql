-- Phase A 감지 엔진 — 하트비트 임계값 + 감지 이벤트 저장소

-- 클러스터별 연속 미응답 임계 (PRD 하트비트 정책). 코드(HealthMonitor)가 실제 사용한다.
ALTER TABLE cluster_groups
    ADD COLUMN IF NOT EXISTS heartbeat_fail_threshold INT DEFAULT 3;

-- 감지 이벤트: 노드 Fault/복구, 자원 임계 초과, 프로세스 다운 등 상시 감지 결과를 적재
CREATE TABLE detection_events (
    id               BIGSERIAL PRIMARY KEY,
    cluster_group_id UUID REFERENCES cluster_groups(id) ON DELETE CASCADE,
    node_id          UUID REFERENCES nodes(id) ON DELETE CASCADE,
    type             VARCHAR(40)  NOT NULL,   -- NODE_FAULT, NODE_RECOVERED, CPU_HIGH, MEM_HIGH, DISK_HIGH, PROCESS_DOWN
    severity         VARCHAR(20)  NOT NULL,   -- CRITICAL, WARNING, INFO
    message          VARCHAR(500),
    details          TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_cluster ON detection_events(cluster_group_id);
CREATE INDEX idx_events_node    ON detection_events(node_id);
CREATE INDEX idx_events_created ON detection_events(created_at);
CREATE INDEX idx_events_type    ON detection_events(type);
