package com.nemesis.domain.ai;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AiDecisionRepository extends JpaRepository<AiDecision, Long> {
    List<AiDecision> findByClusterGroupIdOrderByCreatedAtDesc(UUID clusterGroupId);
}
