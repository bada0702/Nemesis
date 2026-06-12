package com.nemesis.domain.failover;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 페일오버 실행 이력(감사 로그). 수동/감지/AI 트리거의 결과를 일관되게 기록한다.
 */
@Entity
@Table(name = "failover_history")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class FailoverHistory {

    public enum Trigger { MANUAL, DETECTION, AI }
    public enum Status  { SUCCESS, FAILED, SKIPPED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "cluster_group_id")
    private UUID clusterGroupId;

    @Column(name = "from_node_id")
    private UUID fromNodeId;

    @Column(name = "to_node_id")
    private UUID toNodeId;

    @Enumerated(EnumType.STRING)
    @Column(name = "trigger_type", nullable = false, length = 20)
    private Trigger trigger;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status;

    @Column(length = 500)
    private String reason;

    @Column(length = 50)
    private String vip;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() { this.createdAt = OffsetDateTime.now(); }
}
