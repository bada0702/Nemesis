-- V9: 클러스터 논리 서비스 카탈로그 (서비스 중심 HA 운영의 토대)
-- 노드별 인스턴스 상태는 저장하지 않고 메트릭 캐시에서 실시간 계산한다.
CREATE TABLE managed_services (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    name             VARCHAR(200) NOT NULL,
    display_name     VARCHAR(200) NOT NULL,
    type             VARCHAR(20)  NOT NULL DEFAULT 'SW',
    ha_managed       BOOLEAN      NOT NULL DEFAULT false,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (cluster_group_id, name)
);

CREATE INDEX idx_managed_services_cluster ON managed_services(cluster_group_id);

-- 기존 노드별 SW 등록(sw_process)을 클러스터 논리 서비스로 이관.
-- 같은 클러스터에서 같은 이름은 1건으로 병합, 타입은 프로세스명으로 추론(불명 시 SW).
INSERT INTO managed_services (cluster_group_id, name, display_name, type)
SELECT
    cluster_id,
    lower(name),
    COALESCE(MAX(display_name), name),
    CASE
        WHEN lower(name) ~ '(ora_|oracle|tibero|mariadbd|mysqld|postgres|mongod|redis-server|db2sysc)' THEN 'DB'
        WHEN lower(name) ~ '(tomcat|catalina|weblogic|wlserver|jboss|wildfly)'                          THEN 'WAS'
        WHEN lower(name) ~ '(nginx|httpd)'                                                              THEN 'WEB'
        ELSE 'SW'
    END
FROM sw_process
WHERE cluster_id IS NOT NULL
GROUP BY cluster_id, lower(name), name
ON CONFLICT (cluster_group_id, name) DO NOTHING;
