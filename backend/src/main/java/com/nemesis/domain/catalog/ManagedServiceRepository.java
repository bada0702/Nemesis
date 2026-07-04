package com.nemesis.domain.catalog;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ManagedServiceRepository extends JpaRepository<ManagedService, UUID> {
    List<ManagedService> findByClusterIdOrderByTypeAscDisplayNameAsc(UUID clusterId);
    boolean existsByClusterIdAndName(UUID clusterId, String name);
    List<ManagedService> findByClusterIdAndHaManagedTrue(UUID clusterId);
}
