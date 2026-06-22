package com.nemesis.domain.dashboard;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.alert.AlertRuleRepository;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/** getDockerStatus 가 docker-ps TSV를 파싱해 running/total 을 집계하고,
 *  docker 미설치 노드는 supported=false 로 graceful 처리하는지 검증. */
class DashboardServiceDockerTest {

    private final ClusterRepository   clusterRepo = mock(ClusterRepository.class);
    private final NodeRepository      nodeRepo    = mock(NodeRepository.class);
    private final AgentKeyRepository  keyRepo     = mock(AgentKeyRepository.class);
    private final MetricsCacheService cache       = mock(MetricsCacheService.class);
    private final AlertRuleRepository alertRepo   = mock(AlertRuleRepository.class);
    private final AgentCommandClient  cmd         = mock(AgentCommandClient.class);
    private final DashboardService svc =
            new DashboardService(clusterRepo, nodeRepo, keyRepo, cache, alertRepo, cmd);

    private Node node(String host, String ip) {
        Node n = new Node(); n.setId(UUID.randomUUID()); n.setHostname(host); n.setServiceIp(ip);
        return n;
    }

    @Test
    @SuppressWarnings("unchecked")
    void countsRunningAndTotal_andMarksUnsupportedNodeGracefully() {
        Node ok  = node("bot", "192.168.0.17");
        Node bad = node("bot-02", "172.18.0.50");
        when(nodeRepo.findAll()).thenReturn(List.of(ok, bad));
        // docker-ps TSV: name<tab>image<tab>status<tab>ports<tab>created, 이어서 ---STATS--- 섹션
        String psOut = "web\tnginx\trunning\t80\t1h\n"
                     + "db\tpostgres\trunning\t5432\t2h\n"
                     + "old\tbusybox\texited\t\t3d\n"
                     + "---STATS---\n"
                     + "web\t1.0%\t10MB\n";   // 통계 섹션은 컨테이너 집계에서 제외돼야 함
        when(cmd.execute(eq(ok), eq("control.sh docker-ps")))
                .thenReturn(new AgentCommandClient.Result(true, 0, psOut, "", null));
        when(cmd.execute(eq(bad), eq("control.sh docker-ps")))
                .thenReturn(new AgentCommandClient.Result(false, 1, "", "docker 미설치", null));

        Map<String, Object> res = svc.getDockerStatus();

        assertThat(res.get("supported")).isEqualTo(true);
        List<Map<String, Object>> nodes = (List<Map<String, Object>>) res.get("nodes");
        Map<String, Object> n0 = nodes.get(0);
        assertThat(n0.get("supported")).isEqualTo(true);
        assertThat(n0.get("totalContainers")).isEqualTo(3);   // ---STATS--- 이후 줄 제외
        assertThat(n0.get("runningContainers")).isEqualTo(2);
        assertThat(n0.get("status")).isEqualTo("정상");

        Map<String, Object> n1 = nodes.get(1);
        assertThat(n1.get("supported")).isEqualTo(false);
        assertThat(n1.get("runningContainers")).isNull();
    }
}
