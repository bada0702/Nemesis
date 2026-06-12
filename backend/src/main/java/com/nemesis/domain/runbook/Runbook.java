package com.nemesis.domain.runbook;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "runbooks")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Runbook {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false, length = 50)
    @Builder.Default
    private String type = "MAINTENANCE";

    private String target;

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String status = "SCHEDULED";

    @Column(name = "current_step", nullable = false)
    @Builder.Default
    private int currentStep = 0;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<Map<String, Object>> steps = List.of();

    @Column(nullable = false)
    @Builder.Default
    private int progress = 0;

    @Column(name = "created_by", length = 100)
    @Builder.Default
    private String createdBy = "admin";

    @Column(name = "started_at")
    private OffsetDateTime startedAt;

    @Column(name = "scheduled_at")
    private OffsetDateTime scheduledAt;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() { this.createdAt = OffsetDateTime.now(); }
}
