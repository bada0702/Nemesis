package com.nemesis.domain.aiops.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.AiOperatorService;
import com.nemesis.domain.aiops.AiProposal;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Action;
import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanFinding;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiFindingServiceTest {
    AiFindingRepository repo; AiOperatorService ops; AiFindingService svc;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        repo = mock(AiFindingRepository.class);
        ops = mock(AiOperatorService.class);
        when(repo.save(any(AiFinding.class))).thenAnswer(i -> i.getArgument(0));
        svc = new AiFindingService(repo, ops, new ObjectMapper());
    }
    private Suspect warn() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.MEM_HIGH, AiFinding.WARN, Map.of("mem", 91.0));
    }
    private Suspect high() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.DISK_FULL, AiFinding.HIGH, Map.of("disk", 96.0));
    }

    @Test void newWarnCreatesOpenFinding() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        svc.recordWarn(warn());
        verify(repo).save(argThat(f -> f.getStatus().equals(AiFinding.OPEN)
                && f.getSignalType().equals(AiFinding.MEM_HIGH)));
    }
    @Test void existingOpenWarnUpdatesLastSeenOnly() {
        AiFinding existing = AiFinding.builder().id(UUID.randomUUID()).nodeId(nodeId)
                .signalType(AiFinding.MEM_HIGH).severity(AiFinding.WARN).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(nodeId, AiFinding.MEM_HIGH))
                .firstSeenAt(java.time.OffsetDateTime.now().minusHours(1)).build();
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.of(existing));
        svc.recordWarn(warn());
        verify(repo).save(argThat(f -> f.getLastSeenAt() != null));
        verifyNoInteractions(ops);   // 제안 안 만듦
    }
    @Test void newHighCreatesFindingAndProposal() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        AiProposal p = AiProposal.builder().id(UUID.randomUUID()).status(AiProposal.PENDING).build();
        when(ops.createFindingProposal(any(), any(), anyString(), any())).thenReturn(p);
        ScanFinding f = new ScanFinding(AiFinding.DISK_FULL, "HIGH", "/u01 96%", "진단", "원인",
                List.of(new Action("정리", "rm", "db2", "MEDIUM")), 0.8);
        svc.recordHigh(high(), f);
        verify(ops).createFindingProposal(eq(clusterId), eq(nodeId), anyString(), eq(f));
        verify(repo).save(argThat(x -> p.getId().equals(x.getProposalId())));
    }
    @Test void reconcileResolvesMissingOpen() {
        AiFinding open = AiFinding.builder().id(UUID.randomUUID()).nodeId(nodeId)
                .signalType(AiFinding.MEM_HIGH).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(nodeId, AiFinding.MEM_HIGH)).build();
        when(repo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN)).thenReturn(List.of(open));
        svc.reconcileResolved(Set.of());   // 활성 지문 없음 → 해소
        verify(repo).save(argThat(f -> f.getStatus().equals(AiFinding.RESOLVED) && f.getResolvedAt() != null));
    }
}
