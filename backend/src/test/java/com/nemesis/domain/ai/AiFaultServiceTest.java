package com.nemesis.domain.ai;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AiFaultServiceTest {

    @Mock MetricsCacheService       metricsCache;
    @Mock NodeRepository            nodeRepository;
    @Mock ClusterRepository         clusterRepository;
    @Mock AiFaultAnalysisRepository analysisRepository;
    @Mock LlmService                llmService;

    @InjectMocks AiFaultService svc;

    @Test
    void 메트릭_없는_장애노드도_상태컨텍스트로_분석된다() {   // "No cached metrics" 하드실패 회귀 방지
        UUID id = UUID.randomUUID();
        Node n = Node.builder().id(id).hostname("db2").role(Node.Role.fault)
                .ipAddress("10.0.0.2").lastSeenAt(OffsetDateTime.now().minusMinutes(5)).build();
        when(nodeRepository.findById(id)).thenReturn(Optional.of(n));
        when(metricsCache.get(id)).thenReturn(Optional.empty());           // 장애 노드: 캐시 메트릭 없음
        when(analysisRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(llmService.analyze(anyString())).thenReturn(Map.of(
                "rootCause", "노드 무응답 — 에이전트/전원 점검 필요", "fixCommands", List.of()));

        AiFaultAnalysis out = svc.doAnalyze(id, "MANUAL");   // 예외 없이 분석 완료돼야 한다

        assertThat(out.getStatus()).isEqualTo("DONE");
        assertThat(out.getRootCause()).contains("노드 무응답");
        verify(llmService).analyze(contains("db2"));         // 노드 상태로 분석 입력 구성
    }
}
