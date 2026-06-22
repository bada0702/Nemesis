package com.nemesis.domain.sync;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** 클러스터별 폴더 동기화 작업 정의(1행=1폴더쌍). 방향은 active→standby. */
@Entity
@Table(name = "sync_jobs")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SyncJob {

    @Id private UUID id;

    @Column(name = "cluster_group_id", nullable = false) private UUID clusterId;
    @Column(nullable = false, length = 200) private String name;
    @Column(name = "source_path", columnDefinition = "TEXT", nullable = false) private String sourcePath;
    @Column(name = "dest_path",   columnDefinition = "TEXT", nullable = false) private String destPath;
    @Column(name = "mirror_delete", nullable = false) private boolean mirrorDelete;
    @Column(columnDefinition = "TEXT") private String excludes;
    @Column(name = "schedule_sec", nullable = false) private int scheduleSec;
    @Column(nullable = false) private boolean enabled = true;
    @Column(name = "last_run_at") private OffsetDateTime lastRunAt;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;
    @Column(name = "updated_at") private OffsetDateTime updatedAt;

    @PrePersist void prePersist() {
        if (id == null) id = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }
    @PreUpdate void preUpdate() { updatedAt = OffsetDateTime.now(); }
}
