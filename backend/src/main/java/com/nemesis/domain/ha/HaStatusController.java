package com.nemesis.domain.ha;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.*;

/**
 * HA 하트비트 매트릭스·메타데이터 동기화 현황.
 * - 하트비트: 에이전트가 보고한 피어 결과(HeartbeatCache) 우선, 없으면 서버의 메트릭 신선도로 폴백.
 * - 메타데이터: 관리 서버가 메타데이터의 마스터. 노드가 신선하면 IN_SYNC, 오래되면 DIVERGED로 본다.
 */
@RestController
@RequestMapping("/api/ha")
@RequiredArgsConstructor
public class HaStatusController {

    private final NodeRepository       nodeRepository;
    private final ClusterRepository    clusterRepository;
    private final MetricsCacheService  metricsCache;
    private final HeartbeatCache       heartbeatCache;
    private final ServiceLinkCache     serviceLinkCache;
    private final DetectionProperties  detectionProps;

    // ── 하트비트 매트릭스 ──────────────────────────────────────
    @GetMapping("/heartbeat/{clusterId}")
    public ResponseEntity<Map<String, Object>> heartbeat(@PathVariable UUID clusterId) {
        long fresh = detectionProps.metricsFreshMillis();
        List<Node> nodes = nodeRepository.findByClusterId(clusterId);

        List<Map<String, Object>> nodeViews = new ArrayList<>();
        for (Node from : nodes) {
            boolean fromAlive = metricsCache.isFresh(from.getId(), fresh);

            List<Map<String, Object>> hbs = new ArrayList<>();
            for (Node to : nodes) {
                if (to.getId().equals(from.getId())) continue;
                HeartbeatCache.Entry e = heartbeatCache.get(from.getId(), to.getId(), fresh);
                String status;
                Integer latency;
                if (e != null) {
                    status  = e.status();
                    latency = e.latencyMs();
                } else {
                    // 폴백: 두 노드가 모두 신선하면 서로 살아있다고 본다.
                    boolean toAlive = metricsCache.isFresh(to.getId(), fresh);
                    status  = (fromAlive && toAlive) ? "ALIVE" : "DEAD";
                    latency = null;
                }
                Map<String, Object> hb = new LinkedHashMap<>();
                hb.put("toNodeId",  to.getId());
                hb.put("status",    status);
                hb.put("latencyMs", latency);
                hbs.add(hb);
            }

            // real IP 링크(관리서버→노드 serviceIp 제어포트 도달성).
            ServiceLinkCache.Entry sl = serviceLinkCache.get(from.getId(), fresh);
            Map<String, Object> serviceLink = new LinkedHashMap<>();
            if (sl != null) {
                serviceLink.put("status",    sl.status());
                serviceLink.put("latencyMs", sl.latencyMs());
            } else {
                // 폴백: 프로브 결과가 아직 없으면 노드 신선도로 근사.
                serviceLink.put("status",    fromAlive ? "ALIVE" : "DEAD");
                serviceLink.put("latencyMs", null);
            }

            Map<String, Object> nv = new LinkedHashMap<>();
            nv.put("nodeId",      from.getId());
            nv.put("hostname",    from.getHostname());
            nv.put("role",        from.getRole().uiToken());
            nv.put("state",       fromAlive ? "RUNNING" : "STOPPED");
            nv.put("serviceLink", serviceLink);
            nv.put("heartbeats",  hbs);
            nodeViews.add(nv);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("timestamp", OffsetDateTime.now().toString());
        result.put("nodes",     nodeViews);
        return ResponseEntity.ok(result);
    }

    // ── 메타데이터 동기화 현황 ─────────────────────────────────
    @GetMapping("/metadata-sync/{clusterId}")
    public ResponseEntity<Map<String, Object>> metadataSync(@PathVariable UUID clusterId) {
        long fresh = detectionProps.metricsFreshMillis();
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        List<Node> nodes = nodeRepository.findByClusterId(clusterId);

        // 마스터 버전: 클러스터 메타 갱신 시각을 분 단위 정수로 환산(단조 증가).
        long masterVersion = cluster.getUpdatedAt() != null
                ? cluster.getUpdatedAt().toEpochSecond() / 60
                : OffsetDateTime.now().toEpochSecond() / 60;

        // 노드별 동기화 상태: 신선하면 IN_SYNC(마스터 버전 보유), 아니면 DIVERGED.
        boolean allInSync = !nodes.isEmpty();
        List<Map<String, Object>> nodeStatus = new ArrayList<>();
        for (Node n : nodes) {
            boolean inSync = metricsCache.isFresh(n.getId(), fresh);
            if (!inSync) allInSync = false;
            Map<String, Object> ns = new LinkedHashMap<>();
            ns.put("nodeId",   n.getId());
            ns.put("hostname", n.getHostname());
            ns.put("status",   inSync ? "IN_SYNC" : "DIVERGED");
            ns.put("version",  inSync ? masterVersion : Math.max(0, masterVersion - 1));
            nodeStatus.add(ns);
        }

        // 서버가 마스터인 메타데이터 항목(VIP·역할 배치·피어 목록).
        List<Map<String, Object>> items = List.of(
                metaItem("vip",   "VIP 주소",     masterVersion, allInSync, nodeStatus),
                metaItem("roles", "노드 역할 배치", masterVersion, allInSync, nodeStatus),
                metaItem("peers", "피어 목록",      masterVersion, allInSync, nodeStatus)
        );

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("overallStatus", allInSync ? "IN_SYNC" : "DIVERGED");
        result.put("lastSyncAt",    OffsetDateTime.now().toString());
        result.put("items",         items);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/metadata-sync/{clusterId}")
    public ResponseEntity<Map<String, Object>> triggerMetadataSync(@PathVariable UUID clusterId) {
        // 에이전트는 /api/agent/meta 를 주기적으로 Pull 하므로, 트리거는 다음 폴링에서 반영된다.
        clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        return ResponseEntity.ok(Map.of(
                "message", "동기화 요청을 전송했습니다. 에이전트가 다음 메타데이터 폴링에서 반영합니다."));
    }

    private Map<String, Object> metaItem(String key, String label, long masterVersion,
                                         boolean allInSync, List<Map<String, Object>> nodeStatus) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key",           key);
        m.put("label",         label);
        m.put("masterVersion", masterVersion);
        m.put("allInSync",     allInSync);
        m.put("nodes",         nodeStatus);
        return m;
    }
}
