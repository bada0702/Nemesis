package com.nemesis.domain.node;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NodeRepository extends JpaRepository<Node, UUID> {
    List<Node> findByClusterId(UUID clusterId);
    Optional<Node> findByClusterIdAndHostname(UUID clusterId, String hostname);
}
