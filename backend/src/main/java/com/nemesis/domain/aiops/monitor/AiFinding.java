package com.nemesis.domain.aiops.monitor;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** SP3: 능동 모니터링이 발견한 이상 징후(상태추적 open/resolved). */
@Entity
@Table(name = "ai_findings")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiFinding {

    public static final String OPEN = "OPEN", RESOLVED = "RESOLVED", IGNORED = "IGNORED";
    public static final String DISK_FULL = "DISK_FULL", MEM_HIGH = "MEM_HIGH",
            CPU_SUSTAINED = "CPU_SUSTAINED", LOG_ERROR_PATTERN = "LOG_ERROR_PATTERN",
            EVENT_SPIKE = "EVENT_SPIKE", OTHER = "OTHER";
    public static final String DISK_TREND = "DISK_TREND", MEM_TREND = "MEM_TREND";
    public static final String REACTIVE = "REACTIVE", PREDICTIVE = "PREDICTIVE";
    public static final String INFO = "INFO", WARN = "WARN", HIGH = "HIGH", CRITICAL = "CRITICAL";

    public static String fingerprint(UUID nodeId, String signalType) {
        return nodeId + ":" + signalType;
    }

    @Id private UUID id;
    @Column(name = "cluster_group_id") private UUID clusterId;
    @Column(name = "node_id") private UUID nodeId;

    @Column(name = "signal_type", nullable = false, length = 30) private String signalType;
    @Column(nullable = false, length = 200) private String fingerprint;
    @Column(nullable = false, length = 10) private String severity;
    @Column(nullable = false, length = 10) private String status;

    @Column(columnDefinition = "TEXT") private String summary;
    @Column(columnDefinition = "TEXT") private String diagnosis;
    @Column(name = "root_cause", columnDefinition = "TEXT") private String rootCause;
    @Column(name = "proposal_id") private UUID proposalId;
    @Column(columnDefinition = "TEXT") private String detail;  // JSON
    @Column(nullable = false, length = 10) private String category;

    @Column(name = "first_seen_at") private OffsetDateTime firstSeenAt;
    @Column(name = "last_seen_at") private OffsetDateTime lastSeenAt;
    @Column(name = "resolved_at") private OffsetDateTime resolvedAt;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;

    @PrePersist void prePersist() {
        OffsetDateTime now = OffsetDateTime.now();
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = now;
        if (firstSeenAt == null) firstSeenAt = now;
        if (lastSeenAt == null) lastSeenAt = now;
        if (status == null) status = OPEN;
        if (category == null) category = REACTIVE;
        if (fingerprint == null && nodeId != null && signalType != null)
            fingerprint = fingerprint(nodeId, signalType);
    }
}
