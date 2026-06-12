package com.nemesis.domain.ai;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

/** Phase C: LLM(또는 Rule 폴백)의 페일오버 판단 이력. */
@Entity
@Table(name = "ai_decisions")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiDecision {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "cluster_group_id")
    private UUID clusterGroupId;

    @Column(name = "node_id")
    private UUID nodeId;

    @Column(length = 20)
    private String provider;

    @Column(nullable = false, length = 20)
    private String action;

    private double confidence;

    @Column(columnDefinition = "TEXT")
    private String reason;

    @Column(name = "latency_ms")
    private Long latencyMs;

    private boolean fallback;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() { this.createdAt = OffsetDateTime.now(); }
}
