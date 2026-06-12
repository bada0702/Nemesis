package com.nemesis.catalog;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import com.nemesis.domain.catalog.ServiceCatalogService;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ServiceCatalogServiceTest {

    @Mock ManagedServiceRepository serviceRepository;
    @Mock ClusterRepository        clusterRepository;
    @Mock NodeRepository           nodeRepository;

    MetricsCacheService   metricsCache;
    DetectionProperties   props;
    ServiceCatalogService catalog;

    Cluster cluster;
    Node node1, node2;

    @BeforeEach
    void setUp() {
        metricsCache = new MetricsCacheService();
        props        = new DetectionProperties();
        catalog      = new ServiceCatalogService(serviceRepository, clusterRepository, nodeRepository, metricsCache, props);

        cluster = Cluster.builder().id(UUID.randomUUID()).name("prod").build();
        node1   = Node.builder().id(UUID.randomUUID()).cluster(cluster).hostname("node1").osType(Node.OsType.LINUX).build();
        node2   = Node.builder().id(UUID.randomUUID()).cluster(cluster).hostname("node2").osType(Node.OsType.LINUX).build();

        when(clusterRepository.findById(cluster.getId())).thenReturn(Optional.of(cluster));
    }

    private void pushProcesses(Node node, List<Map<String, String>> processes) {
        MetricsPushRequest m = new MetricsPushRequest();
        m.setProcesses(processes);
        metricsCache.put(node.getId(), m);
    }

    @Test
    void 스캔은_두_노드의_같은_SW를_논리서비스_1건으로_병합한다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(node1, node2));
        when(serviceRepository.existsByClusterIdAndName(any(), any())).thenReturn(false);
        pushProcesses(node1, List.of(Map.of("name", "mysqld", "pid", "100")));
        pushProcesses(node2, List.of(Map.of("name", "mysqld", "pid", "200")));

        Map<String, Object> result = catalog.scan(cluster.getId());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> proposals = (List<Map<String, Object>>) result.get("proposals");
        assertThat(proposals).hasSize(1);
        assertThat(proposals.get(0).get("displayName")).isEqualTo("MySQL");
        assertThat(proposals.get(0).get("type")).isEqualTo("DB");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> nodes = (List<Map<String, Object>>) proposals.get(0).get("nodes");
        assertThat(nodes).hasSize(2);
    }

    @Test
    void 스캔은_미보고_노드를_staleNodes로_보고한다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(node1, node2));
        pushProcesses(node1, List.of(Map.of("name", "nginx", "pid", "1")));
        // node2는 메트릭 미수신

        Map<String, Object> result = catalog.scan(cluster.getId());

        @SuppressWarnings("unchecked")
        List<String> staleNodes = (List<String>) result.get("staleNodes");
        assertThat(staleNodes).containsExactly("node2");
    }

    @Test
    void 알수없는_프로세스는_unknown으로_분류된다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(node1));
        when(serviceRepository.existsByClusterIdAndName(any(), any())).thenReturn(false);
        pushProcesses(node1, List.of(Map.of("name", "my_custom_app", "pid", "5")));

        Map<String, Object> result = catalog.scan(cluster.getId());

        assertThat((List<?>) result.get("proposals")).isEmpty();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> unknown = (List<Map<String, Object>>) result.get("unknown");
        assertThat(unknown).hasSize(1);
        assertThat(unknown.get(0).get("name")).isEqualTo("my_custom_app");
    }

    @Test
    void 카탈로그는_노드별_실시간_RUNNING_STOPPED를_계산한다() {
        ManagedService svc = ManagedService.builder()
                .id(UUID.randomUUID()).cluster(cluster)
                .name("mysqld").displayName("MySQL").type(ManagedService.Type.DB).build();
        when(serviceRepository.findByClusterIdOrderByTypeAscDisplayNameAsc(cluster.getId()))
                .thenReturn(List.of(svc));
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(node1, node2));
        pushProcesses(node1, List.of(Map.of("name", "mysqld", "pid", "100")));
        pushProcesses(node2, List.of(Map.of("name", "nginx", "pid", "7")));

        List<Map<String, Object>> items = catalog.catalog(cluster.getId());

        assertThat(items).hasSize(1);
        assertThat(items.get(0).get("runningCount")).isEqualTo(1);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> instances = (List<Map<String, Object>>) items.get(0).get("instances");
        assertThat(instances.get(0).get("state")).isEqualTo("RUNNING");
        assertThat(instances.get(0).get("pid")).isEqualTo(100);
        assertThat(instances.get(1).get("state")).isEqualTo("STOPPED");
    }

    @Test
    void 일괄등록은_중복을_건너뛰고_신규만_저장한다() {
        when(serviceRepository.existsByClusterIdAndName(cluster.getId(), "mysqld")).thenReturn(true);
        when(serviceRepository.existsByClusterIdAndName(cluster.getId(), "nginx")).thenReturn(false);

        int count = catalog.register(cluster.getId(), List.of(
                Map.of("name", "mysqld", "displayName", "MySQL", "type", "DB"),
                Map.of("name", "nginx",  "displayName", "Nginx", "type", "WEB", "haManaged", true)
        ));

        assertThat(count).isEqualTo(1);
        ArgumentCaptor<ManagedService> captor = ArgumentCaptor.forClass(ManagedService.class);
        verify(serviceRepository).save(captor.capture());
        assertThat(captor.getValue().getName()).isEqualTo("nginx");
        assertThat(captor.getValue().isHaManaged()).isTrue();
    }
}
