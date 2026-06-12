package com.nemesis.domain.catalog;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * 서비스 카탈로그: 클러스터 논리 서비스의 스캔/등록/조회.
 * 인스턴스 상태는 저장하지 않고 메트릭 캐시의 프로세스 목록과 매칭 패턴을 대조해
 * 조회 시점에 계산한다(스캔·조회 모두 에이전트 통신 불필요).
 */
@Service
@RequiredArgsConstructor
public class ServiceCatalogService {

    /** 알려진 SW 정의: 프로세스 패턴 → [표시명, 타입]. 순서 유지(먼저 매칭 우선). */
    private static final Map<String, Object[]> KNOWN = new LinkedHashMap<>();
    static {
        // DB
        KNOWN.put("ora_pmon",     new Object[]{"Oracle DB",    ManagedService.Type.DB});
        KNOWN.put("ora_smon",     new Object[]{"Oracle DB",    ManagedService.Type.DB});
        KNOWN.put("oracle",       new Object[]{"Oracle DB",    ManagedService.Type.DB});
        KNOWN.put("tibero",       new Object[]{"Tibero",       ManagedService.Type.DB});
        KNOWN.put("mariadbd",     new Object[]{"MariaDB",      ManagedService.Type.DB});
        KNOWN.put("mysqld",       new Object[]{"MySQL",        ManagedService.Type.DB});
        KNOWN.put("postgres",     new Object[]{"PostgreSQL",   ManagedService.Type.DB});
        KNOWN.put("mongod",       new Object[]{"MongoDB",      ManagedService.Type.DB});
        KNOWN.put("redis-server", new Object[]{"Redis",        ManagedService.Type.DB});
        KNOWN.put("db2sysc",      new Object[]{"Db2",          ManagedService.Type.DB});
        // WAS
        KNOWN.put("weblogic",     new Object[]{"WebLogic",     ManagedService.Type.WAS});
        KNOWN.put("wlserver",     new Object[]{"WebLogic",     ManagedService.Type.WAS});
        KNOWN.put("tomcat",       new Object[]{"Tomcat",       ManagedService.Type.WAS});
        KNOWN.put("catalina",     new Object[]{"Tomcat",       ManagedService.Type.WAS});
        KNOWN.put("jboss",        new Object[]{"JBoss/WildFly",ManagedService.Type.WAS});
        KNOWN.put("wildfly",      new Object[]{"JBoss/WildFly",ManagedService.Type.WAS});
        // WEB
        KNOWN.put("nginx",        new Object[]{"Nginx",        ManagedService.Type.WEB});
        KNOWN.put("httpd",        new Object[]{"Apache HTTPD", ManagedService.Type.WEB});
        // 기타 SW
        KNOWN.put("kafka",        new Object[]{"Kafka",        ManagedService.Type.SW});
        KNOWN.put("zookeeper",    new Object[]{"Zookeeper",    ManagedService.Type.SW});
        KNOWN.put("amqbroker",    new Object[]{"IBM MQ",       ManagedService.Type.SW});
        KNOWN.put("haproxy",      new Object[]{"HAProxy",      ManagedService.Type.SW});
        KNOWN.put("keepalived",   new Object[]{"Keepalived",   ManagedService.Type.SW});
    }

    private final ManagedServiceRepository serviceRepository;
    private final ClusterRepository        clusterRepository;
    private final NodeRepository           nodeRepository;
    private final MetricsCacheService      metricsCache;
    private final DetectionProperties      detectionProps;

    /** 카탈로그 조회: 등록된 논리 서비스 + 노드별 실시간 인스턴스 상태. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> catalog(UUID clusterId) {
        requireCluster(clusterId);
        List<Node> nodes = nodeRepository.findByClusterId(clusterId);
        List<Map<String, Object>> result = new ArrayList<>();

        for (ManagedService svc : serviceRepository.findByClusterIdOrderByTypeAscDisplayNameAsc(clusterId)) {
            List<Map<String, Object>> instances = new ArrayList<>();
            int running = 0;
            for (Node node : nodes) {
                Map<String, Object> inst = instanceState(node, svc.getName());
                if ("RUNNING".equals(inst.get("state"))) running++;
                instances.add(inst);
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id",           svc.getId());
            m.put("name",         svc.getName());
            m.put("displayName",  svc.getDisplayName());
            m.put("type",         svc.getType().name());
            m.put("haManaged",    svc.isHaManaged());
            m.put("instances",    instances);
            m.put("runningCount", running);
            m.put("nodeCount",    nodes.size());
            result.add(m);
        }
        return result;
    }

    /**
     * 전체 노드 스캔: 메트릭 캐시의 프로세스를 알려진 SW 정의와 대조해
     * 표시명 기준으로 병합한 제안 목록을 만든다. 등록 여부(alreadyRegistered)도 표시.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> scan(UUID clusterId) {
        requireCluster(clusterId);
        List<Node> nodes = nodeRepository.findByClusterId(clusterId);

        // displayName → proposal (known), rawName → proposal (unknown)
        Map<String, Map<String, Object>> known   = new LinkedHashMap<>();
        Map<String, Map<String, Object>> unknown = new LinkedHashMap<>();
        List<String> staleNodes = new ArrayList<>();

        for (Node node : nodes) {
            Optional<MetricsPushRequest> metrics =
                    metricsCache.getFresh(node.getId(), detectionProps.metricsFreshMillis());
            if (metrics.isEmpty()) { staleNodes.add(node.getHostname()); continue; }

            List<Map<String, String>> processes = metrics.get().getProcesses();
            if (processes == null) continue;

            Set<String> seenOnNode = new HashSet<>(); // 노드 내 같은 서비스 중복 제거
            for (Map<String, String> proc : processes) {
                String rawName   = proc.getOrDefault("name", "");
                String nameLower = rawName.toLowerCase();
                Integer pid      = parseIntSafe(proc.getOrDefault("pid", ""));

                Map.Entry<String, Object[]> match = matchKnown(nameLower);
                if (match != null) {
                    String displayName = (String) match.getValue()[0];
                    if (!seenOnNode.add(displayName)) continue;
                    Map<String, Object> p = known.computeIfAbsent(displayName, k -> {
                        Map<String, Object> np = new LinkedHashMap<>();
                        np.put("name",              match.getKey());
                        np.put("displayName",       displayName);
                        np.put("type",              match.getValue()[1].toString());
                        np.put("alreadyRegistered", serviceRepository.existsByClusterIdAndName(clusterId, match.getKey()));
                        np.put("nodes",             new ArrayList<Map<String, Object>>());
                        return np;
                    });
                    nodeList(p).add(nodeEntry(node, pid));
                } else {
                    if (!seenOnNode.add(nameLower)) continue;
                    Map<String, Object> p = unknown.computeIfAbsent(nameLower, k -> {
                        Map<String, Object> np = new LinkedHashMap<>();
                        np.put("name",              nameLower);
                        np.put("displayName",       rawName);
                        np.put("type",              ManagedService.Type.SW.name());
                        np.put("alreadyRegistered", serviceRepository.existsByClusterIdAndName(clusterId, nameLower));
                        np.put("nodes",             new ArrayList<Map<String, Object>>());
                        return np;
                    });
                    nodeList(p).add(nodeEntry(node, pid));
                }
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("proposals",  new ArrayList<>(known.values()));
        result.put("unknown",    new ArrayList<>(unknown.values()));
        result.put("staleNodes", staleNodes);
        return result;
    }

    /** 검토 완료 항목 일괄 등록. 이미 등록된 이름은 건너뛴다. */
    @Transactional
    public int register(UUID clusterId, List<Map<String, Object>> items) {
        Cluster cluster = requireCluster(clusterId);
        int count = 0;
        for (Map<String, Object> item : items) {
            String name = ((String) item.getOrDefault("name", "")).trim().toLowerCase();
            if (name.isBlank()) continue;
            if (serviceRepository.existsByClusterIdAndName(clusterId, name)) continue;

            serviceRepository.save(ManagedService.builder()
                    .cluster(cluster)
                    .name(name)
                    .displayName((String) item.getOrDefault("displayName", name))
                    .type(parseType((String) item.get("type")))
                    .haManaged(Boolean.TRUE.equals(item.get("haManaged")))
                    .build());
            count++;
        }
        return count;
    }

    @Transactional
    public Map<String, Object> update(UUID clusterId, UUID serviceId, Map<String, Object> body) {
        ManagedService svc = requireService(clusterId, serviceId);
        if (body.get("displayName") != null) svc.setDisplayName((String) body.get("displayName"));
        if (body.get("type")        != null) svc.setType(parseType((String) body.get("type")));
        if (body.get("haManaged")   != null) svc.setHaManaged(Boolean.TRUE.equals(body.get("haManaged")));
        serviceRepository.save(svc);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",          svc.getId());
        m.put("name",        svc.getName());
        m.put("displayName", svc.getDisplayName());
        m.put("type",        svc.getType().name());
        m.put("haManaged",   svc.isHaManaged());
        return m;
    }

    @Transactional
    public void delete(UUID clusterId, UUID serviceId) {
        serviceRepository.delete(requireService(clusterId, serviceId));
    }

    // ── 내부 헬퍼 ──────────────────────────────────────────────

    private Map<String, Object> instanceState(Node node, String pattern) {
        Map<String, Object> inst = new LinkedHashMap<>();
        inst.put("nodeId",   node.getId());
        inst.put("hostname", node.getHostname());

        Optional<MetricsPushRequest> metrics =
                metricsCache.getFresh(node.getId(), detectionProps.metricsFreshMillis());
        Integer pid = null;
        boolean running = false;
        if (metrics.isPresent() && metrics.get().getProcesses() != null) {
            for (Map<String, String> proc : metrics.get().getProcesses()) {
                if (proc.getOrDefault("name", "").toLowerCase().contains(pattern)) {
                    running = true;
                    pid = parseIntSafe(proc.getOrDefault("pid", ""));
                    break;
                }
            }
        }
        inst.put("state", running ? "RUNNING" : "STOPPED");
        inst.put("pid",   pid);
        return inst;
    }

    private Map.Entry<String, Object[]> matchKnown(String nameLower) {
        for (Map.Entry<String, Object[]> e : KNOWN.entrySet()) {
            if (nameLower.contains(e.getKey())) return e;
        }
        return null;
    }

    private Map<String, Object> nodeEntry(Node node, Integer pid) {
        Map<String, Object> n = new LinkedHashMap<>();
        n.put("nodeId",   node.getId());
        n.put("hostname", node.getHostname());
        n.put("state",    "RUNNING");
        n.put("pid",      pid);
        return n;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> nodeList(Map<String, Object> proposal) {
        return (List<Map<String, Object>>) proposal.get("nodes");
    }

    private ManagedService.Type parseType(String raw) {
        if (raw == null || raw.isBlank()) return ManagedService.Type.SW;
        try { return ManagedService.Type.valueOf(raw.trim().toUpperCase()); }
        catch (IllegalArgumentException e) { return ManagedService.Type.SW; }
    }

    private Cluster requireCluster(UUID clusterId) {
        return clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
    }

    private ManagedService requireService(UUID clusterId, UUID serviceId) {
        return serviceRepository.findById(serviceId)
                .filter(s -> s.getCluster().getId().equals(clusterId))
                .orElseThrow(() -> new IllegalArgumentException("Service not found: " + serviceId));
    }

    private Integer parseIntSafe(String s) {
        try { return Integer.parseInt(s.trim()); }
        catch (NumberFormatException e) { return null; }
    }
}
