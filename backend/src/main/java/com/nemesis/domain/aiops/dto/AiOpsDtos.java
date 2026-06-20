package com.nemesis.domain.aiops.dto;

import java.util.List;
import java.util.Map;

public class AiOpsDtos {
    public record Action(String description, String command, String target, String riskLevel) {}
    public record InvestigateResponse(String diagnosis, String rootCause,
                                      List<Action> proposedActions, double confidence) {}
    public record ExecuteResponse(String status, List<Map<String, Object>> steps, String verification) {}
}
