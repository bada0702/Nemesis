package com.nemesis.domain.dashboard;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class DashboardService {

    private final ClusterRepository clusterRepository;
    private final NodeRepository nodeRepository;
    private final AgentKeyRepository agentKeyRepository;
    private final MetricsCacheService metricsCache;

    @Transactional(readOnly = true)
    public DashboardSummaryDto getSummary() {
        long clusterCount = clusterRepository.count();
        List<Node> allNodes = nodeRepository.findAll();
        long activeNodeCount = allNodes.stream()
                .filter(n -> n.getRole() == Node.Role.active).count();
        long vipCount = clusterRepository.findAll().stream()
                .filter(c -> c.getVip() != null && !c.getVip().isBlank()).count();
        long agentCount = agentKeyRepository.count();
        long issueCount = allNodes.stream()
                .filter(n -> n.getRole() == Node.Role.fault).count();

        return DashboardSummaryDto.builder()
                .clusterCount((int) clusterCount)
                .activeNodeCount((int) activeNodeCount)
                .issueWaitingCount((int) issueCount)
                .vipCount((int) vipCount)
                .agentCount((int) agentCount)
                .lastUpdatedAt(OffsetDateTime.now())
                .build();
    }

    public DashboardPerformanceDto getPerformance() {
        var allMetrics = metricsCache.getAll().values();
        if (allMetrics.isEmpty()) {
            return DashboardPerformanceDto.builder()
                    .avgCpuPercent(0).avgMemoryPercent(0).avgDiskPercent(0)
                    .timeline(List.of())
                    .build();
        }
        double avgCpu  = allMetrics.stream().mapToDouble(MetricsPushRequest::getCpuPercent).average().orElse(0);
        double avgMem  = allMetrics.stream().mapToDouble(MetricsPushRequest::getMemoryPercent).average().orElse(0);
        double avgDisk = allMetrics.stream().mapToDouble(MetricsPushRequest::getDiskPercent).average().orElse(0);

        var timePoint = DashboardPerformanceDto.TimePoint.builder()
                .timestamp(System.currentTimeMillis())
                .avgCpu(round1(avgCpu))
                .avgMem(round1(avgMem))
                .build();

        return DashboardPerformanceDto.builder()
                .avgCpuPercent(round1(avgCpu))
                .avgMemoryPercent(round1(avgMem))
                .avgDiskPercent(round1(avgDisk))
                .timeline(List.of(timePoint))
                .build();
    }

    public DashboardSwStatusDto getSwStatus() {
        var allMetrics = metricsCache.getAll();
        List<DashboardSwStatusDto.SwItem> items = new ArrayList<>();

        allMetrics.forEach((nodeId, metrics) ->
            nodeRepository.findById(nodeId).ifPresent(node -> {
                if (metrics.getProcesses() != null) {
                    metrics.getProcesses().forEach(proc -> {
                        String name   = proc.getOrDefault("name", "unknown");
                        String status = proc.getOrDefault("status", "running");
                        items.add(DashboardSwStatusDto.SwItem.builder()
                                .name(name)
                                .type(inferType(name))
                                .state(status)
                                .node(node.getHostname())
                                .build());
                    });
                }
            })
        );

        return DashboardSwStatusDto.builder().items(items).build();
    }

    @Transactional(readOnly = true)
    public AlertDto getAlerts() {
        List<Node> nodes = nodeRepository.findAll();
        List<AlertDto.AlertItem> items = new ArrayList<>();
        String now = OffsetDateTime.now().toString();

        nodes.forEach(node -> {
            if (node.getRole() == Node.Role.fault) {
                items.add(AlertDto.AlertItem.builder()
                        .level("CRITICAL")
                        .message(node.getHostname() + " 노드 장애 감지")
                        .createdAt(now)
                        .build());
            }
            metricsCache.get(node.getId()).ifPresent(m -> {
                if (m.getCpuPercent() > 85)
                    items.add(AlertDto.AlertItem.builder().level("WARNING")
                            .message(node.getHostname() + " CPU " + Math.round(m.getCpuPercent()) + "% 초과")
                            .createdAt(now).build());
                if (m.getMemoryPercent() > 85)
                    items.add(AlertDto.AlertItem.builder().level("WARNING")
                            .message(node.getHostname() + " Memory " + Math.round(m.getMemoryPercent()) + "% 초과")
                            .createdAt(now).build());
            });
        });

        if (items.isEmpty())
            items.add(AlertDto.AlertItem.builder()
                    .level("INFO").message("시스템 정상 운영 중").createdAt(now).build());

        return AlertDto.builder().items(items).build();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getDockerStatus() {
        // Docker 컨테이너 수집은 에이전트 미구현(Roadmap Phase 5). 가짜 0/0 대신 명시적 미지원으로 응답.
        List<Map<String, Object>> nodeList = nodeRepository.findAll().stream().map(n -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("hostname", n.getHostname());
            m.put("supported", false);
            m.put("status", "미지원");
            m.put("runningContainers", null);
            m.put("totalContainers", null);
            return m;
        }).collect(Collectors.toList());
        return Map.of("supported", false,
                "note", "Docker 컨테이너 모니터링은 Phase 5에서 제공됩니다.",
                "nodes", nodeList);
    }

    private String inferType(String name) {
        String l = name.toLowerCase();
        if (l.contains("oracle") || l.contains("mysql") || l.contains("postgres")) return "DB";
        if (l.contains("tomcat") || l.contains("jboss") || l.contains("weblogic")) return "WAS";
        if (l.contains("nginx") || l.contains("apache") || l.contains("httpd")) return "Web";
        return "SW";
    }

    private double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
