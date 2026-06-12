package com.nemesis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class AiFaultAnalysisDto {
    private Long   id;
    private String nodeId;
    private String rootCause;
    private List<Map<String, Object>> fixCommands;
    private String triggerType;
    private String status;
    private OffsetDateTime createdAt;
}
