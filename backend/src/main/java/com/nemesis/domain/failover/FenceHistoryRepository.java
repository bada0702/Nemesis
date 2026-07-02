package com.nemesis.domain.failover;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface FenceHistoryRepository extends JpaRepository<FenceHistory, Long> {
    List<FenceHistory> findTop50ByClusterGroupIdOrderByCreatedAtDesc(UUID clusterGroupId);
}
