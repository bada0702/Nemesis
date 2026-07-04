package com.nemesis.domain.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FailbackServiceTest {

    @Mock ClusterRepository         clusterRepository;
    @Mock NodeRepository            nodeRepository;
    @Mock FailoverHistoryRepository historyRepository;
    @Mock ManagedServiceRepository  managedServiceRepository;
    @Mock FailoverOrchestrator      orchestrator;

    MetricsCacheService metricsCache;
    DetectionProperties detectionProps;
    FailbackProperties  props;
    FailbackService     failback;

    Cluster cluster;
    Node    original;   // 자동 페일오버로 강등됐던 원 노드(페일백 후보)

    @BeforeEach
    void setUp() {
        metricsCache  = new MetricsCacheService();
        detectionProps = new DetectionProperties();
        props         = new FailbackProperties();
        props.setStabilizationSeconds(0);   // 기본: 즉시 발화 가능 (개별 테스트에서 조정)
        failback = new FailbackService(clusterRepository, nodeRepository, historyRepository,
                managedServiceRepository, metricsCache, detectionProps, props, orchestrator);

        cluster  = Cluster.builder().id(UUID.randomUUID()).name("c1").build();
        original = Node.builder().id(UUID.randomUUID()).cluster(cluster)
                .hostname("origin01").osType(Node.OsType.LINUX)
                .role(Node.Role.standby).build();
    }

    private FailoverHistory history(FailoverHistory.Trigger trigger) {
        return FailoverHistory.builder()
                .clusterGroupId(cluster.getId())
                .fromNodeId(original.getId())
                .toNodeId(UUID.randomUUID())
                .trigger(trigger)
                .status(FailoverHistory.Status.SUCCESS)
                .build();
    }

    private MetricsPushRequest metricsWithProcs(String... names) {
        MetricsPushRequest m = new MetricsPushRequest();
        m.setCpuPercent(10.0); m.setMemoryPercent(20.0); m.setDiskPercent(30.0);
        m.setProcesses(java.util.Arrays.stream(names)
                .map(n -> Map.of("name", n, "pid", "100"))
                .toList());
        return m;
    }

    private void givenLastFailover(FailoverHistory.Trigger trigger) {
        when(historyRepository.findFirstByClusterGroupIdAndStatusOrderByCreatedAtDesc(
                cluster.getId(), FailoverHistory.Status.SUCCESS))
                .thenReturn(Optional.of(history(trigger)));
    }

    @Test
    void 감지_페일오버의_원노드가_복구되면_FAILBACK_트리거로_환원한다() {
        givenLastFailover(FailoverHistory.Trigger.DETECTION);
        when(nodeRepository.findById(original.getId())).thenReturn(Optional.of(original));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(cluster.getId()))
                .thenReturn(List.of());
        metricsCache.put(original.getId(), metricsWithProcs("mysqld"));
        when(orchestrator.failover(eq(cluster.getId()), isNull(), eq(original.getId()),
                eq(FailoverHistory.Trigger.FAILBACK), any()))
                .thenReturn(new FailoverOrchestrator.Result(
                        FailoverHistory.Status.SUCCESS, "ok", null, original.getId()));

        failback.evaluate(cluster);

        verify(orchestrator).failover(eq(cluster.getId()), isNull(), eq(original.getId()),
                eq(FailoverHistory.Trigger.FAILBACK), any());
    }

    @Test
    void 수동_페일오버는_자동_페일백하지_않는다() {
        givenLastFailover(FailoverHistory.Trigger.MANUAL);

        failback.evaluate(cluster);

        verify(orchestrator, never()).failover(any(), any(), any(), any(), any());
    }

    @Test
    void 페일백_성공_후에는_더_이상_페일백하지_않는다() {
        givenLastFailover(FailoverHistory.Trigger.FAILBACK);

        failback.evaluate(cluster);

        verify(orchestrator, never()).failover(any(), any(), any(), any(), any());
    }

    @Test
    void 안정화_시간이_경과하기_전에는_페일백하지_않는다() {
        props.setStabilizationSeconds(60);
        givenLastFailover(FailoverHistory.Trigger.DETECTION);
        when(nodeRepository.findById(original.getId())).thenReturn(Optional.of(original));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(cluster.getId()))
                .thenReturn(List.of());
        metricsCache.put(original.getId(), metricsWithProcs("mysqld"));

        failback.evaluate(cluster);   // 안정화 시계 시작 tick

        verify(orchestrator, never()).failover(any(), any(), any(), any(), any());
    }

    @Test
    void 원노드가_standby가_아니면_페일백하지_않는다() {
        original.setRole(Node.Role.fault);
        givenLastFailover(FailoverHistory.Trigger.DETECTION);
        when(nodeRepository.findById(original.getId())).thenReturn(Optional.of(original));

        failback.evaluate(cluster);

        verify(orchestrator, never()).failover(any(), any(), any(), any(), any());
    }

    @Test
    void 원노드_메트릭이_신선하지_않으면_페일백하지_않는다() {
        givenLastFailover(FailoverHistory.Trigger.DETECTION);
        when(nodeRepository.findById(original.getId())).thenReturn(Optional.of(original));
        // 메트릭 캐시 비어있음 = 신선하지 않음

        failback.evaluate(cluster);

        verify(orchestrator, never()).failover(any(), any(), any(), any(), any());
    }

    @Test
    void HA서비스가_원노드에서_실행중이_아니면_페일백하지_않는다() {
        givenLastFailover(FailoverHistory.Trigger.DETECTION);
        when(nodeRepository.findById(original.getId())).thenReturn(Optional.of(original));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(cluster.getId()))
                .thenReturn(List.of(ManagedService.builder()
                        .name("mysqld").displayName("MySQL").haManaged(true).build()));
        metricsCache.put(original.getId(), metricsWithProcs("java"));   // mysqld 미기동

        failback.evaluate(cluster);

        verify(orchestrator, never()).failover(any(), any(), any(), any(), any());
    }

    @Test
    void 핑퐁_가드_윈도_내에는_페일백을_미룬다() {
        cluster.setLastFailoverAt(OffsetDateTime.now());   // 방금 페일오버(가드 180s)
        givenLastFailover(FailoverHistory.Trigger.DETECTION);
        when(nodeRepository.findById(original.getId())).thenReturn(Optional.of(original));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(cluster.getId()))
                .thenReturn(List.of());
        metricsCache.put(original.getId(), metricsWithProcs("mysqld"));

        failback.evaluate(cluster);

        verify(orchestrator, never()).failover(any(), any(), any(), any(), any());
    }

    @Test
    void tick은_모든_클러스터를_평가하고_한_클러스터의_예외가_다른_클러스터를_막지_않는다() {
        Cluster broken = Cluster.builder().id(UUID.randomUUID()).name("broken").build();
        when(clusterRepository.findAll()).thenReturn(List.of(broken, cluster));
        when(historyRepository.findFirstByClusterGroupIdAndStatusOrderByCreatedAtDesc(
                broken.getId(), FailoverHistory.Status.SUCCESS))
                .thenThrow(new RuntimeException("DB 오류"));
        givenLastFailover(FailoverHistory.Trigger.MANUAL);   // 두 번째 클러스터는 정상 평가

        failback.tick();

        verify(historyRepository).findFirstByClusterGroupIdAndStatusOrderByCreatedAtDesc(
                cluster.getId(), FailoverHistory.Status.SUCCESS);
    }
}
