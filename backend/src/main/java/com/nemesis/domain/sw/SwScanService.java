package com.nemesis.domain.sw;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class SwScanService {

    private static final Map<String, String> KNOWN_SW = new LinkedHashMap<>();

    static {
        KNOWN_SW.put("weblogic",     "WebLogic");
        KNOWN_SW.put("wlserver",     "WebLogic");
        KNOWN_SW.put("ora_pmon",     "Oracle DB");
        KNOWN_SW.put("ora_smon",     "Oracle DB");
        KNOWN_SW.put("oracle",       "Oracle DB");
        KNOWN_SW.put("tomcat",       "Tomcat");
        KNOWN_SW.put("catalina",     "Tomcat");
        KNOWN_SW.put("nginx",        "Nginx");
        KNOWN_SW.put("httpd",        "Apache HTTPD");
        KNOWN_SW.put("mysqld",       "MySQL");
        KNOWN_SW.put("postgres",     "PostgreSQL");
        KNOWN_SW.put("redis-server", "Redis");
        KNOWN_SW.put("kafka",        "Kafka");
        KNOWN_SW.put("zookeeper",    "Zookeeper");
        KNOWN_SW.put("jboss",        "JBoss/WildFly");
        KNOWN_SW.put("wildfly",      "JBoss/WildFly");
        KNOWN_SW.put("amqbroker",    "IBM MQ");
        KNOWN_SW.put("haproxy",      "HAProxy");
        KNOWN_SW.put("keepalived",   "Keepalived");
    }

    private final MetricsCacheService  metricsCache;
    private final NodeRepository       nodeRepository;
    private final SwProcessRepository  swProcessRepository;

    public Map<String, List<Map<String, Object>>> scan(UUID nodeId) {
        MetricsPushRequest metrics = metricsCache.get(nodeId)
                .orElseThrow(() -> new IllegalStateException("No cached metrics for node: " + nodeId));

        List<Map<String, Object>> known   = new ArrayList<>();
        List<Map<String, Object>> unknown = new ArrayList<>();

        List<Map<String, String>> processes = metrics.getProcesses();
        if (processes == null) return Map.of("known", known, "unknown", unknown);

        for (Map<String, String> proc : processes) {
            String rawName = proc.getOrDefault("name", "");
            String pidStr  = proc.getOrDefault("pid", "");
            String nameLower = rawName.toLowerCase();

            String displayName = matchKnownSw(nameLower);
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", rawName);
            entry.put("pid",  pidStr.isBlank() ? null : parseIntSafe(pidStr));

            if (displayName != null) {
                entry.put("displayName", displayName);
                entry.put("type", "KNOWN");
                known.add(entry);
            } else {
                unknown.add(entry);
            }
        }
        return Map.of("known", known, "unknown", unknown);
    }

    private String matchKnownSw(String nameLower) {
        for (Map.Entry<String, String> e : KNOWN_SW.entrySet()) {
            if (nameLower.contains(e.getKey())) return e.getValue();
        }
        return null;
    }

    @Transactional
    public int register(UUID nodeId, List<Map<String, Object>> processes) {
        Node node = nodeRepository.findById(nodeId)
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));
        int count = 0;
        for (Map<String, Object> p : processes) {
            String name = (String) p.get("name");
            if (name == null || name.isBlank()) continue;
            if (swProcessRepository.existsByNodeIdAndName(nodeId, name)) continue;

            SwProcess sw = SwProcess.builder()
                    .node(node)
                    .cluster(node.getCluster())
                    .name(name)
                    .displayName((String) p.getOrDefault("displayName", name))
                    .type((String) p.getOrDefault("type", "CUSTOM"))
                    .status("unknown")
                    .pid(p.get("pid") != null ? ((Number) p.get("pid")).intValue() : null)
                    .build();
            swProcessRepository.save(sw);
            count++;
        }
        return count;
    }

    public List<SwProcess> list(UUID nodeId) {
        return swProcessRepository.findByNodeId(nodeId);
    }

    private Integer parseIntSafe(String s) {
        try { return Integer.parseInt(s.trim()); }
        catch (NumberFormatException e) { return null; }
    }
}
