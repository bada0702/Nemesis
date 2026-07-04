package com.nemesis.detection;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.event.DetectionEvent;
import com.nemesis.domain.event.DetectionEventRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class HealthMonitorServiceTest {

    @Mock NodeRepository            nodeRepository;
    @Mock DetectionEventRepository  eventRepository;
    @Mock ApplicationEventPublisher eventPublisher;
    @Mock ManagedServiceRepository  managedServiceRepository;

    MetricsCacheService  metricsCache;
    DetectionProperties  props;
    HealthMonitorService monitor;

    @BeforeEach
    void setUp() {
        metricsCache = new MetricsCacheService();
        props        = new DetectionProperties();   // 기본값: push 3s, grace 2s, fresh 10s
        monitor      = new HealthMonitorService(nodeRepository, metricsCache, eventRepository, props,
                                                eventPublisher, managedServiceRepository);
    }

    private Cluster cluster() {
        return Cluster.builder().id(UUID.randomUUID()).name("테스트").heartbeatFailThreshold(3).build();
    }

    private Node node(Node.Role role, OffsetDateTime lastSeen) {
        return Node.builder()
                .id(UUID.randomUUID())
                .cluster(cluster())
                .hostname("server01")
                .osType(Node.OsType.LINUX)
                .role(role)
                .lastSeenAt(lastSeen)
                .build();
    }

    private Node nodeIn(Cluster c, Node.Role role, OffsetDateTime lastSeen, String host) {
        return Node.builder()
                .id(UUID.randomUUID()).cluster(c).hostname(host)
                .osType(Node.OsType.LINUX).role(role).lastSeenAt(lastSeen).build();
    }

    private MetricsPushRequest freshMetrics() {
        MetricsPushRequest m = new MetricsPushRequest();
        m.setCpuPercent(10.0); m.setMemoryPercent(20.0); m.setDiskPercent(30.0);
        return m;
    }

    @Test
    void 무응답_active는_승격가능_standby가_있으면_fault로_전이되고_페일오버를_트리거한다() {
        Cluster c = cluster();
        Node active  = nodeIn(c, Node.Role.active,  OffsetDateTime.now().minusSeconds(60), "m1");
        Node standby = nodeIn(c, Node.Role.standby, OffsetDateTime.now(),                  "s1");
        metricsCache.put(standby.getId(), freshMetrics());   // 승격 대상 생존(신선)
        when(nodeRepository.findAll()).thenReturn(List.of(active));
        when(nodeRepository.findByClusterId(c.getId())).thenReturn(List.of(active, standby));

        monitor.scan();

        assertThat(active.getRole()).isEqualTo(Node.Role.fault);
        verify(nodeRepository).save(active);
        verify(eventPublisher).publishEvent(any(NodeFaultEvent.class));

        ArgumentCaptor<DetectionEvent> cap = ArgumentCaptor.forClass(DetectionEvent.class);
        verify(eventRepository).save(cap.capture());
        assertThat(cap.getValue().getType()).isEqualTo(DetectionEvent.Type.NODE_FAULT);
        assertThat(cap.getValue().getSeverity()).isEqualTo(DetectionEvent.Severity.CRITICAL);
    }

    @Test
    void 무응답_active는_승격가능_standby가_없으면_master로_유지된다() {   // 단일-master 강등 버그 회귀 방지
        Cluster c = cluster();
        Node active = nodeIn(c, Node.Role.active, OffsetDateTime.now().minusSeconds(60), "m1");
        when(nodeRepository.findAll()).thenReturn(List.of(active));
        when(nodeRepository.findByClusterId(c.getId())).thenReturn(List.of(active));   // 페일오버 대상 없음

        monitor.scan();

        assertThat(active.getRole()).isEqualTo(Node.Role.active);   // 강등되지 않음 (master 유지)
        verify(nodeRepository, never()).save(active);               // role 변경 저장 없음
        verify(eventPublisher, never()).publishEvent(any());        // 페일오버 트리거 안 함

        ArgumentCaptor<DetectionEvent> cap = ArgumentCaptor.forClass(DetectionEvent.class);
        verify(eventRepository).save(cap.capture());                // 경보는 1회 기록
        assertThat(cap.getValue().getType()).isEqualTo(DetectionEvent.Type.NODE_FAULT);
        assertThat(cap.getValue().getSeverity()).isEqualTo(DetectionEvent.Severity.CRITICAL);
    }

    @Test
    void 정상_보고_노드는_active를_유지한다() {
        Node n = node(Node.Role.active, OffsetDateTime.now());
        when(nodeRepository.findAll()).thenReturn(List.of(n));

        monitor.scan();

        assertThat(n.getRole()).isEqualTo(Node.Role.active);
        verify(eventRepository, never()).save(any());
    }

    @Test
    void fault_노드가_다시_보고하면_standby로_복구된다() {
        Node n = node(Node.Role.fault, OffsetDateTime.now());
        when(nodeRepository.findAll()).thenReturn(List.of(n));

        monitor.scan();

        assertThat(n.getRole()).isEqualTo(Node.Role.standby);
        ArgumentCaptor<DetectionEvent> cap = ArgumentCaptor.forClass(DetectionEvent.class);
        verify(eventRepository).save(cap.capture());
        assertThat(cap.getValue().getType()).isEqualTo(DetectionEvent.Type.NODE_RECOVERED);
    }

    @Test
    void recovering_노드는_감지_엔진이_건드리지_않는다() {
        Node n = node(Node.Role.recovering, OffsetDateTime.now().minusSeconds(60));
        when(nodeRepository.findAll()).thenReturn(List.of(n));

        monitor.scan();

        assertThat(n.getRole()).isEqualTo(Node.Role.recovering);
        verify(nodeRepository, never()).save(any());
        verify(eventRepository, never()).save(any());
    }

    // ── HA 서비스 프로세스 다운 자동 페일오버 ──────────────────────────

    private MetricsPushRequest metricsWithProcs(String... names) {
        MetricsPushRequest m = freshMetrics();
        m.setProcesses(java.util.Arrays.stream(names)
                .map(n -> Map.of("name", n, "pid", "100"))
                .toList());
        return m;
    }

    private ManagedService haService(String pattern) {
        return ManagedService.builder().name(pattern).displayName(pattern).haManaged(true).build();
    }

    @Test
    void active의_HA서비스_프로세스가_유예경과까지_없으면_페일오버를_트리거한다() {
        props.setProcessFailoverGraceSeconds(0);
        Cluster c = cluster();
        Node active  = nodeIn(c, Node.Role.active,  OffsetDateTime.now(), "m1");
        Node standby = nodeIn(c, Node.Role.standby, OffsetDateTime.now(), "s1");
        metricsCache.put(active.getId(),  metricsWithProcs("java"));            // mysqld 없음
        metricsCache.put(standby.getId(), metricsWithProcs("mysqld", "java")); // 대상에는 실행 중
        when(nodeRepository.findAll()).thenReturn(List.of(active));
        when(nodeRepository.findByClusterId(c.getId())).thenReturn(List.of(active, standby));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(c.getId()))
                .thenReturn(List.of(haService("mysqld")));

        monitor.scan();
        monitor.scan();   // 인시던트당 1회만 발화해야 함

        verify(eventPublisher, times(1)).publishEvent(any(NodeFaultEvent.class));
        ArgumentCaptor<DetectionEvent> cap = ArgumentCaptor.forClass(DetectionEvent.class);
        verify(eventRepository, times(1)).save(cap.capture());
        assertThat(cap.getValue().getType()).isEqualTo(DetectionEvent.Type.PROCESS_DOWN);
        assertThat(cap.getValue().getSeverity()).isEqualTo(DetectionEvent.Severity.CRITICAL);
        assertThat(active.getRole()).isEqualTo(Node.Role.active);   // role 변경은 orchestrator 몫
    }

    @Test
    void HA서비스_프로세스_소실이_유예시간_미경과면_트리거하지_않는다() {
        props.setProcessFailoverGraceSeconds(10);
        Cluster c = cluster();
        Node active = nodeIn(c, Node.Role.active, OffsetDateTime.now(), "m1");
        metricsCache.put(active.getId(), metricsWithProcs("java"));
        when(nodeRepository.findAll()).thenReturn(List.of(active));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(c.getId()))
                .thenReturn(List.of(haService("mysqld")));

        monitor.scan();

        verify(eventPublisher, never()).publishEvent(any());
        verify(eventRepository, never()).save(any());
    }

    @Test
    void 서비스_실행중인_standby가_없으면_페일오버_대신_CRITICAL_경보만_남긴다() {
        props.setProcessFailoverGraceSeconds(0);
        Cluster c = cluster();
        Node active  = nodeIn(c, Node.Role.active,  OffsetDateTime.now(), "m1");
        Node standby = nodeIn(c, Node.Role.standby, OffsetDateTime.now(), "s1");
        metricsCache.put(active.getId(),  metricsWithProcs("java"));
        metricsCache.put(standby.getId(), metricsWithProcs("java"));   // 대상에도 mysqld 없음
        when(nodeRepository.findAll()).thenReturn(List.of(active));
        when(nodeRepository.findByClusterId(c.getId())).thenReturn(List.of(active, standby));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(c.getId()))
                .thenReturn(List.of(haService("mysqld")));

        monitor.scan();

        verify(eventPublisher, never()).publishEvent(any());
        ArgumentCaptor<DetectionEvent> cap = ArgumentCaptor.forClass(DetectionEvent.class);
        verify(eventRepository, times(1)).save(cap.capture());
        assertThat(cap.getValue().getType()).isEqualTo(DetectionEvent.Type.PROCESS_DOWN);
        assertThat(cap.getValue().getSeverity()).isEqualTo(DetectionEvent.Severity.CRITICAL);
        assertThat(cap.getValue().getMessage()).contains("보류");
    }

    @Test
    void standby_노드의_HA서비스_프로세스_다운은_트리거하지_않는다() {
        props.setProcessFailoverGraceSeconds(0);
        Cluster c = cluster();
        Node standby = nodeIn(c, Node.Role.standby, OffsetDateTime.now(), "s1");
        metricsCache.put(standby.getId(), metricsWithProcs("java"));
        when(nodeRepository.findAll()).thenReturn(List.of(standby));

        monitor.scan();

        verify(eventPublisher, never()).publishEvent(any());
        verify(eventRepository, never()).save(any());
        verify(managedServiceRepository, never()).findByClusterIdAndHaManagedTrue(any());
    }

    @Test
    void 프로세스_복귀_후_재다운이면_새_인시던트로_다시_발화한다() {
        props.setProcessFailoverGraceSeconds(0);
        Cluster c = cluster();
        Node active  = nodeIn(c, Node.Role.active,  OffsetDateTime.now(), "m1");
        Node standby = nodeIn(c, Node.Role.standby, OffsetDateTime.now(), "s1");
        metricsCache.put(standby.getId(), metricsWithProcs("mysqld"));
        when(nodeRepository.findAll()).thenReturn(List.of(active));
        when(nodeRepository.findByClusterId(c.getId())).thenReturn(List.of(active, standby));
        when(managedServiceRepository.findByClusterIdAndHaManagedTrue(c.getId()))
                .thenReturn(List.of(haService("mysqld")));

        metricsCache.put(active.getId(), metricsWithProcs("java"));      // 다운
        monitor.scan();
        metricsCache.put(active.getId(), metricsWithProcs("mysqld"));    // 복귀 → 상태 초기화
        monitor.scan();
        metricsCache.put(active.getId(), metricsWithProcs("java"));      // 재다운 → 새 인시던트
        monitor.scan();

        verify(eventPublisher, times(2)).publishEvent(any(NodeFaultEvent.class));
    }

    @Test
    void CPU_임계_초과시_경고_이벤트가_한번_발생한다() {
        Node n = node(Node.Role.active, OffsetDateTime.now());
        when(nodeRepository.findAll()).thenReturn(List.of(n));

        MetricsPushRequest m = new MetricsPushRequest();
        m.setCpuPercent(95.0);
        m.setMemoryPercent(40.0);
        m.setDiskPercent(50.0);
        metricsCache.put(n.getId(), m);

        monitor.scan();   // 1차: 임계 진입 → 이벤트 발생
        monitor.scan();   // 2차: 여전히 초과지만 중복 발생 안 함

        ArgumentCaptor<DetectionEvent> cap = ArgumentCaptor.forClass(DetectionEvent.class);
        verify(eventRepository, times(1)).save(cap.capture());
        assertThat(cap.getValue().getType()).isEqualTo(DetectionEvent.Type.CPU_HIGH);
        assertThat(n.getRole()).isEqualTo(Node.Role.active);
    }
}
