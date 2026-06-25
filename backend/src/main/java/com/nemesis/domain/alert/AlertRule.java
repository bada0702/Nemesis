package com.nemesis.domain.alert;

import jakarta.persistence.*;
import lombok.*;

import java.util.UUID;

/** 알람 규칙(임계치). 대시보드 알람 생성과 detection 임계치 판정의 단일 소스. */
@Entity
@Table(name = "alert_rules")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AlertRule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 200)
    private String name;

    /** cpu, memory, disk, node_state, failover, packet_loss */
    @Column(nullable = false, length = 50)
    private String metric;

    @Column(nullable = false)
    @Builder.Default
    private int threshold = 0;

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String level = "WARNING";

    @Column(name = "cooldown_min", nullable = false)
    @Builder.Default
    private int cooldownMin = 5;

    @Column(nullable = false)
    @Builder.Default
    private boolean enabled = true;

    @Column(name = "sort_order", nullable = false)
    @Builder.Default
    private int sortOrder = 0;
}
