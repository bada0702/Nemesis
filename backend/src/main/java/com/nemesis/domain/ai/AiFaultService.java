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

    private static final double RESOURCE_WARN_PCT = 85.0;

    @Transactional(readOnly = true)
    public Map<String, Object> analyzeCluster(UUID clusterId) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        List<Node> nodes = nodeRepository.findByClusterId(clusterId);
        long faults = nodes.stream().filter(n -> n.getRole() == Node.Role.fault).count();

        // 노드 역할만 넘기던 과거 프롬프트는 입력이 빈약해 결과도 한 줄짜리였다.
        // 자원·상태·에러로그를 포함한 상세 컨텍스트를 구성해 진단 품질을 높인다.
        boolean anyHigh = false;
        StringBuilder ctx = new StringBuilder();
        ctx.append(String.format("클러스터 '%s' (VIP: %s) — 전체 노드 %d개, 장애(fault) %d개.%n",
                cluster.getName(), cluster.getVip() != null ? cluster.getVip() : "없음", nodes.size(), faults));
        for (Node n : nodes) {
            MetricsPushRequest m = metricsCache.get(n.getId()).orElse(null);
            ctx.append(String.format("- %s: role=%s, ip=%s", n.getHostname(), n.getRole(),
                    n.getIpAddress() != null ? n.getIpAddress() : "?"));
            if (m != null) {
                ctx.append(String.format(", CPU %.0f%%, MEM %.0f%%, DISK %.0f%%",
                        m.getCpuPercent(), m.getMemoryPercent(), m.getDiskPercent()));
                if (m.getCpuPercent() >= RESOURCE_WARN_PCT || m.getMemoryPercent() >= RESOURCE_WARN_PCT
                        || m.getDiskPercent() >= RESOURCE_WARN_PCT) anyHigh = true;
                List<String> errs = m.getErrorLogPreview();
                if (errs != null && !errs.isEmpty())
                    ctx.append("\n  최근 에러로그: ").append(String.join(" | ",
                            errs.subList(0, Math.min(3, errs.size()))));
            } else {
                ctx.append(", 메트릭 수신 없음(무응답/다운 추정)");
            }
            ctx.append(String.format(", 마지막 보고=%s%n",
                    n.getLastSeenAt() != null ? n.getLastSeenAt() : "기록 없음"));
        }
        ctx.append("위 상태를 진단하라.");

        String analysis = llmService.analyzeClusterHealth(ctx.toString());
        if (analysis == null || analysis.isBlank()) analysis = ruleBasedClusterSummary(nodes, faults, anyHigh);

        String severity = faults > 0 ? "critical" : (anyHigh ? "warning" : "ok");
        return Map.of("status", "success", "analysis", analysis, "severity", severity);
    }

    /** LLM 미설정/실패 시 규칙 기반 요약(빈약하지 않게 노드별 상태와 권장 조치를 채운다). */
    private String ruleBasedClusterSummary(List<Node> nodes, long faults, boolean anyHigh) {
        StringBuilder sb = new StringBuilder();
        sb.append("[종합 상태] ");
        if (faults > 0)      sb.append("위험 — 장애 노드 ").append(faults).append("개 감지됨.\n");
        else if (anyHigh)    sb.append("주의 — 자원 사용률이 높은 노드가 있습니다.\n");
        else                 sb.append("정상 — 장애 노드 없음, 자원 여유 있음.\n");
        sb.append("[노드별 관찰]\n");
        for (Node n : nodes) {
            MetricsPushRequest m = metricsCache.get(n.getId()).orElse(null);
            sb.append("- ").append(n.getHostname()).append(" (").append(n.getRole()).append("): ");
            sb.append(m == null ? "메트릭 수신 없음(무응답 추정)"
                    : String.format("CPU %.0f%% / MEM %.0f%% / DISK %.0f%%",
                        m.getCpuPercent(), m.getMemoryPercent(), m.getDiskPercent()));
            sb.append("\n");
        }
        sb.append("[근본 원인 / 위험 요인] ");
        sb.append(faults > 0 ? "장애 노드의 heartbeat 미수신 — 전원/네트워크/에이전트 점검 필요.\n"
                : anyHigh ? "자원 임계 근접 — 부하 원인 프로세스 확인 권장.\n" : "특이사항 없음.\n");
        sb.append("[권장 조치]\n");
        if (faults > 0) {
            sb.append("1. 장애 노드의 전원·네트워크·에이전트 상태를 확인하세요.\n");
            sb.append("2. 복구가 어려우면 Standby로 수동 전환(Failover)을 검토하세요.\n");
            sb.append("3. 복구 후 동기화 상태와 VIP 위치를 확인하세요.\n");
        } else if (anyHigh) {
            sb.append("1. 자원 사용률이 높은 노드에서 상위 프로세스를 확인하세요(Runbook Health Check).\n");
            sb.append("2. 필요 시 서비스 재시작 또는 부하 분산을 검토하세요.\n");
        } else {
            sb.append("1. 추가 조치 불필요. 정기 점검을 유지하세요.\n");
        }
        sb.append("(참고: LLM 미설정/응답 불가로 규칙 기반 요약을 제공했습니다. 시스템 설정에서 분석 모델을 지정하면 상세 분석이 가능합니다.)");
        return sb.toString();
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
