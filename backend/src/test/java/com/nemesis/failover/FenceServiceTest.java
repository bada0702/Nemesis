package com.nemesis.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.failover.FenceHistory;
import com.nemesis.domain.failover.FenceHistoryRepository;
import com.nemesis.domain.failover.FenceService;
import com.nemesis.domain.node.Node;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FenceServiceTest {

    @Mock AgentCommandClient     commandClient;
    @Mock MetricsCacheService    metricsCache;
    @Mock FenceHistoryRepository historyRepository;

    DetectionProperties props;
    FenceService        fenceService;

    Cluster cluster;
    Node    victim;

    @BeforeEach
    void setUp() {
        props = new DetectionProperties();
        fenceService = new FenceService(commandClient, metricsCache, props, historyRepository);
        cluster = Cluster.builder().id(UUID.randomUUID()).name("c1")
                .vip("10.0.0.100").vipCidr(24).fenceMethod("ssh-soft").build();
        victim = Node.builder().id(UUID.randomUUID()).cluster(cluster)
                .hostname("act").osType(Node.OsType.LINUX).role(Node.Role.active).netIface("eth0").build();
    }

    @Test
    void self_fence_성공시_CONFIRMED() {
        when(commandClient.execute(eq(victim), contains("fence-self")))
                .thenReturn(new AgentCommandClient.Result(true, 0, "fenced", "", null));

        FenceHistory.Outcome o = fenceService.fence(cluster, victim);

        assertThat(o).isEqualTo(FenceHistory.Outcome.CONFIRMED);
        verify(historyRepository).save(argThat(h -> h.getOutcome() == FenceHistory.Outcome.CONFIRMED));
    }

    @Test
    void 도달불가_메트릭신선이면_FAILED_분할위험() {
        when(commandClient.execute(eq(victim), contains("fence-self")))
                .thenReturn(new AgentCommandClient.Result(false, 1, "", "unreachable", "Host unreachable"));
        when(metricsCache.isFresh(eq(victim.getId()), anyLong())).thenReturn(true); // 아직 살아있음

        FenceHistory.Outcome o = fenceService.fence(cluster, victim);

        assertThat(o).isEqualTo(FenceHistory.Outcome.FAILED);
        verify(historyRepository).save(argThat(h -> h.getOutcome() == FenceHistory.Outcome.FAILED));
    }

    @Test
    void 도달불가_메트릭stale면_PRESUMED_DEAD() {
        when(commandClient.execute(eq(victim), contains("fence-self")))
                .thenReturn(new AgentCommandClient.Result(false, 1, "", "unreachable", "Host unreachable"));
        when(metricsCache.isFresh(eq(victim.getId()), anyLong())).thenReturn(false); // 사망 추정

        FenceHistory.Outcome o = fenceService.fence(cluster, victim);

        assertThat(o).isEqualTo(FenceHistory.Outcome.PRESUMED_DEAD);
        verify(historyRepository).save(argThat(h -> h.getOutcome() == FenceHistory.Outcome.PRESUMED_DEAD));
    }

    @Test
    void fence_method_none이면_DISABLED_명령없음() {
        cluster.setFenceMethod("none");

        FenceHistory.Outcome o = fenceService.fence(cluster, victim);

        assertThat(o).isEqualTo(FenceHistory.Outcome.DISABLED);
        verify(commandClient, never()).execute(any(), anyString());
        verify(historyRepository).save(argThat(h -> h.getOutcome() == FenceHistory.Outcome.DISABLED));
    }
}
