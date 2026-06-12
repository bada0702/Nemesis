package com.nemesis.domain.dashboard;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.ai.AiFaultService;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeService;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/clusters/{id}")
@RequiredArgsConstructor
public class ClusterAgentController {

    private final NodeService         nodeService;
    private final MetricsCacheService metricsCache;
    private final ClusterService      clusterService;
    private final AiFaultService      aiFaultService;
    private final DetectionProperties detectionProps;

    @GetMapping("/agent")
    public ResponseEntity<Map<String, Object>> agentData(@PathVariable UUID id) {
        Cluster cluster = clusterService.findById(id);
        List<Node> nodes = nodeService.getNodes(id);
        Map<UUID, MetricsPushRequest> metrics = metricsCache.getForNodes(
                nodes.stream().map(Node::getId).toList());

        long freshMillis = detectionProps.metricsFreshMillis();
        List<Map<String, Object>> nodeList = nodes.stream().map(n -> {
            MetricsPushRequest m = metrics.get(n.getId());
            // 캐시 존재 여부가 아니라 "최근 보고 여부"로 RUNNING/STOPPED를 판정한다(C-2).
            boolean live = n.getRole() != Node.Role.fault
                    && metricsCache.isFresh(n.getId(), freshMillis);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("nodeId",    n.getId());
            r.put("hostname",  n.getHostname());
            r.put("role",      n.getRole().uiToken());
            r.put("state",     live ? "RUNNING" : "STOPPED");
            r.put("osType",    n.getOsType());
            r.put("ipAddress", n.getIpAddress());
            r.put("metrics", m != null ? Map.of(
                    "cpuPercent",    m.getCpuPercent(),
                    "memoryPercent", m.getMemoryPercent(),
                    "diskPercent",   m.getDiskPercent()
            ) : null);
            r.put("apps",        m != null && m.getApps()        != null ? m.getApps()        : List.of());
            r.put("network",     m != null && m.getNetwork()     != null ? m.getNetwork()     : List.of());
            r.put("fc",          m != null && m.getFc()          != null ? m.getFc()          : List.of());
            r.put("gpfsVolumes", m != null && m.getGpfsVolumes() != null ? m.getGpfsVolumes() : List.of());
            r.put("logs",        m != null && m.getLogs()        != null ? m.getLogs()        : List.of());
            return r;
        }).toList();

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("clusterId",    cluster.getId());
        response.put("clusterName",  cluster.getName());
        response.put("vip",          cluster.getVip() != null ? cluster.getVip() : "");
        response.put("timestamp",    OffsetDateTime.now().toString());
        response.put("nodes",        nodeList);
        response.put("failoverEvent", null);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/gpfs")
    public ResponseEntity<Map<String, Object>> gpfs(@PathVariable UUID id) {
        List<Node> nodes = nodeService.getNodes(id);
        Map<UUID, MetricsPushRequest> metrics = metricsCache.getForNodes(
                nodes.stream().map(Node::getId).toList());

        List<Map<String, Object>> gpfsNodes = nodes.stream().map(n -> {
            MetricsPushRequest m = metrics.get(n.getId());
            String state = m != null
                    ? (m.getGpfsVolumes() != null && !m.getGpfsVolumes().isEmpty() ? "active" : "down")
                    : "unknown";
            return Map.<String, Object>of(
                    "nodeId",    n.getId(),
                    "hostname",  n.getHostname(),
                    "gpfsState", state,
                    "ipAddress", n.getIpAddress() != null ? n.getIpAddress() : "",
                    "volumes",   m != null && m.getGpfsVolumes() != null ? m.getGpfsVolumes() : List.of()
            );
        }).toList();

        return ResponseEntity.ok(Map.of(
                "command",   "mmgetstate -a",
                "timestamp", OffsetDateTime.now().toString(),
                "nodes",     gpfsNodes
        ));
    }

    @GetMapping("/network")
    public ResponseEntity<Map<String, Object>> network(@PathVariable UUID id) {
        List<Node> nodes = nodeService.getNodes(id);
        Map<UUID, MetricsPushRequest> metrics = metricsCache.getForNodes(
                nodes.stream().map(Node::getId).toList());

        List<Map<String, Object>> nodeList = nodes.stream().map(n -> {
            MetricsPushRequest m = metrics.get(n.getId());
            return Map.<String, Object>of(
                    "nodeId",    n.getId(),
                    "hostname",  n.getHostname(),
                    "ipAddress", n.getIpAddress() != null ? n.getIpAddress() : "",
                    "interfaces", m != null && m.getNetwork() != null ? m.getNetwork() : List.of()
            );
        }).toList();

        return ResponseEntity.ok(Map.of(
                "timestamp", OffsetDateTime.now().toString(),
                "nodes",     nodeList
        ));
    }

    @GetMapping("/ai-analysis")
    public ResponseEntity<Map<String, Object>> aiAnalysis(@PathVariable UUID id) {
        return ResponseEntity.ok(aiFaultService.analyzeCluster(id));
    }
}
