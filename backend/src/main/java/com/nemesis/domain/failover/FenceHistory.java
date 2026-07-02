package com.nemesis.domain.failover;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Fencing 시도 이력(감사 로그). 페일오버 전 구 active 강제 격리의 결과를 기록한다.
 * 스플릿브레인 방지의 핵심 안전장치이므로 모든 시도를 남긴다.
 */
@Entity
@Table(name = "fence_history")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class FenceHistory {

    /** 격리 판정 결과. */
    public enum Outcome {
        /** 대상이 응답해 self-fence 확인됨(VIP 내림). */
        CONFIRMED,
        /** 대상 도달 불가 + witness(관리서버) 메트릭 신선도로 사망 추정 → 인수 허용. */
        PRESUMED_DEAD,
        /** 대상 도달 불가지만 아직 살아있음(메트릭 신선) → 위험, 인수 중단. */
        FAILED,
        /** fence_method=none → 격리 비활성. */
        DISABLED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "cluster_group_id")
    private UUID clusterGroupId;

    @Column(name = "target_node_id")
    private UUID targetNodeId;

    @Column(nullable = false, length = 20)
    private String method;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Outcome outcome;

    @Column(length = 500)
    private String detail;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() { this.createdAt = OffsetDateTime.now(); }
}
