package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Data
@Builder
public class ClusterStatusResponse {

    private UUID   clusterId;
    private String clusterName;
    private String vip;
    private List<NodeStatus> nodes;

    @Data
    @Builder
    public static class NodeStatus {
        private UUID            nodeId;
        private String          hostname;
        private String          ipAddress;
        private String          serviceIp;
        private String          osType;
        private String          role;
        private String          state;
        private OffsetDateTime  lastSeenAt;
        private NodeMetrics     metrics;
    }

    @Data
    @Builder
    public static class NodeMetrics {
        private double                     cpuPercent;
        private double                     memoryPercent;
        private double                     diskPercent;
        private long                       networkRxBytesPerSec;
        private long                       networkTxBytesPerSec;
        private long                       timestamp;
        private List<Map<String, String>>  processes;
    }
}
