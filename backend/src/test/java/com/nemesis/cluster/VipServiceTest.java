package com.nemesis.cluster;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.cluster.VipService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class VipServiceTest {

    @Mock ClusterRepository  clusterRepository;
    @Mock NodeRepository     nodeRepository;
    @Mock AgentCommandClient commandClient;

    VipService vipService;

    Cluster cluster;
    Node primary, standby;

    @BeforeEach
    void setUp() {
        vipService = new VipService(clusterRepository, nodeRepository, commandClient);
        cluster = Cluster.builder().id(UUID.randomUUID()).name("prod")
                .vip("10.0.0.100").vipCidr(24).build();
        primary = Node.builder().id(UUID.randomUUID()).cluster(cluster).hostname("node1")
                .osType(Node.OsType.LINUX).role(Node.Role.active).netIface("eth0").build();
        standby = Node.builder().id(UUID.randomUUID()).cluster(cluster).hostname("node2")
                .osType(Node.OsType.LINUX).role(Node.Role.standby).netIface("eth0").build();
        when(clusterRepository.findById(cluster.getId())).thenReturn(Optional.of(cluster));
    }

    private AgentCommandClient.Result ok() {
        return new AgentCommandClient.Result(true, 0, "", "", null);
    }

    @Test
    void 적용은_primary에_vipUp_standby에_vipDown을_실행한다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(primary, standby));
        when(commandClient.execute(any(), anyString())).thenReturn(ok());

        Map<String, Object> result = vipService.apply(cluster.getId());

        assertThat(result.get("applied")).isEqualTo(true);
        verify(commandClient).execute(eq(primary), eq("control.sh vip-up eth0 10.0.0.100 24"));
        verify(commandClient).execute(eq(standby), eq("control.sh vip-down eth0 10.0.0.100 24"));
    }

    @Test
    void VIP_미설정_클러스터는_예외를_던진다() {
        cluster.setVip(null);

        assertThatThrownBy(() -> vipService.apply(cluster.getId()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void primary_적용_실패면_applied가_false다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(primary));
        when(commandClient.execute(eq(primary), anyString()))
                .thenReturn(new AgentCommandClient.Result(false, 1, "", "iface down", null));

        Map<String, Object> result = vipService.apply(cluster.getId());

        assertThat(result.get("applied")).isEqualTo(false);
    }

    @Test
    void 상태점검은_vipCheck_종료코드로_존재여부를_판정한다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(primary, standby));
        when(commandClient.execute(eq(primary), eq("control.sh vip-check 10.0.0.100"))).thenReturn(ok());
        when(commandClient.execute(eq(standby), eq("control.sh vip-check 10.0.0.100")))
                .thenReturn(new AgentCommandClient.Result(false, 1, "", "", null));

        Map<String, Object> result = vipService.status(cluster.getId());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> nodes = (List<Map<String, Object>>) result.get("nodes");
        assertThat(nodes.get(0).get("vipPresent")).isEqualTo(true);
        assertThat(nodes.get(1).get("vipPresent")).isEqualTo(false);
    }
}
