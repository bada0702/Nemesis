package com.nemesis.domain.install;

import com.nemesis.domain.agent.AgentKey;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.install.dto.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/agent-install")
@RequiredArgsConstructor
public class AgentInstallController {

    private final AgentInstallService installService;
    private final AgentKeyRepository  agentKeyRepository;

    @PostMapping("/test")
    public ResponseEntity<TestConnResult> testConnection(@RequestBody TestConnRequest req) {
        return ResponseEntity.ok(installService.testConnection(req));
    }

    @PostMapping("/install")
    public ResponseEntity<Map<String, String>> install(@RequestBody InstallRequest req) {
        if (req.getJobId() == null || req.getJobId().isBlank()) {
            req.setJobId(UUID.randomUUID().toString());
        }
        installService.startInstall(req);
        return ResponseEntity.ok(Map.of("jobId", req.getJobId()));
    }

    @GetMapping(value = "/stream/{jobId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable String jobId) {
        return installService.registerEmitter(jobId);
    }

    @GetMapping("/keys")
    public ResponseEntity<List<Map<String, String>>> listKeys(@RequestParam UUID clusterId) {
        List<Map<String, String>> keys = agentKeyRepository
                .findByClusterIdAndRevokedFalse(clusterId)
                .stream()
                .map(k -> Map.of(
                    "id",     k.getId().toString(),
                    "apiKey", k.getApiKey(),
                    "label",  k.getNode() != null ? k.getNode().getHostname() : "공용 키"
                ))
                .collect(Collectors.toList());
        return ResponseEntity.ok(keys);
    }
}
