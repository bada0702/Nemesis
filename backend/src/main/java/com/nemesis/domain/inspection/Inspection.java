package com.nemesis.domain.inspection;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/** 시스템 점검 이력/일정. 정기·긴급·특별 점검을 등록하고 진행 상태를 관리한다. */
@Entity
@Table(name = "inspections")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Inspection {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 200)
    private String target;

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String type = "REGULAR";

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String status = "SCHEDULED";

    @Column(name = "insp_date")
    private LocalDate date;

    @Column(length = 100)
    private String inspector;

    @Column(length = 1000)
    private String notes;

    /** 진행률 계산용 점검 시작/종료(계획) 시각. */
    @Column(name = "start_time") private OffsetDateTime startTime;
    @Column(name = "end_time")   private OffsetDateTime endTime;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) this.createdAt = OffsetDateTime.now();
    }
}
