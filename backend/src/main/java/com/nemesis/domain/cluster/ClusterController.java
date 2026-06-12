package com.nemesis.domain.cluster;

import com.nemesis.domain.node.NodeService;
import com.nemesis.dto.ClusterStatusResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters")
@RequiredArgsConstructor
public class ClusterController {

    private final ClusterService clusterService;
    private final NodeService    nodeService;

    @PostMapping
    public ResponseEntity<Cluster> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(clusterService.create(body));
    }

    @GetMapping
    public ResponseEntity<List<Cluster>> findAll() {
        return ResponseEntity.ok(clusterService.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Cluster> findById(@PathVariable UUID id) {
        return ResponseEntity.ok(clusterService.findById(id));
    }

    @GetMapping("/{id}/status")
    public ResponseEntity<ClusterStatusResponse> getStatus(@PathVariable UUID id) {
        return ResponseEntity.ok(nodeService.getClusterStatus(id));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Cluster> update(@PathVariable UUID id,
                                          @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(clusterService.update(id, body));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        clusterService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
