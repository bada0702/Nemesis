package com.nemesis.domain.sync;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SyncJobRepository extends JpaRepository<SyncJob, UUID> {
    List<SyncJob> findByClusterId(UUID clusterId);
    List<SyncJob> findByEnabledTrueAndScheduleSecGreaterThan(int sec);
}
