package com.nemesis.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.failover.FailoverHistory;
import com.nemesis.domain.failover.FailoverHistoryRepository;
import com.nemesis.domain.failover.FailoverOrchestrator;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FailoverOrchestratorTest {

    @Mock NodeRepository            nodeRepository;
    @Mock ClusterRepository         clusterRepository;
    @Mock FailoverHistoryRepository historyRepository;
    @Mock AgentCommandClient        commandClient;
    @Mock MetricsCacheService       metricsCache;

    DetectionProperties  props;
    FailoverOrchestrator orchestrator;

    Cluster cluster;
    Node    active, standby;

    @BeforeEach
    void setUp() {
        props = new DetectionProperties();
        orchestrator = new FailoverOrchestrator(
                nodeRepository, clusterRepository, historyRepository,
                commandClient, metricsCache, props);

        cluster = Cluster.builder().id(UUID.randomUUID()).name("c1")
                .vip("10.0.0.100").vipCidr(24)
                .pingpongGuardSeconds(180).maxFailoverCount(5).build();
        active  = Node.builder().id(UUID.randomUUID()).cluster(cluster)
                .hostname("act").osType(Node.OsType.LINUX).role(Node.Role.active).netIface("eth0").build();
        standby = Node.builder().id(UUID.randomUUID()).cluster(cluster)
                .hostname("sby").osType(Node.OsType.LINUX).role(Node.Role.standby).netIface("eth0").build();

        // 공용 setUp stub — 일부 테스트(핑퐁가드 SKIP)는 조기 반환해 사용하지 않으므로 lenient 처리
        lenient().when(clusterRepository.findById(cluster.getId())).thenReturn(java.util.Optional.of(cluster));
        lenient().when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(active, standby));
    }

    @Test
    void 감지트리거_정상_페일오버로_역할이_전이된다() {
        when(metricsCache.isFresh(eq(standby.getId()), anyLong())).thenReturn(true);
        when(commandClient.execute(any(), anyString()))
                .thenReturn(new AgentCommandClient.Result(true, 0, "", "", null));

        FailoverOrchestrator.Result r = orchestrator.failover(
                cluster.getId(), active.getId(), null, FailoverHistory.Trigger.DETECTION, "test");

        assertThat(r.success()).isTrue();
        assertThat(standby.getRole()).isEqualTo(Node.Role.active);
        assertThat(active.getRole()).isEqualTo(Node.Role.fault);
        verify(commandClient).execute(eq(standby), contains("vip-up"));
        verify(historyRepository).save(argThat(h -> h.getStatus() == FailoverHistory.Status.SUCCESS));
    }

    @Test
    void 핑퐁가드_최근_페일오버시_보류된다() {
        cluster.setLastFailoverAt(OffsetDateTime.now().minusSeconds(10)); // < 180s

        FailoverOrchestrator.Result r = orchestrator.failover(
                cluster.getId(), active.getId(), null, FailoverHistory.Trigger.DETECTION, "test");

        assertThat(r.status()).isEqualTo(FailoverHistory.Status.SKIPPED);
        verify(commandClient, never()).execute(any(), anyString());
    }

    @Test
    void 생존_standby_없으면_보류된다() {
        when(metricsCache.isFresh(eq(standby.getId()), anyLong())).thenReturn(false);

        FailoverOrchestrator.Result r = orchestrator.failover(
                cluster.getId(), active.getId(), null, FailoverHistory.Trigger.DETECTION, "test");

        assertThat(r.status()).isEqualTo(FailoverHistory.Status.SKIPPED);
        assertThat(standby.getRole()).isEqualTo(Node.Role.standby);
    }

    @Test
    void VIP인수_실패시_대상이_standby로_롤백되고_FAILED로_기록된다() {
        when(metricsCache.isFresh(eq(standby.getId()), anyLong())).thenReturn(true);
        // vip-down은 성공, vip-up은 실패
        when(commandClient.execute(eq(active), anyString()))
                .thenReturn(new AgentCommandClient.Result(true, 0, "", "", null));
        when(commandClient.execute(eq(standby), contains("vip-up")))
                .thenReturn(new AgentCommandClient.Result(false, 1, "", "fail", null));

        FailoverOrchestrator.Result r = orchestrator.failover(
                cluster.getId(), active.getId(), null, FailoverHistory.Trigger.DETECTION, "test");

        assertThat(r.status()).isEqualTo(FailoverHistory.Status.FAILED);
        assertThat(standby.getRole()).isEqualTo(Node.Role.standby);
        verify(historyRepository).save(argThat(h -> h.getStatus() == FailoverHistory.Status.FAILED));
    }

    @Test
    void 수동_페일오버는_핑퐁가드를_면제받는다() {
        cluster.setLastFailoverAt(OffsetDateTime.now().minusSeconds(10));
        when(commandClient.execute(any(), anyString()))
                .thenReturn(new AgentCommandClient.Result(true, 0, "", "", null));

        FailoverOrchestrator.Result r = orchestrator.failover(
                cluster.getId(), active.getId(), standby.getId(), FailoverHistory.Trigger.MANUAL, "manual");

        assertThat(r.success()).isTrue();
        assertThat(active.getRole()).isEqualTo(Node.Role.standby); // 수동은 정상 강등
        assertThat(standby.getRole()).isEqualTo(Node.Role.active);
    }
}
