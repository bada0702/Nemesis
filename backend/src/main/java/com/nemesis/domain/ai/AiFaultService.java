package com.nemesis.domain.ai;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AiFaultService {

    private static final int COOLDOWN_MINUTES = 5;

    private final MetricsCacheService       metricsCache;
    private final NodeRepository            nodeRepository;
    private final ClusterRepository         clusterRepository;
    private final AiFaultAnalysisRepository analysisRepository;
    private final LlmService                llmService;

    /**
     * 자기 자신의 프록시 참조(M-2 수정). @Async 메서드에서 doAnalyze를 직접 호출하면
     * 자기호출이라 @Transactional이 무시된다. 프록시를 통해 호출해 트랜잭션을 유효화한다.
     */
    @Autowired @Lazy
    private AiFaultService self;

    @Async
    public void analyzeAsync(UUID nodeId) {
        if (isCooldownActive(nodeId)) {
            log.debug("AI 분석 쿨다운 중, 노드: {}", nodeId);
            return;
        }
        try {
            self.doAnalyze(nodeId, "AUTO"); // 프록시 경유 → @Transactional 적용
        } catch (Exception e) {
            log.error("자동 AI 분석 실패, 노드: {}", nodeId, e);
        }
    }

    @Transactional
    public AiFaultAnalysis analyzeManual(UUID nodeId) {
        return doAnalyze(nodeId, "MANUAL");
    }

    @Transactional
    public Optional<AiFaultAnalysis> getLatest(UUID nodeId) {
        return analysisRepository.findTopByNodeIdOrderByCreatedAtDesc(nodeId);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> analyzeCluster(UUID clusterId) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        List<Node> nodes = nodeRepository.findByClusterId(clusterId);
        long faults = nodes.stream().filter(n -> n.getRole() == Node.Role.fault).count();

        String prompt = String.format(
                "클러스터 '%s' (VIP: %s) 상태: 전체 노드 %d개 중 장애 %d개. " +
                "노드 목록: %s. " +
                "장애 원인을 한국어로 분석하고 복구 절차를 제시하라.",
                cluster.getName(), cluster.getVip(),
                nodes.size(), faults,
                nodes.stream()
                     .map(n -> n.getHostname() + "(" + n.getRole() + ")")
                     .collect(Collectors.joining(", "))
        );

        Map<String, Object> result = llmService.analyze(prompt);
        String severity = faults > 0 ? "critical" : "normal";
        return Map.of("status", "success", "analysis", result.get("rootCause"), "severity", severity);
    }

    private boolean isCooldownActive(UUID nodeId) {
        return analysisRepository.existsByNodeIdAndCreatedAtAfter(
            nodeId, OffsetDateTime.now().minusMinutes(COOLDOWN_MINUTES)
        );
    }

    @Transactional
    public AiFaultAnalysis doAnalyze(UUID nodeId, String triggerType) {
        Node node = nodeRepository.findById(nodeId)
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));

        MetricsPushRequest metrics = metricsCache.get(nodeId)
                .orElseThrow(() -> new IllegalStateException("No cached metrics for node: " + nodeId));

        List<String> errorLogs = metrics.getErrorLogPreview();
        if (errorLogs == null || errorLogs.isEmpty()) {
            throw new IllegalStateException("에러 로그가 없습니다.");
        }

        AiFaultAnalysis analysis = AiFaultAnalysis.builder()
                .node(node)
                .errorLogs(String.join("\n", errorLogs))
                .triggerType(triggerType)
                .status("ANALYZING")
                .build();
        analysis = analysisRepository.save(analysis);

        try {
            Map<String, Object> result = llmService.analyze(analysis.getErrorLogs());
            analysis.setRootCause((String) result.get("rootCause"));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> fixCmds = (List<Map<String, Object>>) result.get("fixCommands");
            analysis.setFixCommands(fixCmds != null ? fixCmds : List.of());
            analysis.setStatus("DONE");
        } catch (Exception e) {
            log.error("AI 분석 실패, 노드: {}", nodeId, e);
            analysis.setRootCause("분석 실패: " + e.getMessage());
            analysis.setFixCommands(List.of());
            analysis.setStatus("FAILED");
        }

        return analysisRepository.save(analysis);
    }
}
