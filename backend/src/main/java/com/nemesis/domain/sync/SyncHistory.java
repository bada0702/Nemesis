package com.nemesis.domain.sync;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** 동기화 실행 1회 결과. */
@Entity
@Table(name = "sync_history")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SyncHistory {

    public enum Trigger { SCHEDULED, MANUAL, REALTIME }
    public enum Status  { SUCCESS, FAILED, SKIPPED }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;

    @JsonIgnore // lazy 프록시 → 직렬화/세션밖 접근 방지(이력 응답에 job 객체는 불필요)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sync_job_id", nullable = false)
    private SyncJob job;

    @Enumerated(EnumType.STRING) @Column(name = "trigger_type", nullable = false, length = 20) private Trigger triggerType;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private Status status;
    @Column(name = "from_node_id") private UUID fromNodeId;
    @Column(name = "to_node_id")   private UUID toNodeId;
    @Column(name = "bytes_transferred", nullable = false) private long bytesTransferred;
    @Column(name = "files_count", nullable = false) private int filesCount;
    @Column(name = "duration_ms", nullable = false) private long durationMs;
    @Column(columnDefinition = "TEXT") private String message;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;

    @PrePersist void prePersist() { if (createdAt == null) createdAt = OffsetDateTime.now(); }
}
