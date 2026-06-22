package com.nemesis.domain.aiops.dto;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public class AiOpsDtos {
    public record Action(String description, String command, String target, String riskLevel) {}
    public record InvestigateResponse(String diagnosis, String rootCause,
                                      List<Action> proposedActions, double confidence) {}
    public record ExecuteResponse(String status, List<Map<String, Object>> steps, String verification) {}

    /** SP3: 1차 결정론 필터가 추린 의심 신호. */
    public record Suspect(UUID nodeId, UUID clusterId, String hostname, String role,
                          String signalType, String severity, Map<String, Object> detail) {}
    /** SP3: 사이드카 /ai/scan 응답의 개별 finding. */
    public record ScanFinding(String signalType, String severity, String summary,
                              String diagnosis, String rootCause,
                              List<Action> proposedActions, double confidence) {}
    /** SP3: /ai/scan 응답. */
    public record ScanResponse(List<ScanFinding> findings) {}
}
