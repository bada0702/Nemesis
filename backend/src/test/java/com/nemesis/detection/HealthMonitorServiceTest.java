package com.nemesis.detection;

import com.nemesis.cache.MetricsCacheService;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class HealthMonitorServiceTest {

    @Mock NodeRepository            nodeRepository;
    @Mock DetectionEventRepository  eventRepository;
    @Mock ApplicationEventPublisher eventPublisher;

    MetricsCacheService  metricsCache;
    DetectionProperties  props;
    HealthMonitorService monitor;

    @BeforeEach
    void setUp() {
        metricsCache = new MetricsCacheService();
        props        = new DetectionProperties();   // 기본값: push 3s, grace 2s, fresh 10s
        monitor      = new HealthMonitorService(nodeRepository, metricsCache, eventRepository, props, eventPublisher);
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

    @Test
    void 무응답_노드는_fault로_전이되고_이벤트가_기록된다() {
        Node n = node(Node.Role.active, OffsetDateTime.now().minusSeconds(60));
        when(nodeRepository.findAll()).thenReturn(List.of(n));

        monitor.scan();

        assertThat(n.getRole()).isEqualTo(Node.Role.fault);
        verify(nodeRepository).save(n);

        ArgumentCaptor<DetectionEvent> cap = ArgumentCaptor.forClass(DetectionEvent.class);
        verify(eventRepository).save(cap.capture());
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
