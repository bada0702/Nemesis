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
        // 알림 리스트는 배지 카운트(pending/openFindings)와 일치하도록 actionable 항목만 노출한다.
        // (RESOLVED finding / REJECTED proposal 은 이력이지 알림이 아니다 — AI 운영 센터에서 조회.)
        out.put("recent", repo.findByStatusOrderByCreatedAtDesc(AiProposal.PENDING).stream().limit(10)
                .map(p -> Map.of("id", p.getId(), "status", p.getStatus(),
                        "triggerReason", p.getTriggerReason() == null ? "" : p.getTriggerReason(),
                        "createdAt", p.getCreatedAt())).toList());
        out.put("recentFindings", findingRepo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN).stream().limit(10)
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
