package com.nemesis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.UUID;

@Data
@AllArgsConstructor
public class AgentRegisterResponse {
    private UUID nodeId;
    private UUID clusterId;
    private String clusterName;
    private String role;
    private int pullIntervalSeconds;
}
