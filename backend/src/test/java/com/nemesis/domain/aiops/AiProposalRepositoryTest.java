package com.nemesis.domain.aiops;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("test")
class AiProposalRepositoryTest {

    @Autowired AiProposalRepository repo;

    @Test
    void saves_and_finds_pending() {
        repo.save(AiProposal.builder()
                .id(UUID.randomUUID()).triggerType("DETECTION")
                .status(AiProposal.PENDING).confidence(0.7)
                .proposedActions("[]").build());
        assertThat(repo.countByStatus(AiProposal.PENDING)).isEqualTo(1);
        assertThat(repo.findByStatusOrderByCreatedAtDesc(AiProposal.PENDING)).hasSize(1);
    }
}
