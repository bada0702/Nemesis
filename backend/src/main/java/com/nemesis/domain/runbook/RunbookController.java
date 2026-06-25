package com.nemesis.domain.runbook;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/runbook")
@RequiredArgsConstructor
public class RunbookController {

    private final RunbookService runbookService;

    @GetMapping
    public ResponseEntity<Map<String, Object>> list() {
        List<Map<String, Object>> items = runbookService.list();
        return ResponseEntity.ok(Map.of("items", items));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(runbookService.create(body));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        runbookService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/step")
    public ResponseEntity<Map<String, Object>> advanceStep(
            @PathVariable Long id,
            @RequestBody Map<String, Integer> body) {
        int targetStep = body.getOrDefault("step", 0);
        return ResponseEntity.ok(runbookService.advanceStep(id, targetStep));
    }
}
