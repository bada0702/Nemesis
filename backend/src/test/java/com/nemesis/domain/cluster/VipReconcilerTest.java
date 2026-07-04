package com.nemesis.domain.cluster;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class VipReconcilerTest {

    @Mock ClusterRepository  clusterRepository;
    @Mock NodeRepository     nodeRepository;
    @Mock AgentCommandClient commandClient;
    @Mock VipService         vipService;

    VipReconciler reconciler;
    Cluster cluster;
    Node active, standby;

    private static AgentCommandClient.Result exit(int code) {
        return new AgentCommandClient.Result(code == 0, code, "", "", null);
    }

    @BeforeEach
    void setUp() {
        reconciler = new VipReconciler(clusterRepository, nodeRepository, commandClient, vipService);
        cluster = Cluster.builder().id(UUID.randomUUID()).name("c1").vip("192.168.0.100").build();
        active  = Node.builder().id(UUID.randomUUID()).cluster(cluster).hostname("m1")
                .osType(Node.OsType.LINUX).role(Node.Role.active).netIface("eth0").build();
        standby = Node.builder().id(UUID.randomUUID()).cluster(cluster).hostname("s1")
                .osType(Node.OsType.LINUX).role(Node.Role.standby).netIface("eth0").build();
    }

    @Test
    void primary에_VIP가_없으면_재적용한다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(active, standby));
        when(commandClient.execute(eq(active), contains("vip-check"))).thenReturn(exit(1));

        reconciler.reconcile(cluster);

        verify(vipService).apply(cluster.getId());
    }

    @Test
    void primary가_VIP를_보유하면_아무_것도_하지_않는다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(active, standby));
        when(commandClient.execute(any(), contains("vip-check"))).thenReturn(exit(0), exit(1));

        reconciler.reconcile(cluster);

        verify(vipService, never()).apply(any());
        verify(commandClient, never()).execute(any(), contains("vip-down"));
    }

    @Test
    void standby에_잔재_VIP가_있으면_해당_노드만_vip다운한다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(active, standby));
        when(commandClient.execute(eq(active),  contains("vip-check"))).thenReturn(exit(0));
        when(commandClient.execute(eq(standby), contains("vip-check"))).thenReturn(exit(0));
        when(commandClient.execute(eq(standby), contains("vip-down"))).thenReturn(exit(0));

        reconciler.reconcile(cluster);

        verify(vipService, never()).apply(any());
        verify(commandClient).execute(eq(standby), contains("vip-down"));
    }

    @Test
    void 통신_실패면_상태불명이므로_개입하지_않는다() {
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(active, standby));
        when(commandClient.execute(eq(active), contains("vip-check")))
                .thenReturn(AgentCommandClient.Result.transportError("connection refused"));

        reconciler.reconcile(cluster);

        verify(vipService, never()).apply(any());
        verify(commandClient, times(1)).execute(any(), anyString());
    }

    @Test
    void recovering_노드가_있으면_페일오버_중이므로_건너뛴다() {
        standby.setRole(Node.Role.recovering);
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(active, standby));

        reconciler.reconcile(cluster);

        verifyNoInteractions(commandClient, vipService);
    }

    @Test
    void VIP_미설정_클러스터는_건너뛴다() {
        cluster.setVip(null);

        reconciler.reconcile(cluster);

        verifyNoInteractions(nodeRepository, commandClient, vipService);
    }

    @Test
    void active가_없으면_개입하지_않는다() {
        active.setRole(Node.Role.fault);
        when(nodeRepository.findByClusterId(cluster.getId())).thenReturn(List.of(active, standby));

        reconciler.reconcile(cluster);

        verifyNoInteractions(commandClient, vipService);
    }
}
