package com.nemesis.domain.config;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** 클러스터+노드 설정 스냅샷(백업·복구). payload는 JSON 문자열. */
@Entity
@Table(name = "config_snapshots")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ConfigSnapshot {

    @Id private UUID id;

    @Column(name = "cluster_group_id", nullable = false) private UUID clusterId;
    @Column(nullable = false, length = 200) private String name;
    @Column(columnDefinition = "TEXT", nullable = false) private String payload;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;

    @PrePersist void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = OffsetDateTime.now();
    }
}
