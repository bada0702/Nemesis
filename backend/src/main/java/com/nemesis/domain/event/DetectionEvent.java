package com.nemesis.domain.event;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 감지 엔진이 생성하는 이벤트. 노드 Fault/복구, 자원 임계 초과, 프로세스 다운 등을 적재한다.
 */
@Entity
@Table(name = "detection_events")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DetectionEvent {

    public enum Type {
        NODE_FAULT, NODE_RECOVERED, CPU_HIGH, MEM_HIGH, DISK_HIGH, PROCESS_DOWN
    }

    public enum Severity { CRITICAL, WARNING, INFO }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "cluster_group_id")
    private UUID clusterGroupId;

    @Column(name = "node_id")
    private UUID nodeId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private Type type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Severity severity;

    @Column(length = 500)
    private String message;

    @Column(columnDefinition = "TEXT")
    private String details;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() { this.createdAt = OffsetDateTime.now(); }
}
