package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class DashboardPerformanceDto {
    private double avgCpuPercent;
    private double avgMemoryPercent;
    private double avgDiskPercent;
    private List<TimePoint> timeline;

    @Data
    @Builder
    public static class TimePoint {
        private long timestamp;
        private double avgCpu;
        private double avgMem;
    }
}
