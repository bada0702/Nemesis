package com.nemesis.domain.dashboard;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.alert.AlertRule;
import com.nemesis.domain.alert.AlertRuleRepository;
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
    private final AlertRuleRepository alertRuleRepository;
    private final AgentCommandClient commandClient;

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

        // 알람 규칙(임계치)을 단일 소스로 사용. 비활성 규칙은 알람을 만들지 않는다.
        Map<String, AlertRule> rules = new HashMap<>();
        for (AlertRule r : alertRuleRepository.findAll()) rules.put(r.getMetric(), r);

        boolean nodeStateOn = isEnabled(rules, "node_state");
        AlertRule cpuRule    = enabledRule(rules, "cpu");
        AlertRule memRule    = enabledRule(rules, "memory");
        AlertRule diskRule   = enabledRule(rules, "disk");

        nodes.forEach(node -> {
            if (nodeStateOn && node.getRole() == Node.Role.fault) {
                items.add(AlertDto.AlertItem.builder()
                        .level(level(rules, "node_state", "CRITICAL"))
                        .message(node.getHostname() + " 노드 장애 감지")
                        .createdAt(now)
                        .build());
            }
            metricsCache.get(node.getId()).ifPresent(m -> {
                if (cpuRule != null && m.getCpuPercent() > cpuRule.getThreshold())
                    items.add(AlertDto.AlertItem.builder().level(cpuRule.getLevel())
                            .message(node.getHostname() + " CPU " + Math.round(m.getCpuPercent()) + "% 초과")
                            .createdAt(now).build());
                if (memRule != null && m.getMemoryPercent() > memRule.getThreshold())
                    items.add(AlertDto.AlertItem.builder().level(memRule.getLevel())
                            .message(node.getHostname() + " Memory " + Math.round(m.getMemoryPercent()) + "% 초과")
                            .createdAt(now).build());
                if (diskRule != null && m.getDiskPercent() > diskRule.getThreshold())
                    items.add(AlertDto.AlertItem.builder().level(diskRule.getLevel())
                            .message(node.getHostname() + " Disk " + Math.round(m.getDiskPercent()) + "% 초과")
                            .createdAt(now).build());
            });
        });

        if (items.isEmpty())
            items.add(AlertDto.AlertItem.builder()
                    .level("INFO").message("시스템 정상 운영 중").createdAt(now).build());

        return AlertDto.builder().items(items).build();
    }

    private boolean isEnabled(Map<String, AlertRule> rules, String metric) {
        AlertRule r = rules.get(metric);
        return r != null && r.isEnabled();
    }

    private AlertRule enabledRule(Map<String, AlertRule> rules, String metric) {
        AlertRule r = rules.get(metric);
        return (r != null && r.isEnabled()) ? r : null;
    }

    private String level(Map<String, AlertRule> rules, String metric, String fallback) {
        AlertRule r = rules.get(metric);
        return r != null ? r.getLevel() : fallback;
    }

    private static final String DOCKER_STATS_MARKER = "---STATS---";

    /**
     * 노드별 Docker 컨테이너 상태를 실시간 조회한다. 명령채널(17001)로
     * control.sh docker-ps 를 실행해 running/total 컨테이너 수를 집계한다.
     * docker 미설치/통신 실패 노드는 supported=false 로 graceful 처리(전체를 막지 않음).
     */
    @Transactional(readOnly = true)
    public Map<String, Object> getDockerStatus() {
        boolean anySupported = false;
        List<Map<String, Object>> nodeList = new ArrayList<>();
        for (Node n : nodeRepository.findAll()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("hostname", n.getHostname());
            m.put("ip", n.getServiceIp());
            AgentCommandClient.Result r = commandClient.execute(n, "control.sh docker-ps");
            if (r.ok() && r.stdout() != null) {
                int total = 0, running = 0;
                for (String line : r.stdout().split("\n")) {
                    if (line.isBlank()) continue;
                    if (line.trim().equals(DOCKER_STATS_MARKER)) break; // 통계 섹션은 집계 제외
                    String[] f = line.split("\t", -1);
                    if (f.length < 5) continue;
                    total++;
                    String st = f[2] == null ? "" : f[2].trim().toLowerCase();
                    if (st.contains("running") || st.startsWith("up")) running++;
                }
                m.put("supported", true);
                m.put("status", running > 0 ? "정상" : "정지");
                m.put("runningContainers", running);
                m.put("totalContainers", total);
                anySupported = true;
            } else {
                m.put("supported", false);
                m.put("status", "미지원");
                m.put("runningContainers", null);
                m.put("totalContainers", null);
            }
            nodeList.add(m);
        }
        return Map.of("supported", anySupported,
                "note", anySupported ? "" : "docker 미설치 또는 에이전트 통신 실패",
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
