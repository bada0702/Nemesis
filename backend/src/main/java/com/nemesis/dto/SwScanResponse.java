package com.nemesis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
@AllArgsConstructor
public class SwScanResponse {
    private List<Map<String, Object>> known;
    private List<Map<String, Object>> unknown;
}
