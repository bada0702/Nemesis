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
    private final VipService     vipService;

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
        Cluster updated = clusterService.update(id, body);
        // VIP 변경 시 primary 노드 OS에 실제 별칭을 반영(비동기 best-effort)
        if (body.get("vip") != null && updated.getVip() != null && !updated.getVip().isBlank()) {
            vipService.applyAsync(id);
        }
        return ResponseEntity.ok(updated);
    }

    /** VIP 수동 적용: primary에 vip-up, 그 외 노드 vip-down. 노드별 결과 반환. */
    @PostMapping("/{id}/vip/apply")
    public ResponseEntity<Map<String, Object>> applyVip(@PathVariable UUID id) {
        return ResponseEntity.ok(vipService.apply(id));
    }

    /** VIP 전체 해제: 모든 노드에서 vip-down (이중화 중지). */
    @PostMapping("/{id}/vip/down")
    public ResponseEntity<Map<String, Object>> downVip(@PathVariable UUID id) {
        return ResponseEntity.ok(vipService.down(id));
    }

    /** 노드별 VIP 존재 여부 점검(vip-check). */
    @GetMapping("/{id}/vip/status")
    public ResponseEntity<Map<String, Object>> vipStatus(@PathVariable UUID id) {
        return ResponseEntity.ok(vipService.status(id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        clusterService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
