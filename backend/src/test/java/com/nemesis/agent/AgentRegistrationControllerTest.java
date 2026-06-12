package com.nemesis.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.agent.AgentKey;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.dto.AgentRegisterRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AgentRegistrationControllerTest {

    @Autowired MockMvc             mockMvc;
    @Autowired ObjectMapper        objectMapper;
    @Autowired ClusterRepository   clusterRepository;
    @Autowired AgentKeyRepository  agentKeyRepository;

    private Cluster  testCluster;

    @BeforeEach
    void setUp() {
        agentKeyRepository.deleteAll();
        clusterRepository.deleteAll();

        testCluster = clusterRepository.save(
                Cluster.builder().name("테스트클러스터").vip("192.168.1.100").build());

        agentKeyRepository.save(
                AgentKey.builder().cluster(testCluster).apiKey("nmss-test-key-12345").build());
    }

    @Test
    void 유효한_키로_에이전트_등록_성공() throws Exception {
        AgentRegisterRequest req = new AgentRegisterRequest();
        req.setApiKey("nmss-test-key-12345");
        req.setHostname("server01");
        req.setOs("LINUX");
        req.setVersion("1.0.0");
        req.setServiceIp("192.168.1.101");

        mockMvc.perform(post("/api/agent/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clusterId").value(testCluster.getId().toString()))
                .andExpect(jsonPath("$.clusterName").value("테스트클러스터"))
                .andExpect(jsonPath("$.role").exists());
    }

    @Test
    void 유효하지_않은_키로_등록_실패() throws Exception {
        AgentRegisterRequest req = new AgentRegisterRequest();
        req.setApiKey("invalid-key");
        req.setHostname("server99");
        req.setOs("LINUX");
        req.setVersion("1.0.0");

        mockMvc.perform(post("/api/agent/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void hostname_누락_시_등록_실패() throws Exception {
        AgentRegisterRequest req = new AgentRegisterRequest();
        req.setApiKey("nmss-test-key-12345");
        req.setOs("LINUX");
        req.setVersion("1.0.0");
        // hostname 의도적으로 누락

        mockMvc.perform(post("/api/agent/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest());
    }
}
