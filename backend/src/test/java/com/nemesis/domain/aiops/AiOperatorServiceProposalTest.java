package com.nemesis.domain.aiops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Action;
import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanFinding;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class AiOperatorServiceProposalTest {
    @Test void createsPendingProposalFromFinding() {
        AiProposalRepository repo = mock(AiProposalRepository.class);
        when(repo.save(any(AiProposal.class))).thenAnswer(i -> i.getArgument(0));
        AiOperatorService svc = new AiOperatorService(repo, mock(AiOperatorClient.class),
                new AiOperatorProperties(), mock(NodeRepository.class), new ObjectMapper());

        ScanFinding f = new ScanFinding(com.nemesis.domain.aiops.monitor.AiFinding.DISK_FULL,
                "HIGH", "/u01 96%", "진단", "원인",
                List.of(new Action("정리", "rm ...", "db2", "MEDIUM")), 0.8);
        AiProposal p = svc.createFindingProposal(UUID.randomUUID(), UUID.randomUUID(), "DISK_FULL 96%", f);

        assertThat(p.getStatus()).isEqualTo(AiProposal.PENDING);
        assertThat(p.getTriggerType()).isEqualTo("MONITOR");
        assertThat(p.getProposedActions()).contains("rm ...");
        verify(repo).save(any(AiProposal.class));
    }
}
