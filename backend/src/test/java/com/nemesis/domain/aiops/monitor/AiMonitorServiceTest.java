package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorClient;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiMonitorServiceTest {
    AiPrefilter prefilter; AiOperatorClient client; AiFindingService findings;
    AiOperatorProperties props; NodeRepository nodeRepo; AiMonitorService svc;
    AiPredictPrefilter predictPrefilter;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        prefilter = mock(AiPrefilter.class); client = mock(AiOperatorClient.class);
        findings = mock(AiFindingService.class); nodeRepo = mock(NodeRepository.class);
        predictPrefilter = mock(AiPredictPrefilter.class);
        when(predictPrefilter.evaluate()).thenReturn(List.of());
        when(prefilter.evaluate()).thenReturn(List.of());
        props = new AiOperatorProperties();
        Node node = mock(Node.class);
        when(node.getId()).thenReturn(nodeId);
        when(node.getServiceIp()).thenReturn("10.0.0.12");
        when(nodeRepo.findById(nodeId)).thenReturn(Optional.of(node));
        svc = new AiMonitorService(prefilter, client, findings, props, nodeRepo, predictPrefilter);
    }
    private Suspect warn() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.MEM_HIGH, AiFinding.WARN, Map.of());
    }
    private Suspect high() {
        return new Suspect(nodeId, clusterId, "db2", "active", AiFinding.DISK_FULL, AiFinding.HIGH, Map.of());
    }

    @Test void warnGoesStraightToFindingNoScan() {
        when(prefilter.evaluate()).thenReturn(List.of(warn()));
        svc.runScan();
        verify(findings).recordWarn(any(Suspect.class), eq(AiFinding.REACTIVE));
        verify(client, never()).scan(any(), any());
    }
    @Test void highCallsScanThenRecordHigh() {
        when(prefilter.evaluate()).thenReturn(List.of(high()));
        ScanFinding sf = new ScanFinding(AiFinding.DISK_FULL, "HIGH", "s", "d", "r", List.of(), 0.8);
        when(client.scan(any(), any())).thenReturn(new ScanResponse(List.of(sf)));
        svc.runScan();
        verify(findings).recordHigh(any(Suspect.class), eq(sf), eq(AiFinding.REACTIVE));
    }
    @Test void aibotDownFallsBackToPrefilterInfo() {
        when(prefilter.evaluate()).thenReturn(List.of(high()));
        when(client.scan(any(), any())).thenReturn(null);   // 사이드카 불통
        svc.runScan();
        verify(findings).recordHigh(any(Suspect.class), isNull(), eq(AiFinding.REACTIVE));   // 1차 정보만
    }
    @Test void reconcileCalledWithActiveFingerprints() {
        when(prefilter.evaluate()).thenReturn(List.of(warn()));
        svc.runScan();
        verify(findings).reconcileResolved(argThat(set ->
                set.contains(AiFinding.fingerprint(nodeId, AiFinding.MEM_HIGH))));
    }

    @Test void predictiveCriticalRecordsHighWithPredictiveCategory() {
        Suspect pred = new Suspect(nodeId, clusterId, "db2", "active",
                AiFinding.DISK_TREND, AiFinding.CRITICAL, Map.of("etaMinutes", 10L));
        when(predictPrefilter.evaluate()).thenReturn(List.of(pred));
        when(client.scan(any(), any())).thenReturn(null);   // 사이드카 폴백: 1차 정보만
        svc.runScan();
        verify(findings).recordHigh(eq(pred), isNull(), eq(AiFinding.PREDICTIVE));
        verify(findings).reconcileResolved(argThat(set ->
                set.contains(AiFinding.fingerprint(nodeId, AiFinding.DISK_TREND))));
    }

    @Test void predictiveWarnRecordsWarnWithPredictiveCategory() {
        Suspect pred = new Suspect(nodeId, clusterId, "db2", "active",
                AiFinding.MEM_TREND, AiFinding.WARN, Map.of("etaMinutes", 300L));
        when(predictPrefilter.evaluate()).thenReturn(List.of(pred));
        svc.runScan();
        verify(findings).recordWarn(eq(pred), eq(AiFinding.PREDICTIVE));
    }
}
