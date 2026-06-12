package com.nemesis.domain.node;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.dto.ClusterStatusResponse;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class NodeService {

    private final NodeRepository    nodeRepository;
    private final ClusterRepository clusterRepository;
    private final MetricsCacheService metricsCache;
    private final DetectionProperties detectionProps;

    @Transactional(readOnly = true)
    public List<Node> getNodes(UUID clusterId) {
        return nodeRepository.findByClusterId(clusterId);
    }

    /**
     * 노드 → UI 계약 DTO. 엔티티를 직접 직렬화하면 lazy proxy(cluster)로 500이 나고
     * role도 내부 소문자(active/standby)로 새어 나가므로, API 경계에서 항상 이 매핑을 거친다.
     * (nodeId / role=uiToken / state=메트릭 신선도 — E-1 계약)
     */
    public Map<String, Object> toUiDto(Node n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("nodeId",       n.getId());
        m.put("hostname",     n.getHostname());
        m.put("ipAddress",    n.getIpAddress());
        m.put("vip",          n.getVip());
        m.put("serviceIp",    n.getServiceIp());
        m.put("heartbeatIp",  n.getHeartbeatIp());
        m.put("netIface",     n.getNetIface());
        m.put("osType",       n.getOsType() != null ? n.getOsType().name() : null);
        m.put("role",         n.getRole() != null ? n.getRole().uiToken() : null);
        m.put("state",        metricsCache.isFresh(n.getId(), detectionProps.metricsFreshMillis())
                                  ? "RUNNING" : "STOPPED");
        m.put("agentVersion", n.getAgentVersion());
        m.put("lastSeenAt",   n.getLastSeenAt());
        return m;
    }

    @Transactional
    public Node createNode(UUID clusterId, Map<String, Object> body) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        Node node = Node.builder()
                .cluster(cluster)
                .hostname((String) body.get("hostname"))
                .ipAddress((String) body.get("ipAddress"))
                .vip((String) body.get("vip"))
                .serviceIp((String) body.get("serviceIp"))
                .heartbeatIp((String) body.get("heartbeatIp"))
                .osType(Node.OsType.valueOf(
                        ((String) body.getOrDefault("osType", "LINUX")).toUpperCase()))
                .role(Node.Role.parse((String) body.getOrDefault("role", "standby")))
                .build();
        return nodeRepository.save(node);
    }

    @Transactional
    public Node updateNode(UUID clusterId, UUID nodeId, Map<String, Object> body) {
        Node node = nodeRepository.findById(nodeId)
                .filter(n -> n.getCluster().getId().equals(clusterId))
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));
        if (body.get("hostname")    != null) node.setHostname((String) body.get("hostname"));
        if (body.get("ipAddress")   != null) node.setIpAddress((String) body.get("ipAddress"));
        if (body.get("vip")         != null) node.setVip((String) body.get("vip"));
        if (body.get("serviceIp")   != null) node.setServiceIp((String) body.get("serviceIp"));
        if (body.get("heartbeatIp") != null) node.setHeartbeatIp((String) body.get("heartbeatIp"));
        if (body.get("netIface")    != null) node.setNetIface((String) body.get("netIface"));
        if (body.get("osType")      != null) node.setOsType(Node.OsType.valueOf(
                ((String) body.get("osType")).toUpperCase()));
        if (body.get("role")        != null) node.setRole(Node.Role.parse((String) body.get("role")));
        return nodeRepository.save(node);
    }

    @Transactional
    public void deleteNode(UUID clusterId, UUID nodeId) {
        Node node = nodeRepository.findById(nodeId)
                .filter(n -> n.getCluster().getId().equals(clusterId))
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));
        nodeRepository.delete(node);
    }

    @Transactional(readOnly = true)
    public ClusterStatusResponse getClusterStatus(UUID clusterId) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));

        List<Node> nodes = nodeRepository.findByClusterId(clusterId);

        List<ClusterStatusResponse.NodeStatus> nodeStatuses = nodes.stream()
                .map(this::toNodeStatus)
                .toList();

        return ClusterStatusResponse.builder()
                .clusterId(cluster.getId())
                .clusterName(cluster.getName())
                .vip(cluster.getVip())
                .nodes(nodeStatuses)
                .build();
    }

    private ClusterStatusResponse.NodeStatus toNodeStatus(Node node) {
        Optional<MetricsPushRequest> cached = metricsCache.get(node.getId());

        ClusterStatusResponse.NodeMetrics metrics = cached.map(m ->
                ClusterStatusResponse.NodeMetrics.builder()
                        .cpuPercent(m.getCpuPercent())
                        .memoryPercent(m.getMemoryPercent())
                        .diskPercent(m.getDiskPercent())
                        .networkRxBytesPerSec(m.getNetworkRxBytesPerSec())
                        .networkTxBytesPerSec(m.getNetworkTxBytesPerSec())
                        .timestamp(m.getTimestamp())
                        .build()
        ).orElse(null);

        return ClusterStatusResponse.NodeStatus.builder()
                .nodeId(node.getId())
                .hostname(node.getHostname())
                .osType(node.getOsType().name())
                .role(node.getRole().uiToken())
                .lastSeenAt(node.getLastSeenAt())
                .metrics(metrics)
                .build();
    }
}
