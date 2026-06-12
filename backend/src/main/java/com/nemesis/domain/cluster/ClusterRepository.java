package com.nemesis.domain.cluster;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ClusterRepository extends JpaRepository<Cluster, UUID> {
    boolean existsByName(String name);
    long countBy();
}
