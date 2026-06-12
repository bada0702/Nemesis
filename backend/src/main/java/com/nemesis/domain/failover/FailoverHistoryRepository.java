package com.nemesis.domain.failover;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface FailoverHistoryRepository extends JpaRepository<FailoverHistory, Long> {

    List<FailoverHistory> findByClusterGroupIdOrderByCreatedAtDesc(UUID clusterGroupId);

    /** 윈도 내 성공한 페일오버 횟수(max_failover_count 가드용). */
    long countByClusterGroupIdAndStatusAndCreatedAtAfter(
            UUID clusterGroupId, FailoverHistory.Status status, OffsetDateTime after);
}
