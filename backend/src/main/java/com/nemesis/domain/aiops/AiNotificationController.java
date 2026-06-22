package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.monitor.AiFinding;
import com.nemesis.domain.aiops.monitor.AiFindingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/ai/notifications")
@RequiredArgsConstructor
public class AiNotificationController {
    private final AiProposalRepository repo;
    private final AiFindingRepository findingRepo;

    @GetMapping
    public Map<String, Object> feed() {
        Map<String, Object> out = new HashMap<>();
        out.put("pending", repo.countByStatus(AiProposal.PENDING));
        out.put("openFindings", findingRepo.countByStatus(AiFinding.OPEN));
        out.put("recent", repo.findTop50ByOrderByCreatedAtDesc().stream().limit(10)
                .map(p -> Map.of("id", p.getId(), "status", p.getStatus(),
                        "triggerReason", p.getTriggerReason() == null ? "" : p.getTriggerReason(),
                        "createdAt", p.getCreatedAt())).toList());
        out.put("recentFindings", findingRepo.findTop50ByOrderByLastSeenAtDesc().stream().limit(10)
                .map(f -> {
                    Map<String, Object> mm = new HashMap<>();
                    mm.put("id", f.getId());
                    mm.put("signalType", f.getSignalType());
                    mm.put("severity", f.getSeverity());
                    mm.put("status", f.getStatus());
                    mm.put("summary", f.getSummary());
                    mm.put("proposalId", f.getProposalId());
                    mm.put("lastSeenAt", f.getLastSeenAt());
                    return mm;
                }).toList());
        return out;
    }
}
