package com.nemesis.domain.aiops.monitor;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiPrefilterTest {
    MetricsCacheService metrics; NodeRepository nodeRepo; AiOperatorProperties props; AiPrefilter prefilter;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        metrics = mock(MetricsCacheService.class);
        nodeRepo = mock(NodeRepository.class);
        props = new AiOperatorProperties();
        Node node = mock(Node.class);
        when(node.getId()).thenReturn(nodeId);
        when(node.getHostname()).thenReturn("db2");
        Cluster c = mock(Cluster.class);
        when(c.getId()).thenReturn(clusterId);
        when(node.getCluster()).thenReturn(c);
        when(node.getRole()).thenReturn(Node.Role.active);
        when(nodeRepo.findAll()).thenReturn(List.of(node));
        prefilter = new AiPrefilter(metrics, nodeRepo, props);
    }
    private MetricsPushRequest m(double cpu, double mem, double disk) {
        MetricsPushRequest r = new MetricsPushRequest();
        r.setCpuPercent(cpu); r.setMemoryPercent(mem); r.setDiskPercent(disk);
        return r;
    }

    @Test void diskAtThresholdIsWarn() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(10, 10, 91)));
        List<Suspect> s = prefilter.evaluate();
        assertThat(s).hasSize(1);
        assertThat(s.get(0).signalType()).isEqualTo(AiFinding.DISK_FULL);
        assertThat(s.get(0).severity()).isEqualTo(AiFinding.WARN);
    }
    @Test void diskInCriticalBandIsHigh() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(10, 10, 96))); // 90+5 이상
        assertThat(prefilter.evaluate().get(0).severity()).isEqualTo(AiFinding.HIGH);
    }
    @Test void normalMetricsNoSuspect() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(10, 10, 10)));
        assertThat(prefilter.evaluate()).isEmpty();
    }
    @Test void cpuRequiresSustainedCycles() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, m(95, 10, 10)));
        assertThat(prefilter.evaluate()).isEmpty();           // 1회
        assertThat(prefilter.evaluate()).isEmpty();           // 2회
        List<Suspect> third = prefilter.evaluate();           // 3회 → 발생
        assertThat(third).anyMatch(x -> x.signalType().equals(AiFinding.CPU_SUSTAINED));
    }

    @Test void logErrorPatternCarriesErrorSample() {
        MetricsPushRequest mx = m(10, 10, 10);
        mx.setErrorLogPreview(List.of(
                "ORA-00257: archiver error. Connect AS SYSDBA only until resolved",
                "ORA-16038: log 3 sequence# 215 cannot be archived",
                "ORA-00257: archiver error",
                "extra-1", "extra-2"));
        when(metrics.getAll()).thenReturn(Map.of(nodeId, mx));

        Suspect log = prefilter.evaluate().stream()
                .filter(x -> x.signalType().equals(AiFinding.LOG_ERROR_PATTERN))
                .findFirst().orElseThrow();

        assertThat(log.detail()).containsEntry("errorCount", 5);
        Object errors = log.detail().get("errors");
        assertThat(errors).isInstanceOf(List.class);
        assertThat((List<?>) errors).isNotEmpty()
                .anyMatch(line -> String.valueOf(line).contains("ORA-00257"));
    }
}
