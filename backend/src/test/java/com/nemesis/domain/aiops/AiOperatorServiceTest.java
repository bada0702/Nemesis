package com.nemesis.domain.aiops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiOperatorServiceTest {

    AiProposalRepository repo;
    AiOperatorClient client;
    NodeRepository nodeRepo;
    AiOperatorService svc;

    @BeforeEach
    void setup() {
        repo = mock(AiProposalRepository.class);
        client = mock(AiOperatorClient.class);
        nodeRepo = mock(NodeRepository.class);
        AiOperatorProperties props = new AiOperatorProperties();
        props.setEnabled(true);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        svc = new AiOperatorService(repo, client, props, nodeRepo, new ObjectMapper());
    }

    @Test
    void onFault_creates_pending_proposal_when_aibot_proposes() {
        Node n = new Node(); n.setHostname("db2"); n.setServiceIp("10.0.0.12");
        when(nodeRepo.findById(any())).thenReturn(Optional.of(n));
        when(client.investigate(any(), any())).thenReturn(new InvestigateResponse(
                "d", "r", List.of(new Action("x", "c", "db2", "LOW")), 0.8));

        AiProposal p = svc.onFault(UUID.randomUUID(), UUID.randomUUID(), "DETECTION", "reason");

        assertThat(p).isNotNull();
        assertThat(p.getStatus()).isEqualTo(AiProposal.PENDING);
        assertThat(p.getProposedActions()).contains("\"command\":\"c\"");
    }

    @Test
    void onFault_returns_null_when_aibot_down() {        // 폴백: HA 경로 불변
        when(nodeRepo.findById(any())).thenReturn(Optional.of(new Node()));
        when(client.investigate(any(), any())).thenReturn(null);
        assertThat(svc.onFault(UUID.randomUUID(), UUID.randomUUID(), "DETECTION", "r")).isNull();
        verify(repo, never()).save(any());
    }

    @Test
    void approve_executes_and_marks_succeeded() {
        UUID id = UUID.randomUUID();
        AiProposal p = AiProposal.builder().id(id).status(AiProposal.PENDING)
                .nodeId(UUID.randomUUID())
                .proposedActions("[{\"description\":\"x\",\"command\":\"c\",\"target\":\"db2\",\"riskLevel\":\"LOW\"}]")
                .build();
        when(repo.findById(id)).thenReturn(Optional.of(p));
        Node n = new Node(); n.setServiceIp("10.0.0.12");
        when(nodeRepo.findById(any())).thenReturn(Optional.of(n));
        when(client.execute(any(), any(), any()))
                .thenReturn(new ExecuteResponse("SUCCEEDED", List.of(), "ok"));

        AiProposal out = svc.approve(id, "admin");
        assertThat(out.getStatus()).isEqualTo(AiProposal.SUCCEEDED);
        assertThat(out.getDecidedBy()).isEqualTo("admin");
    }

    @Test
    void reject_marks_rejected_without_execute() {
        UUID id = UUID.randomUUID();
        when(repo.findById(id)).thenReturn(Optional.of(
                AiProposal.builder().id(id).status(AiProposal.PENDING).build()));
        AiProposal out = svc.reject(id, "op1");
        assertThat(out.getStatus()).isEqualTo(AiProposal.REJECTED);
        verify(client, never()).execute(any(), any(), any());
    }
}
