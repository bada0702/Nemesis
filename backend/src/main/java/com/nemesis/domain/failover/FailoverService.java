package com.nemesis.domain.failover;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 페일오버 진입점(수동). 실제 실행은 FailoverOrchestrator로 위임해
 * 수동/감지/AI 트리거가 동일 경로를 타도록 일원화한다(B-3).
 */
@Service
@RequiredArgsConstructor
public class FailoverService {

    private final FailoverOrchestrator orchestrator;
    private final FailoverHistoryRepository historyRepository;

    public Map<String, Object> manualFailover(UUID clusterId, Map<String, Object> body) {
        UUID fromNodeId = body.get("fromNodeId") != null
                ? UUID.fromString((String) body.get("fromNodeId")) : null;
        UUID toNodeId = body.get("toNodeId") != null
                ? UUID.fromString((String) body.get("toNodeId")) : null;

        FailoverOrchestrator.Result r = orchestrator.failover(
                clusterId, fromNodeId, toNodeId, FailoverHistory.Trigger.MANUAL, "수동 페일오버");

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("success", r.success());
        resp.put("status", r.status().name());
        resp.put("message", r.message());
        resp.put("newPrimary", r.toNodeId());
        resp.put("timestamp", OffsetDateTime.now().toString());
        return resp;
    }

    public java.util.List<FailoverHistory> history(UUID clusterId) {
        return historyRepository.findByClusterGroupIdOrderByCreatedAtDesc(clusterId);
    }
}
