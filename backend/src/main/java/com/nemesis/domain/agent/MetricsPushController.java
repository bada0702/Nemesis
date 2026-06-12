package com.nemesis.domain.agent;

import com.nemesis.domain.ai.AiFaultService;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class MetricsPushController {

    private final AgentService   agentService;
    private final AiFaultService aiFaultService;

    @PostMapping("/metrics")
    public ResponseEntity<Void> pushMetrics(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @RequestBody MetricsPushRequest req) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401).build();
        }

        String token = authHeader.substring(7);
        agentService.pushMetrics(token, req);

        if (req.getErrorLogPreview() != null && !req.getErrorLogPreview().isEmpty()) {
            UUID nodeId = agentService.resolveNodeId(token);
            aiFaultService.analyzeAsync(nodeId);
        }

        return ResponseEntity.ok().build();
    }
}
