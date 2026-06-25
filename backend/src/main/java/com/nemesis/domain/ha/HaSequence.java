package com.nemesis.domain.ha;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 클러스터별 HA 운영 절차(기동/중지/Failover) 단계 정의. 단계 배열은 jsonb로 저장한다. */
@Entity
@Table(name = "ha_sequences",
       uniqueConstraints = @UniqueConstraint(columnNames = {"cluster_group_id", "type"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HaSequence {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "cluster_group_id", nullable = false)
    private UUID clusterGroupId;

    /** STARTUP, SHUTDOWN, FAILOVER */
    @Column(nullable = false, length = 20)
    private String type;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<Map<String, Object>> steps = List.of();

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @PreUpdate
    @PrePersist
    void touch() {
        this.updatedAt = OffsetDateTime.now();
    }
}
