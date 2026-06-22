package com.nemesis.domain.sync;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 폴더 동기화 작업 CRUD/실행/이력 + SSH 프로비저닝. */
@RestController
@RequestMapping("/api/clusters/{clusterId}/sync")
@RequiredArgsConstructor
public class SyncJobController {

    private final SyncService        syncService;
    private final SshProvisionService sshService;

    @GetMapping("/jobs")
    public ResponseEntity<List<SyncJob>> jobs(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(syncService.listJobs(clusterId));
    }

    @PostMapping("/jobs")
    public ResponseEntity<SyncJob> create(@PathVariable UUID clusterId, @RequestBody SyncJob body) {
        return ResponseEntity.ok(syncService.createJob(clusterId, body));
    }

    @PutMapping("/jobs/{jobId}")
    public ResponseEntity<SyncJob> update(@PathVariable UUID clusterId, @PathVariable UUID jobId,
                                          @RequestBody SyncJob body) {
        return ResponseEntity.ok(syncService.updateJob(jobId, body));
    }

    @DeleteMapping("/jobs/{jobId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId, @PathVariable UUID jobId) {
        syncService.deleteJob(jobId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/jobs/{jobId}/run")
    public ResponseEntity<Map<String, Object>> run(@PathVariable UUID clusterId, @PathVariable UUID jobId) {
        return ResponseEntity.ok(syncService.runJob(jobId, SyncHistory.Trigger.MANUAL));
    }

    @GetMapping("/history")
    public ResponseEntity<List<SyncHistory>> history(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(syncService.history(clusterId));
    }

    @PostMapping("/provision-ssh")
    public ResponseEntity<Map<String, Object>> provision(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(sshService.provision(clusterId));
    }
}
