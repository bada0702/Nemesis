package com.nemesis.node;

import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 존재하지 않는 노드 삭제는 404여야 한다(과거 401 → 프론트 강제 로그아웃 버그 회귀 방지).
 * GlobalExceptionHandler가 IllegalArgumentException을 NOT_FOUND로 매핑하는지 검증.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NodeDeleteErrorTest {

    @Autowired MockMvc            mockMvc;
    @Autowired ClusterRepository  clusterRepository;
    @Autowired NodeRepository     nodeRepository;
    @Autowired AgentKeyRepository agentKeyRepository;

    @BeforeEach
    void setUp() {
        agentKeyRepository.deleteAll();
        nodeRepository.deleteAll();
        clusterRepository.deleteAll();
    }

    @Test
    void 존재하지_않는_노드_삭제는_404() throws Exception {
        Cluster cluster = clusterRepository.save(Cluster.builder().name("bot-ha").build());

        mockMvc.perform(delete("/api/clusters/{cid}/nodes/{nid}",
                        cluster.getId(), UUID.randomUUID()))
                .andExpect(status().isNotFound());
    }
}
