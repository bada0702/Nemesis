package com.nemesis.domain.dashboard;

import com.nemesis.dto.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    @GetMapping("/summary")
    public ResponseEntity<DashboardSummaryDto> getSummary() {
        return ResponseEntity.ok(dashboardService.getSummary());
    }

    @GetMapping("/performance")
    public ResponseEntity<DashboardPerformanceDto> getPerformance() {
        return ResponseEntity.ok(dashboardService.getPerformance());
    }

    @GetMapping("/sw-status")
    public ResponseEntity<DashboardSwStatusDto> getSwStatus() {
        return ResponseEntity.ok(dashboardService.getSwStatus());
    }

    @GetMapping("/docker")
    public ResponseEntity<Map<String, Object>> getDocker() {
        return ResponseEntity.ok(dashboardService.getDockerStatus());
    }

    @GetMapping("/alerts")
    public ResponseEntity<AlertDto> getAlerts() {
        return ResponseEntity.ok(dashboardService.getAlerts());
    }
}
