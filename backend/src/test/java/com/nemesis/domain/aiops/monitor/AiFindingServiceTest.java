package com.nemesis.domain.aiops.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.ai.llm.LlmService;
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
    AiFindingRepository repo; AiOperatorService ops; LlmService llm; AiFindingService svc;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        repo = mock(AiFindingRepository.class);
        ops = mock(AiOperatorService.class);
        llm = mock(LlmService.class);
        when(repo.save(any(AiFinding.class))).thenAnswer(i -> i.getArgument(0));
        svc = new AiFindingService(repo, ops, new ObjectMapper(), llm);
    }
    private Suspect warn() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.MEM_HIGH, AiFinding.WARN, Map.of("mem", 91.0));
    }
    private Suspect logErrorWarn() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.LOG_ERROR_PATTERN, AiFinding.WARN,
                Map.of("errorCount", 5, "errors", List.of("ORA-00257: archiver error", "ORA-16038: log cannot be archived")));
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
    @Test void newLogErrorWarnGetsLlmDiagnosis() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        when(llm.isAvailable()).thenReturn(true);
        when(llm.analyze(anyString())).thenReturn(Map.of("rootCause", "아카이브 로그 영역이 가득 참", "fixCommands", List.of()));
        svc.recordWarn(logErrorWarn());
        verify(llm).analyze(contains("ORA-00257"));   // 실제 에러 텍스트로 설명 생성
        verify(repo).save(argThat(f -> "아카이브 로그 영역이 가득 참".equals(f.getDiagnosis())));
    }
    @Test void logErrorWarnSkipsLlmWhenUnavailable() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        when(llm.isAvailable()).thenReturn(false);
        svc.recordWarn(logErrorWarn());
        verify(llm, never()).analyze(anyString());     // 미설정이면 조용히 생략(폴백 철학)
        verify(repo).save(argThat(f -> f.getDiagnosis() == null));
    }
    @Test void existingLogErrorWarnSkipsLlm() {
        AiFinding existing = AiFinding.builder().id(UUID.randomUUID()).nodeId(nodeId)
                .signalType(AiFinding.LOG_ERROR_PATTERN).severity(AiFinding.WARN).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(nodeId, AiFinding.LOG_ERROR_PATTERN))
                .firstSeenAt(java.time.OffsetDateTime.now().minusHours(1)).build();
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.of(existing));
        svc.recordWarn(logErrorWarn());
        verify(llm, never()).analyze(anyString());     // 비용 한정: 신규일 때만 호출
    }
    @Test void nonErrorWarnSkipsLlm() {
        when(repo.findByFingerprintAndStatus(anyString(), eq(AiFinding.OPEN))).thenReturn(Optional.empty());
        svc.recordWarn(warn());                        // MEM_HIGH 등 자명한 신호는 LLM 불필요
        verify(llm, never()).analyze(anyString());
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
