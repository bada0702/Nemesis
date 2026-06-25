package com.nemesis.domain.report;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

/** 운영 리포트. 생성 시점에 실 데이터(노드·페일오버 이력·메트릭)를 스냅샷해 content에 담는다. */
@Entity
@Table(name = "reports")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Report {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 300)
    private String title;

    /** MONTHLY, INCIDENT, PERFORMANCE, SECURITY */
    @Column(nullable = false, length = 20)
    @Builder.Default
    private String type = "MONTHLY";

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String status = "READY";

    @Column(columnDefinition = "text")
    private String content;

    @Column(length = 20)
    private String size;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) this.createdAt = OffsetDateTime.now();
    }
}
