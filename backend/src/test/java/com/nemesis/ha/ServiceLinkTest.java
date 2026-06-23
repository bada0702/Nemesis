package com.nemesis.ha;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.ha.ServiceLinkCache;
import com.nemesis.domain.ha.ServiceLinkProber;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.net.ServerSocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ServiceLinkTest {

    @Autowired MockMvc           mockMvc;
    @Autowired ClusterRepository clusterRepository;
    @Autowired NodeRepository    nodeRepository;
    @Autowired ServiceLinkCache  serviceLinkCache;

    @Test
    void 열린_포트는_ALIVE_닫힌_포트는_DEAD로_측정된다() throws Exception {
        try (ServerSocket open = new ServerSocket(0)) {
            int openPort = open.getLocalPort();
            ServiceLinkCache.Entry alive = ServiceLinkProber.probe("127.0.0.1", openPort);
            assertThat(alive.status()).isIn("ALIVE", "SLOW");
            assertThat(alive.latencyMs()).isNotNull();
        }
        // 방금 닫힌(또는 사용되지 않는) 포트로는 연결 실패 → DEAD
        ServiceLinkCache.Entry dead = ServiceLinkProber.probe("127.0.0.1", 1);
        assertThat(dead.status()).isEqualTo("DEAD");

        ServiceLinkCache.Entry blank = ServiceLinkProber.probe("", 17001);
        assertThat(blank.status()).isEqualTo("DEAD");
    }

    @Test
    void heartbeat_엔드포인트가_노드별_serviceLink를_노출한다() throws Exception {
        Cluster cluster = clusterRepository.save(Cluster.builder().name("serviceLink테스트").build());
        Node node = nodeRepository.save(Node.builder()
                .cluster(cluster).hostname("svc-node").osType(Node.OsType.LINUX).build());

        // 캐시에 ALIVE 를 직접 주입(프로버 스케줄과 무관하게 결정적으로 검증)
        serviceLinkCache.put(node.getId(),
                new ServiceLinkCache.Entry("ALIVE", 7, System.currentTimeMillis()));

        mockMvc.perform(get("/api/ha/heartbeat/" + cluster.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[?(@.hostname=='svc-node')].serviceLink.status").value("ALIVE"))
                .andExpect(jsonPath("$.nodes[?(@.hostname=='svc-node')].serviceLink.latencyMs").value(7));
    }
}
