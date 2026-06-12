package com.nemesis.domain.failover;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters/{id}/failover")
@RequiredArgsConstructor
public class FailoverController {

    private final FailoverService failoverService;

    @PostMapping
    public ResponseEntity<Map<String, Object>> failover(
            @PathVariable UUID id,
            @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(failoverService.manualFailover(id, body));
    }

    @GetMapping("/history")
    public ResponseEntity<List<FailoverHistory>> history(@PathVariable UUID id) {
        return ResponseEntity.ok(failoverService.history(id));
    }
}
