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

        // 장애·무응답 노드는 캐시 메트릭이나 에러 로그가 없을 수 있다(바로 그때가 분석이
        // 가장 필요한 시점이다). 하드 실패 대신 가용한 노드 상태로 분석 입력을 구성해
        // 다운된 노드도 진단 가능하게 한다.
        MetricsPushRequest metrics = metricsCache.get(nodeId).orElse(null);
        String analysisInput = buildAnalysisInput(node, metrics);

        AiFaultAnalysis analysis = AiFaultAnalysis.builder()
                .node(node)
                .errorLogs(analysisInput)
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

    /**
     * LLM 분석 입력 구성. 에이전트 에러 로그가 있으면 그것을 쓰고, 없으면(장애·무응답 노드)
     * 노드 상태(role/ip/마지막 보고/자원)를 컨텍스트로 구성해 다운 노드도 진단할 수 있게 한다.
     */
    private String buildAnalysisInput(Node node, MetricsPushRequest metrics) {
        List<String> logs = metrics != null ? metrics.getErrorLogPreview() : null;
        if (logs != null && !logs.isEmpty()) {
            return String.join("\n", logs);
        }
        StringBuilder sb = new StringBuilder();
        sb.append("노드 ").append(node.getHostname())
          .append(" (role=").append(node.getRole())
          .append(", ip=").append(node.getIpAddress() != null ? node.getIpAddress() : "?").append(")\n");
        if (metrics == null) {
            sb.append("에이전트 메트릭 수신 없음 — 노드 무응답/다운 상태로 추정됨.\n");
            sb.append(node.getLastSeenAt() != null
                    ? "마지막 정상 보고: " + node.getLastSeenAt() + "\n"
                    : "등록 후 한 번도 보고한 적 없음.\n");
        } else {
            sb.append(String.format("자원: CPU %.0f%%, MEM %.0f%%, DISK %.0f%%. 별도 에러 로그 없음.%n",
                    metrics.getCpuPercent(), metrics.getMemoryPercent(), metrics.getDiskPercent()));
        }
        sb.append("위 장애 상황의 가능한 원인과 복구 절차를 진단하라.");
        return sb.toString();
    }
}
