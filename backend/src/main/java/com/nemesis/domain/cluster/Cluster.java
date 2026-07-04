package com.nemesis.domain.cluster;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "cluster_groups")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Cluster {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 500)
    private String description;

    @Column(length = 50)
    private String vip;

    /** VIP 네트워크 프리픽스 길이(CIDR). control.sh vip-up <iface> <vip> <cidr>에 사용. */
    @Column(name = "vip_cidr")
    @Builder.Default
    private int vipCidr = 24;

    @Column(name = "max_failover_count")
    @Builder.Default
    private int maxFailoverCount = 5;

    @Column(name = "pingpong_guard_seconds")
    @Builder.Default
    private int pingpongGuardSeconds = 180;

    /** 마지막 페일오버 시각(핑퐁 가드 판정 기준). */
    @Column(name = "last_failover_at")
    private OffsetDateTime lastFailoverAt;

    @Column(name = "heartbeat_fail_threshold")
    @Builder.Default
    private int heartbeatFailThreshold = 3;

    @Column(name = "ai_enabled")
    @Builder.Default
    private boolean aiEnabled = false;

    /** 페일오버 전 구 active 격리 방식: ssh-soft(에이전트 self-fence) | none (V20) */
    @Column(name = "fence_method", length = 20)
    @Builder.Default
    private String fenceMethod = "ssh-soft";

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
