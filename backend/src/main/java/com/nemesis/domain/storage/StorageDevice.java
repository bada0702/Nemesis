package com.nemesis.domain.storage;

import com.nemesis.domain.cluster.Cluster;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "storage_devices",
       uniqueConstraints = @UniqueConstraint(columnNames = {"cluster_group_id", "wwid"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StorageDevice {

    public enum Source { SCAN, MANUAL }
    public enum Status { REGISTERED, MISSING }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_group_id", nullable = false)
    private Cluster cluster;

    @Column(nullable = false, length = 100)
    private String wwid;

    @Column(length = 100)
    private String label;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "path_count", nullable = false)
    @Builder.Default
    private int pathCount = 0;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Source source = Source.MANUAL;

    @Column(name = "discovered_node_id")
    private UUID discoveredNodeId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Status status = Status.REGISTERED;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
        this.updatedAt = OffsetDateTime.now();
    }

    @PreUpdate
    void preUpdate() {
        this.updatedAt = OffsetDateTime.now();
    }
}
