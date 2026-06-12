package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class DashboardSwStatusDto {
    private List<SwItem> items;

    @Data
    @Builder
    public static class SwItem {
        private String name;
        private String type;
        private String state;
        private String node;
    }
}
