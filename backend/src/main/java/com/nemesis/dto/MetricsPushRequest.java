package com.nemesis.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class MetricsPushRequest {
    private String hostname;
    private long   timestamp;

    private double cpuPercent;
    private double memoryPercent;
    private long   memoryUsedMb;
    private long   memoryTotalMb;

    private double diskPercent;
    private long   diskUsedGb;
    private long   diskTotalGb;

    private long networkRxBytesPerSec;
    private long networkTxBytesPerSec;

    private List<Map<String, String>> processes;
    private List<String>              errorLogPreview;

    private List<Map<String, Object>> apps;
    private List<Map<String, Object>> network;
    private List<Map<String, Object>> fc;
    private List<Map<String, Object>> gpfsVolumes;
    private List<String>              logs;
}
