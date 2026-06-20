package com.nemesis.domain.aiops;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** SP1: AI 운영자(aibot)가 제안한 조치 + 승인/실행 상태. */
@Entity
@Table(name = "ai_proposals")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiProposal {

    public static final String PENDING = "PENDING", APPROVED = "APPROVED",
            EXECUTING = "EXECUTING", SUCCEEDED = "SUCCEEDED", FAILED = "FAILED",
            REJECTED = "REJECTED", EXPIRED = "EXPIRED";

    @Id private UUID id;

    @Column(name = "cluster_group_id") private UUID clusterId;
    @Column(name = "node_id")          private UUID nodeId;

    @Column(name = "trigger_type", nullable = false, length = 20) private String triggerType;
    @Column(name = "trigger_reason", columnDefinition = "TEXT")   private String triggerReason;

    @Column(columnDefinition = "TEXT") private String diagnosis;
    @Column(name = "root_cause", columnDefinition = "TEXT") private String rootCause;
    private double confidence;

    /** JSON 배열 문자열: [{description,command,target,riskLevel}] */
    @Column(name = "proposed_actions", columnDefinition = "TEXT") private String proposedActions;

    @Column(nullable = false, length = 20) private String status;

    @Column(name = "execution_log", columnDefinition = "TEXT") private String executionLog;
    @Column(name = "decided_by", length = 100) private String decidedBy;
    @Column(name = "decided_at") private OffsetDateTime decidedAt;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;
    @Column(name = "expires_at") private OffsetDateTime expiresAt;

    @PrePersist void prePersist() {
        if (createdAt == null) createdAt = OffsetDateTime.now();
        if (status == null) status = PENDING;
    }
}
