package com.nemesis.domain.catalog;

import com.nemesis.domain.cluster.Cluster;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 클러스터 논리 서비스. "Oracle DB"는 클러스터에 1개 등록되고 각 노드의 설치
 * 인스턴스는 메트릭 캐시의 프로세스 목록과 name(매칭 패턴)을 대조해 실시간 계산한다.
 * HA 대상 지정(haManaged)·기동 순서·AI 권고가 이 엔티티를 기준으로 쌓인다.
 */
@Entity
@Table(name = "managed_services",
       uniqueConstraints = @UniqueConstraint(columnNames = {"cluster_group_id", "name"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ManagedService {

    public enum Type { WEB, WAS, DB, SW, CONTAINER }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_group_id", nullable = false)
    private Cluster cluster;

    /** 프로세스 매칭 패턴(소문자). 예: mysqld, ora_pmon, nginx */
    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "display_name", nullable = false, length = 200)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Type type = Type.SW;

    /** HA 대상 여부. true면 장애 감지·AI 권고·기동 순서의 대상이 된다. */
    @Column(name = "ha_managed", nullable = false)
    @Builder.Default
    private boolean haManaged = false;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
    }
}
