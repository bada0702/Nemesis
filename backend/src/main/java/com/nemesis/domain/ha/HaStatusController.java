package com.nemesis.domain.ha;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.*;

/**
 * HA 하트비트 매트릭스·메타데이터 동기화 현황.
 * - 하트비트: 에이전트가 보고한 피어 결과(HeartbeatCache) 우선, 없으면 서버의 메트릭 신선도로 폴백.
 * - 메타데이터: 관리 서버가 메타데이터의 마스터(MetaVersion). 각 노드가 하트비트에 실어 보고한
 *   appliedMetaVersion과 비교해 실제 적용 여부를 판정한다. 구버전 에이전트(미보고)는 메트릭
 *   신선도로 폴백한다.
 */
@Slf4j
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
    private final AgentCommandClient   agentCommandClient;

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

        long masterVersion = MetaVersion.of(cluster, nodes);

        // 노드별 동기화 상태: 에이전트가 하트비트로 보고한 appliedMetaVersion을 마스터 버전과
        // 직접 비교한다(실제 적용 여부). 구버전 에이전트(미보고)는 메트릭 신선도로 폴백한다.
        boolean allInSync = !nodes.isEmpty();
        List<Map<String, Object>> nodeStatus = new ArrayList<>();
        for (Node n : nodes) {
            Long applied = heartbeatCache.getAppliedVersion(n.getId(), fresh);
            boolean inSync;
            long nodeVersion;
            if (applied != null) {
                inSync = applied >= masterVersion;
                nodeVersion = applied;
            } else {
                inSync = metricsCache.isFresh(n.getId(), fresh);
                nodeVersion = inSync ? masterVersion : Math.max(0, masterVersion - 1);
            }
            if (!inSync) allInSync = false;
            Map<String, Object> ns = new LinkedHashMap<>();
            ns.put("nodeId",   n.getId());
            ns.put("hostname", n.getHostname());
            ns.put("status",   inSync ? "IN_SYNC" : "DIVERGED");
            ns.put("version",  nodeVersion);
            nodeStatus.add(ns);
        }

        // 서버가 마스터인 메타데이터 항목(VIP·역할 배치·피어 목록). 세 항목 모두 동일한
        // 메타 blob(/api/agent/meta)에서 나오므로 같은 버전·동기화 상태를 공유한다.
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
        List<Node> nodes = nodeRepository.findByClusterId(clusterId);
        if (nodes.isEmpty()) {
            throw new IllegalArgumentException("Cluster not found: " + clusterId);
        }
        // 다음 폴링(최대 30초)을 기다리지 않고, 각 노드에 즉시 재pull을 지시한다.
        // 에이전트의 명령 채널(화이트리스트 스크립트 실행)과 별개인 특수 명령으로,
        // 에이전트는 이미 주기적으로 수행하는 /api/agent/meta GET을 즉시 1회 수행할 뿐이다.
        int ok = 0;
        List<String> failed = new ArrayList<>();
        for (Node n : nodes) {
            AgentCommandClient.Result r = agentCommandClient.execute(n, "meta-pull");
            if (r.ok()) ok++;
            else {
                failed.add(n.getHostname());
                log.info("meta-pull 실패 node={}: {}", n.getHostname(),
                        r.error() != null ? r.error() : r.stderr());
            }
        }
        String message = failed.isEmpty()
                ? String.format("%d개 노드에 즉시 동기화를 지시했습니다.", ok)
                : String.format("%d개 노드는 동기화 지시에 성공, 응답 없는 노드: %s", ok, String.join(", ", failed));
        return ResponseEntity.ok(Map.of("message", message, "succeeded", ok, "failed", failed));
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
