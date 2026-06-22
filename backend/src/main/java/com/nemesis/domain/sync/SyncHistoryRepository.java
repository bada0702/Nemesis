package com.nemesis.domain.sync;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SyncHistoryRepository extends JpaRepository<SyncHistory, Long> {
    List<SyncHistory> findTop50ByJob_ClusterIdOrderByCreatedAtDesc(UUID clusterId);
}
