package com.nemesis.domain.ai;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public interface AiFaultAnalysisRepository extends JpaRepository<AiFaultAnalysis, Long> {
    Optional<AiFaultAnalysis> findTopByNodeIdOrderByCreatedAtDesc(UUID nodeId);
    boolean existsByNodeIdAndCreatedAtAfter(UUID nodeId, OffsetDateTime after);
}
