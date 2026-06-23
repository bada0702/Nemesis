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

class AiPredictPrefilterTest {
    MetricsCacheService metrics; NodeRepository nodeRepo; AiOperatorProperties props; AiPredictPrefilter pf;
    UUID nodeId = UUID.randomUUID(); UUID clusterId = UUID.randomUUID();

    @BeforeEach void setup() {
        metrics = mock(MetricsCacheService.class);
        nodeRepo = mock(NodeRepository.class);
        props = new AiOperatorProperties();
        props.getMonitor().setIntervalMs(60_000L);   // 1분 간격 → ETA 계산 단순화
        Node node = mock(Node.class);
        when(node.getId()).thenReturn(nodeId);
        when(node.getHostname()).thenReturn("db2");
        Cluster c = mock(Cluster.class);
        when(c.getId()).thenReturn(clusterId);
        when(node.getCluster()).thenReturn(c);
        when(node.getRole()).thenReturn(Node.Role.active);
        when(nodeRepo.findAll()).thenReturn(List.of(node));
        pf = new AiPredictPrefilter(metrics, nodeRepo, props);
    }
    private MetricsPushRequest disk(double d) {
        MetricsPushRequest r = new MetricsPushRequest();
        r.setDiskPercent(d); r.setMemoryPercent(0); return r;
    }

    // ── 순수 함수 etaMinutes ──
    @Test void etaRisingReachesTarget() {
        // 80,82,84,86 (1분 간격, +2/분) → 95까지 (95-86)/2 = 4.5 → ceil 5
        long eta = AiPredictPrefilter.etaMinutes(new double[]{80, 82, 84, 86}, 1, 95);
        assertThat(eta).isEqualTo(5L);
    }
    @Test void etaFlatReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{80, 80, 80, 80}, 1, 95)).isEqualTo(-1L);
    }
    @Test void etaFallingReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{90, 88, 86, 84}, 1, 95)).isEqualTo(-1L);
    }
    @Test void etaAlreadyAtTargetReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{94, 95, 96, 97}, 1, 95)).isEqualTo(-1L);
    }
    @Test void etaTooFewSamplesReturnsMinusOne() {
        assertThat(AiPredictPrefilter.etaMinutes(new double[]{80}, 1, 95)).isEqualTo(-1L);
    }

    // ── evaluate() ──
    @Test void noSignalUntilMinSamples() {
        when(metrics.getAll()).thenReturn(Map.of(nodeId, disk(86)));
        for (int i = 0; i < props.getMonitor().getPredictMinSamples() - 1; i++)
            assertThat(pf.evaluate()).isEmpty();   // 샘플 누적 중
    }
    @Test void risingDiskEmitsTrendSuspect() {
        // 4회 push: 80,82,84,86 → ETA 5분 ≤ critical(30) → CRITICAL
        double[] seq = {80, 82, 84, 86};
        List<Suspect> last = List.of();
        for (double v : seq) { when(metrics.getAll()).thenReturn(Map.of(nodeId, disk(v))); last = pf.evaluate(); }
        assertThat(last).hasSize(1);
        Suspect s = last.get(0);
        assertThat(s.signalType()).isEqualTo(AiFinding.DISK_TREND);
        assertThat(s.severity()).isEqualTo(AiFinding.CRITICAL);
        assertThat(s.detail()).containsKey("etaMinutes");
    }
    @Test void slowRiseBeyondHorizonNoSignal() {
        // +0.01/분 → 95까지 수백 분 → horizon(360) 초과 → 신호 없음
        double[] seq = {80.00, 80.01, 80.02, 80.03};
        List<Suspect> last = List.of();
        for (double v : seq) { when(metrics.getAll()).thenReturn(Map.of(nodeId, disk(v))); last = pf.evaluate(); }
        assertThat(last).isEmpty();
    }
}
