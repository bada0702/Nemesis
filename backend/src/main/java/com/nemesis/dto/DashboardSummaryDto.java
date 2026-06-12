package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;

import java.time.OffsetDateTime;

@Data
@Builder
public class DashboardSummaryDto {
    private int clusterCount;
    private int activeNodeCount;
    private int issueWaitingCount;
    private int vipCount;
    private int agentCount;
    private OffsetDateTime lastUpdatedAt;
}
