package com.nemesis.domain.agent;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AgentKeyRepository extends JpaRepository<AgentKey, UUID> {
    Optional<AgentKey> findByApiKey(String apiKey);
    boolean existsByApiKey(String apiKey);
    Optional<AgentKey> findByNodeId(UUID nodeId);
}
