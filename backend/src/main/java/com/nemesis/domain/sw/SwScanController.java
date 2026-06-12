package com.nemesis.domain.sw;

import com.nemesis.dto.SwScanResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sw")
@RequiredArgsConstructor
public class SwScanController {

    private final SwScanService swScanService;

    @GetMapping("/scan")
    public ResponseEntity<SwScanResponse> scan(@RequestParam UUID nodeId) {
        Map<String, List<Map<String, Object>>> result = swScanService.scan(nodeId);
        return ResponseEntity.ok(new SwScanResponse(result.get("known"), result.get("unknown")));
    }

    @PostMapping("/register")
    public ResponseEntity<Map<String, Integer>> register(@RequestBody Map<String, Object> body) {
        UUID nodeId = UUID.fromString((String) body.get("nodeId"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> processes = (List<Map<String, Object>>) body.get("processes");
        int registered = swScanService.register(nodeId, processes);
        return ResponseEntity.ok(Map.of("registered", registered));
    }

    @GetMapping("/list")
    public ResponseEntity<Map<String, Object>> list(@RequestParam UUID nodeId) {
        List<SwProcess> items = swScanService.list(nodeId);
        List<Map<String, Object>> result = items.stream().map(s -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id",           s.getId());
            m.put("name",         s.getName());
            m.put("displayName",  s.getDisplayName());
            m.put("type",         s.getType());
            m.put("status",       s.getStatus());
            m.put("pid",          s.getPid());
            m.put("registeredAt", s.getRegisteredAt());
            return m;
        }).toList();
        return ResponseEntity.ok(Map.of("items", result));
    }
}
