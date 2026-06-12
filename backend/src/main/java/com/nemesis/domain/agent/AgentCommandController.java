package com.nemesis.domain.agent;

import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class AgentCommandController {

    private final NodeRepository      nodeRepository;
    private final AgentCommandClient  commandClient;

    @PostMapping("/{nodeId}/execute")
    public ResponseEntity<Map<String, Object>> execute(
            @PathVariable UUID nodeId,
            @RequestBody Map<String, String> body) {

        String command = body.get("command");
        if (command == null || command.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "command is required"));
        }

        Node node = nodeRepository.findById(nodeId)
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));

        AgentCommandClient.Result r = commandClient.execute(node, command);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("stdout", r.stdout());
        resp.put("stderr", r.stderr());
        resp.put("exitCode", r.exitCode());
        if (r.error() != null) resp.put("error", r.error());

        return r.error() != null && r.exitCode() < 0
                ? ResponseEntity.status(502).body(resp)
                : ResponseEntity.ok(resp);
    }
}
