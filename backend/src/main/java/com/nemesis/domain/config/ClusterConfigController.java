package com.nemesis.domain.config;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 클러스터 설정 백업·복구·노드 동기화. */
@RestController
@RequestMapping("/api/clusters/{clusterId}/config")
@RequiredArgsConstructor
public class ClusterConfigController {

    private final ClusterConfigService service;

    /** 현재 클러스터/노드 설정을 스냅샷으로 저장. */
    @PostMapping("/backup")
    public ResponseEntity<Map<String, Object>> backup(@PathVariable UUID clusterId,
                                                      @RequestBody(required = false) Map<String, Object> body) {
        String name = body != null ? (String) body.get("name") : null;
        return ResponseEntity.ok(service.backup(clusterId, name));
    }

    @GetMapping("/snapshots")
    public ResponseEntity<List<Map<String, Object>>> list(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(service.list(clusterId));
    }

    @GetMapping("/snapshots/{snapshotId}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable UUID clusterId, @PathVariable UUID snapshotId) {
        return ResponseEntity.ok(service.get(snapshotId));
    }

    /** 스냅샷으로 클러스터/노드 설정 복구(operator+). */
    @PostMapping("/snapshots/{snapshotId}/restore")
    public ResponseEntity<Map<String, Object>> restore(@PathVariable UUID clusterId, @PathVariable UUID snapshotId) {
        return ResponseEntity.ok(service.restore(snapshotId));
    }

    @DeleteMapping("/snapshots/{snapshotId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId, @PathVariable UUID snapshotId) {
        service.delete(snapshotId);
        return ResponseEntity.noContent().build();
    }

    /** 클러스터 설정을 노드에 동기화 트리거(operator+). */
    @PostMapping("/sync")
    public ResponseEntity<Map<String, Object>> sync(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(service.sync(clusterId));
    }
}
