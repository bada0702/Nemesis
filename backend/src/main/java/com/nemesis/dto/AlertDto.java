package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class AlertDto {
    private List<AlertItem> items;

    @Data
    @Builder
    public static class AlertItem {
        private String level;
        private String message;
        private String createdAt;
    }
}
