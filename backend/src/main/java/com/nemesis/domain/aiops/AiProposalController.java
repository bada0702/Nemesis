package com.nemesis.domain.aiops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.security.TokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/ai/proposals")
@RequiredArgsConstructor
public class AiProposalController {

    private final AiProposalRepository repo;
    private final AiOperatorService service;
    private final TokenService tokenService;
    private final ObjectMapper mapper;

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @RequestParam(required = false) String status) {
        List<AiProposal> ps = (status == null || status.isBlank())
                ? repo.findTop50ByOrderByCreatedAtDesc()
                : repo.findByStatusOrderByCreatedAtDesc(status);
        return ResponseEntity.ok(ps.stream().map(this::dto).toList());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> get(@PathVariable UUID id) {
        return repo.findById(id).map(p -> ResponseEntity.ok(dto(p)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<Map<String, Object>> approve(
            @PathVariable UUID id, @RequestHeader("Authorization") String auth) {
        return ResponseEntity.ok(dto(service.approve(id, user(auth))));
    }

    @PostMapping("/{id}/reject")
    public ResponseEntity<Map<String, Object>> reject(
            @PathVariable UUID id, @RequestHeader("Authorization") String auth) {
        return ResponseEntity.ok(dto(service.reject(id, user(auth))));
    }

    private String user(String auth) {
        try { return tokenService.verify(auth.substring(7)).map(TokenService.Principal::username).orElse("?"); }
        catch (Exception e) { return "?"; }
    }

    private Map<String, Object> dto(AiProposal p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId()); m.put("clusterId", p.getClusterId());
        m.put("nodeId", p.getNodeId()); m.put("triggerType", p.getTriggerType());
        m.put("triggerReason", p.getTriggerReason()); m.put("diagnosis", p.getDiagnosis());
        m.put("rootCause", p.getRootCause()); m.put("confidence", p.getConfidence());
        m.put("status", p.getStatus()); m.put("decidedBy", p.getDecidedBy());
        m.put("createdAt", p.getCreatedAt());
        try { m.put("proposedActions", mapper.readValue(
                p.getProposedActions() == null ? "[]" : p.getProposedActions(), List.class)); }
        catch (Exception e) { m.put("proposedActions", List.of()); }
        return m;
    }
}
