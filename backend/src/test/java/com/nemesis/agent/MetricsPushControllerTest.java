package com.nemesis.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.agent.AgentKey;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MetricsPushControllerTest {

    @Autowired MockMvc            mockMvc;
    @Autowired ObjectMapper       objectMapper;
    @Autowired ClusterRepository  clusterRepository;
    @Autowired AgentKeyRepository agentKeyRepository;
    @Autowired NodeRepository     nodeRepository;

    private static final String VALID_KEY = "nmss-metrics-test-key";

    @BeforeEach
    void setUp() {
        agentKeyRepository.deleteAll();
        nodeRepository.deleteAll();
        clusterRepository.deleteAll();

        Cluster cluster = clusterRepository.save(
                Cluster.builder().name("메트릭테스트").build());

        Node node = nodeRepository.save(Node.builder()
                .cluster(cluster)
                .hostname("server01")
                .osType(Node.OsType.LINUX)
                .build());

        agentKeyRepository.save(AgentKey.builder()
                .cluster(cluster)
                .apiKey(VALID_KEY)
                .node(node)
                .build());
    }

    @Test
    void 유효한_키로_메트릭_Push_성공() throws Exception {
        MetricsPushRequest req = new MetricsPushRequest();
        req.setHostname("server01");
        req.setTimestamp(System.currentTimeMillis());
        req.setCpuPercent(45.2);
        req.setMemoryPercent(60.0);
        req.setMemoryUsedMb(4096);
        req.setMemoryTotalMb(8192);
        req.setDiskPercent(30.5);
        req.setErrorLogPreview(List.of("2026-06-06 ERROR: test"));

        mockMvc.perform(post("/api/agent/metrics")
                        .header("Authorization", "Bearer " + VALID_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk());
    }

    @Test
    void Authorization_헤더_없으면_401() throws Exception {
        MetricsPushRequest req = new MetricsPushRequest();
        req.setHostname("server01");
        req.setTimestamp(System.currentTimeMillis());

        mockMvc.perform(post("/api/agent/metrics")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isUnauthorized());
    }
}
