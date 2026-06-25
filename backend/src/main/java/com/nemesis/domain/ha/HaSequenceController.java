package com.nemesis.domain.ha;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * HA 운영 절차(기동/중지/Failover) 조회·저장. 클러스터별로 STARTUP/SHUTDOWN/FAILOVER
 * 세 종류의 단계 배열을 관리한다.
 */
@RestController
@RequestMapping("/api/ha/sequences")
@RequiredArgsConstructor
public class HaSequenceController {

    private static final List<String> TYPES = List.of("STARTUP", "SHUTDOWN", "FAILOVER");

    private final HaSequenceRepository repository;
    private final HaSequenceExecutor   executor;

    @GetMapping("/{clusterId}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable UUID clusterId) {
        Map<String, List<Map<String, Object>>> byType = new LinkedHashMap<>();
        for (String t : TYPES) byType.put(t, List.of());
        for (HaSequence seq : repository.findByClusterGroupId(clusterId)) {
            byType.put(seq.getType(), seq.getSteps());
        }
        Map<String, Object> result = new LinkedHashMap<>(byType);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/{clusterId}/execute")
    public ResponseEntity<Map<String, Object>> execute(@PathVariable UUID clusterId,
                                                       @RequestBody Map<String, String> body) {
        String type = String.valueOf(body.getOrDefault("type", "")).toUpperCase();
        if (!TYPES.contains(type)) {
            throw new IllegalArgumentException("Invalid sequence type: " + type);
        }
        return ResponseEntity.ok(executor.execute(clusterId, type));
    }

    @PutMapping("/{clusterId}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable UUID clusterId,
                                                      @RequestBody Map<String, Object> body) {
        String type = String.valueOf(body.getOrDefault("type", "")).toUpperCase();
        if (!TYPES.contains(type)) {
            throw new IllegalArgumentException("Invalid sequence type: " + type);
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> steps = (List<Map<String, Object>>) body.getOrDefault("steps", List.of());

        HaSequence seq = repository.findByClusterGroupIdAndType(clusterId, type)
                .orElseGet(() -> HaSequence.builder().clusterGroupId(clusterId).type(type).build());
        seq.setSteps(steps != null ? steps : List.of());
        repository.save(seq);

        return ResponseEntity.ok(Map.of("type", type, "steps", seq.getSteps()));
    }
}
