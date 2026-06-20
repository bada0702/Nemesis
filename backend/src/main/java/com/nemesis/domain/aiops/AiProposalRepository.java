package com.nemesis.domain.aiops;

import org.springframework.data.jpa.repository.JpaRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface AiProposalRepository extends JpaRepository<AiProposal, UUID> {
    List<AiProposal> findByStatusOrderByCreatedAtDesc(String status);
    List<AiProposal> findTop50ByOrderByCreatedAtDesc();
    long countByStatus(String status);
    List<AiProposal> findByStatusAndExpiresAtBefore(String status, OffsetDateTime t);
}
