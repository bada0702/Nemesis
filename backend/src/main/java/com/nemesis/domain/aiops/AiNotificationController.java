package com.nemesis.domain.aiops;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/ai/notifications")
@RequiredArgsConstructor
public class AiNotificationController {
    private final AiProposalRepository repo;

    @GetMapping
    public Map<String, Object> feed() {
        return Map.of(
            "pending", repo.countByStatus(AiProposal.PENDING),
            "recent", repo.findTop50ByOrderByCreatedAtDesc().stream().limit(10)
                .map(p -> Map.of("id", p.getId(), "status", p.getStatus(),
                        "triggerReason", p.getTriggerReason() == null ? "" : p.getTriggerReason(),
                        "createdAt", p.getCreatedAt())).toList());
    }
}
