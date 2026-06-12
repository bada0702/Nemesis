package com.nemesis.cluster;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ClusterControllerTest {

    @Autowired MockMvc            mockMvc;
    @Autowired ObjectMapper       objectMapper;
    @Autowired ClusterRepository  clusterRepository;
    @Autowired AgentKeyRepository agentKeyRepository;
    @Autowired NodeRepository     nodeRepository;

    @BeforeEach
    void setUp() {
        agentKeyRepository.deleteAll();
        nodeRepository.deleteAll();
        clusterRepository.deleteAll();
    }

    @Test
    void 클러스터_생성_성공() throws Exception {
        Map<String, Object> body = Map.of(
                "name", "민원시스템",
                "vip", "192.168.1.100",
                "description", "민원처리 HA 클러스터"
        );

        mockMvc.perform(post("/api/clusters")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.name").value("민원시스템"));
    }

    @Test
    void 클러스터_목록_조회() throws Exception {
        mockMvc.perform(post("/api/clusters")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "클러스터A"))))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/clusters"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("클러스터A"));
    }

    @Test
    void 최대_10개_초과_생성_실패() throws Exception {
        for (int i = 0; i < 10; i++) {
            mockMvc.perform(post("/api/clusters")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "클러스터" + i))))
                    .andExpect(status().isCreated());
        }

        mockMvc.perform(post("/api/clusters")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "클러스터10"))))
                .andExpect(status().isBadRequest());
    }
}
