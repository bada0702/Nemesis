package com.nemesis.domain.node;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.dto.ClusterStatusResponse;
import com.nemesis.dto.MetricsPushRequest;
import com.nemesis.domain.cluster.VipService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class NodeServiceStatusTest {
    /** status 응답이 실통신 IP(serviceIp)를 포함해야 한다 — 화면이 ip_address(유령값) 대신 실제 통신 IP를 보여주도록. */
    @Test void clusterStatusIncludesServiceIp() {
        NodeRepository nodeRepo = mock(NodeRepository.class);
        ClusterRepository clusterRepo = mock(ClusterRepository.class);
        MetricsCacheService cache = mock(MetricsCacheService.class);
        VipService vip = mock(VipService.class);
        NodeService svc = new NodeService(nodeRepo, clusterRepo, cache, new DetectionProperties(), vip);

        UUID cid = UUID.randomUUID(), nid = UUID.randomUUID();
        Cluster c = mock(Cluster.class);
        when(c.getId()).thenReturn(cid); when(c.getName()).thenReturn("bot-ha"); when(c.getVip()).thenReturn("192.168.0.100");
        when(clusterRepo.findById(cid)).thenReturn(Optional.of(c));

        Node n = mock(Node.class);
        when(n.getId()).thenReturn(nid);
        when(n.getHostname()).thenReturn("bot-02");
        when(n.getIpAddress()).thenReturn("192.168.0.18");   // UI 표시용(유령)
        when(n.getServiceIp()).thenReturn("172.18.0.50");    // 실제 통신
        when(n.getOsType()).thenReturn(Node.OsType.LINUX);
        when(n.getRole()).thenReturn(Node.Role.standby);
        when(nodeRepo.findByClusterId(cid)).thenReturn(List.of(n));
        when(cache.get(any(UUID.class))).thenReturn(Optional.<MetricsPushRequest>empty());

        ClusterStatusResponse r = svc.getClusterStatus(cid);
        ClusterStatusResponse.NodeStatus ns = r.getNodes().get(0);
        assertThat(ns.getServiceIp()).isEqualTo("172.18.0.50");
        assertThat(ns.getIpAddress()).isEqualTo("192.168.0.18");
    }
}
