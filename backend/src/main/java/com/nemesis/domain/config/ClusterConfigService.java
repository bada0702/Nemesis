package com.nemesis.domain.config;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** 클러스터/노드 설정 백업·복구. 노드 동기화는 에이전트가 /api/agent/meta를 pull해 자동 반영. */
@Slf4j
@Service
@RequiredArgsConstructor
public class ClusterConfigService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final ClusterRepository clusterRepository;
    private final NodeRepository nodeRepository;
    private final ConfigSnapshotRepository snapshotRepository;
    private final ObjectMapper mapper;

    // ── 백업 ─────────────────────────────────────────────────────
    @Transactional
    public Map<String, Object> backup(UUID clusterId, String name) {
        Cluster c = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        String snapName = (name != null && !name.isBlank())
                ? name.trim() : c.getName() + " " + TS.format(OffsetDateTime.now());
        ConfigSnapshot s = ConfigSnapshot.builder()
                .id(UUID.randomUUID()).clusterId(clusterId).name(snapName)
                .payload(toJson(buildPayload(c))).build();
        return toMap(snapshotRepository.save(s));
    }

    private Map<String, Object> buildPayload(Cluster c) {
        Map<String, Object> cl = new LinkedHashMap<>();
        cl.put("name", c.getName());
        cl.put("description", c.getDescription());
        cl.put("vip", c.getVip());
        cl.put("vipCidr", c.getVipCidr());
        cl.put("maxFailoverCount", c.getMaxFailoverCount());
        cl.put("pingpongGuardSeconds", c.getPingpongGuardSeconds());
        cl.put("heartbeatFailThreshold", c.getHeartbeatFailThreshold());
        cl.put("aiEnabled", c.isAiEnabled());

        List<Map<String, Object>> nodes = nodeRepository.findByClusterId(c.getId()).stream().map(n -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("hostname", n.getHostname());
            m.put("ipAddress", n.getIpAddress());
            m.put("vip", n.getVip());
            m.put("serviceIp", n.getServiceIp());
            m.put("heartbeatIp", n.getHeartbeatIp());
            m.put("netIface", n.getNetIface());
            m.put("osType", n.getOsType() != null ? n.getOsType().name() : null);
            m.put("role", n.getRole() != null ? n.getRole().name() : null);
            return m;
        }).toList();

        Map<String, Object> p = new LinkedHashMap<>();
        p.put("cluster", cl);
        p.put("nodes", nodes);
        return p;
    }

    // ── 목록/상세 ─────────────────────────────────────────────────
    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(UUID clusterId) {
        return snapshotRepository.findByClusterIdOrderByCreatedAtDesc(clusterId).stream().map(this::toMap).toList();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> get(UUID snapshotId) {
        ConfigSnapshot s = snapshotRepository.findById(snapshotId)
                .orElseThrow(() -> new IllegalArgumentException("Snapshot not found: " + snapshotId));
        Map<String, Object> m = toMap(s);
        m.put("payload", fromJson(s.getPayload()));
        return m;
    }

    // ── 복구 ─────────────────────────────────────────────────────
    @SuppressWarnings("unchecked")
    @Transactional
    public Map<String, Object> restore(UUID snapshotId) {
        ConfigSnapshot s = snapshotRepository.findById(snapshotId)
                .orElseThrow(() -> new IllegalArgumentException("Snapshot not found: " + snapshotId));
        Map<String, Object> p = fromJson(s.getPayload());
        Cluster c = clusterRepository.findById(s.getClusterId())
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + s.getClusterId()));

        Map<String, Object> cl = (Map<String, Object>) p.get("cluster");
        if (cl != null) {
            if (cl.get("name") != null) c.setName((String) cl.get("name"));
            c.setDescription((String) cl.get("description"));
            c.setVip((String) cl.get("vip"));
            if (cl.get("vipCidr") != null) c.setVipCidr(((Number) cl.get("vipCidr")).intValue());
            if (cl.get("maxFailoverCount") != null) c.setMaxFailoverCount(((Number) cl.get("maxFailoverCount")).intValue());
            if (cl.get("pingpongGuardSeconds") != null) c.setPingpongGuardSeconds(((Number) cl.get("pingpongGuardSeconds")).intValue());
            if (cl.get("heartbeatFailThreshold") != null) c.setHeartbeatFailThreshold(((Number) cl.get("heartbeatFailThreshold")).intValue());
            if (cl.get("aiEnabled") != null) c.setAiEnabled((Boolean) cl.get("aiEnabled"));
            clusterRepository.save(c);
        }

        int restored = 0;
        for (Map<String, Object> nm : (List<Map<String, Object>>) p.getOrDefault("nodes", List.of())) {
            String hostname = (String) nm.get("hostname");
            if (hostname == null || hostname.isBlank()) continue;
            Node n = nodeRepository.findByClusterIdAndHostname(c.getId(), hostname)
                    .orElseGet(() -> Node.builder().cluster(c).hostname(hostname).build());
            n.setIpAddress((String) nm.get("ipAddress"));
            n.setVip((String) nm.get("vip"));
            n.setServiceIp((String) nm.get("serviceIp"));
            n.setHeartbeatIp((String) nm.get("heartbeatIp"));
            n.setNetIface((String) nm.get("netIface"));
            if (nm.get("osType") != null) n.setOsType(Node.OsType.valueOf((String) nm.get("osType")));
            if (nm.get("role") != null) n.changeRole(Node.Role.parse((String) nm.get("role")));
            else n.setUpdatedAt(java.time.OffsetDateTime.now());
            nodeRepository.save(n);
            restored++;
        }
        log.info("설정 복구: cluster={} nodes={}", c.getName(), restored);
        return Map.of("status", "restored", "cluster", c.getName(), "nodesRestored", restored);
    }

    @Transactional
    public void delete(UUID snapshotId) {
        snapshotRepository.deleteById(snapshotId);
    }

    // ── 노드 동기화 트리거 ─────────────────────────────────────────
    /** 클러스터 설정을 노드에 동기화. 에이전트가 /api/agent/meta를 pull하므로, 갱신 시각만 올려
     *  다음 pull에서 최신 설정이 반영되게 한다. 반환값으로 대상 노드 수를 알린다. */
    @Transactional
    public Map<String, Object> sync(UUID clusterId) {
        Cluster c = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        c.setUpdatedAt(OffsetDateTime.now());
        clusterRepository.save(c);
        long nodes = nodeRepository.findByClusterId(clusterId).size();
        return Map.of("status", "ok", "nodeCount", nodes,
                "message", "각 노드 에이전트가 다음 주기에 /api/agent/meta를 pull해 metadata.json을 동기화합니다.");
    }

    // ── 직렬화 헬퍼 ───────────────────────────────────────────────
    private Map<String, Object> toMap(ConfigSnapshot s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.getId());
        m.put("clusterId", s.getClusterId());
        m.put("name", s.getName());
        m.put("createdAt", s.getCreatedAt() != null ? TS.format(s.getCreatedAt()) : null);
        return m;
    }

    private String toJson(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }
    private Map<String, Object> fromJson(String json) {
        try { return mapper.readValue(json == null ? "{}" : json, new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return Map.of(); }
    }
}
