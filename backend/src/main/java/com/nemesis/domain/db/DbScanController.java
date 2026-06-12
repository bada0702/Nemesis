package com.nemesis.domain.db;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;

/**
 * DB 인스턴스 자동 스캔. SW 스캔(SwScanService)과 동일하게 에이전트가 푸시한
 * 메트릭 캐시의 프로세스 목록에서 DB 엔진 프로세스를 감지한다(에이전트 통신 불필요).
 * 노드+엔진 단위로 중복 제거(예: ora_pmon/ora_smon → Oracle 1건).
 */
@RestController
@RequestMapping("/api/db")
@RequiredArgsConstructor
public class DbScanController {

    /** 프로세스명 패턴 → [표시 타입, 기본 포트] */
    private static final Map<String, Object[]> KNOWN_DB = new LinkedHashMap<>();
    static {
        KNOWN_DB.put("ora_pmon",     new Object[]{"Oracle",     1521});
        KNOWN_DB.put("ora_smon",     new Object[]{"Oracle",     1521});
        KNOWN_DB.put("oracle",       new Object[]{"Oracle",     1521});
        KNOWN_DB.put("tibero",       new Object[]{"Tibero",     8629});
        KNOWN_DB.put("mariadbd",     new Object[]{"MariaDB",    3306});
        KNOWN_DB.put("mysqld",       new Object[]{"MySQL",      3306});
        KNOWN_DB.put("postgres",     new Object[]{"PostgreSQL", 5432});
        KNOWN_DB.put("mongod",       new Object[]{"MongoDB",   27017});
        KNOWN_DB.put("redis-server", new Object[]{"Redis",      6379});
        KNOWN_DB.put("db2sysc",      new Object[]{"Db2",       50000});
    }

    private final NodeRepository      nodeRepository;
    private final MetricsCacheService metricsCache;

    @GetMapping
    public ResponseEntity<Map<String, Object>> scan() {
        List<Map<String, Object>> items = new ArrayList<>();
        for (Node node : nodeRepository.findAll()) {
            metricsCache.get(node.getId()).ifPresent(m -> {
                if (m.getProcesses() == null) return;
                Set<String> seenTypes = new HashSet<>();
                for (Map<String, String> proc : m.getProcesses()) {
                    String nameLower = proc.getOrDefault("name", "").toLowerCase();
                    for (Map.Entry<String, Object[]> e : KNOWN_DB.entrySet()) {
                        if (!nameLower.contains(e.getKey())) continue;
                        String type = (String) e.getValue()[0];
                        if (!seenTypes.add(type)) break; // 노드 내 같은 엔진 중복 제거

                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("id",    node.getId() + ":" + type);
                        item.put("name",  type + " @ " + node.getHostname());
                        item.put("type",  type);
                        item.put("node",  node.getHostname());
                        item.put("port",  e.getValue()[1]);
                        item.put("state", "RUNNING"); // 프로세스 생존 = 기동 중
                        items.add(item);
                        break;
                    }
                }
            });
        }
        return ResponseEntity.ok(Map.of("items", items));
    }
}
