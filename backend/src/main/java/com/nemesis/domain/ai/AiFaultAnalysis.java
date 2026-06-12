package com.nemesis.domain.ai;

import com.nemesis.domain.node.Node;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "ai_fault_analysis")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiFaultAnalysis {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id", nullable = false)
    private Node node;

    @Column(name = "error_logs", columnDefinition = "TEXT")
    private String errorLogs;

    @Column(name = "root_cause", columnDefinition = "TEXT")
    private String rootCause;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fix_commands", columnDefinition = "jsonb")
    private List<Map<String, Object>> fixCommands;

    @Column(name = "trigger_type", length = 10)
    @Builder.Default
    private String triggerType = "AUTO";

    @Column(length = 20)
    @Builder.Default
    private String status = "PENDING";

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() { this.createdAt = OffsetDateTime.now(); }
}
