package com.nemesis.domain.node;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters/{clusterId}/nodes")
@RequiredArgsConstructor
public class NodeController {

    private final NodeService nodeService;

    // 엔티티를 직접 반환하면 lazy proxy(cluster) 직렬화로 500 — 항상 UI DTO로 매핑한다.
    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(nodeService.getNodes(clusterId).stream()
                .map(nodeService::toUiDto).toList());
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@PathVariable UUID clusterId,
                                                      @RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(nodeService.toUiDto(nodeService.createNode(clusterId, body)));
    }

    @PutMapping("/{nodeId}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable UUID clusterId,
                                                      @PathVariable UUID nodeId,
                                                      @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(nodeService.toUiDto(nodeService.updateNode(clusterId, nodeId, body)));
    }

    @DeleteMapping("/{nodeId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId,
                                       @PathVariable UUID nodeId) {
        nodeService.deleteNode(clusterId, nodeId);
        return ResponseEntity.noContent().build();
    }
}
