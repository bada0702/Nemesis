package com.nemesis.domain.catalog;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters/{clusterId}/services")
@RequiredArgsConstructor
public class ServiceCatalogController {

    private final ServiceCatalogService catalogService;

    @GetMapping
    public ResponseEntity<Map<String, Object>> catalog(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(Map.of("items", catalogService.catalog(clusterId)));
    }

    @PostMapping("/scan")
    public ResponseEntity<Map<String, Object>> scan(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(catalogService.scan(clusterId));
    }

    @PostMapping
    public ResponseEntity<Map<String, Integer>> register(@PathVariable UUID clusterId,
                                                         @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) body.get("items");
        int registered = catalogService.register(clusterId, items != null ? items : List.of());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("registered", registered));
    }

    @PutMapping("/{serviceId}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable UUID clusterId,
                                                      @PathVariable UUID serviceId,
                                                      @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(catalogService.update(clusterId, serviceId, body));
    }

    @DeleteMapping("/{serviceId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId, @PathVariable UUID serviceId) {
        catalogService.delete(clusterId, serviceId);
        return ResponseEntity.noContent().build();
    }
}
