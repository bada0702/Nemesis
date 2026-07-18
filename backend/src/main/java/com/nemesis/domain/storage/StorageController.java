package com.nemesis.domain.storage;

import com.nemesis.domain.storage.dto.StorageDtos.BatchItemResult;
import com.nemesis.domain.storage.dto.StorageDtos.BatchRegisterRequest;
import com.nemesis.domain.storage.dto.StorageDtos.RegisterDeviceRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters/{clusterId}/storage")
@RequiredArgsConstructor
public class StorageController {

    private final StorageService storageService;

    @GetMapping("/devices")
    public ResponseEntity<List<StorageDevice>> devices(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(storageService.listDevices(clusterId));
    }

    @PostMapping("/scan")
    public ResponseEntity<List<StorageService.DiscoveredDevice>> scan(
            @PathVariable UUID clusterId, @RequestParam UUID nodeId) {
        return ResponseEntity.ok(storageService.scan(clusterId, nodeId));
    }

    @PostMapping("/devices")
    public ResponseEntity<StorageDevice> register(@PathVariable UUID clusterId,
                                                   @RequestBody RegisterDeviceRequest body) {
        return ResponseEntity.ok(storageService.registerDevice(clusterId, body));
    }

    @PostMapping("/devices/batch")
    public ResponseEntity<List<BatchItemResult>> registerBatch(@PathVariable UUID clusterId,
                                                                 @RequestBody BatchRegisterRequest body) {
        return ResponseEntity.ok(storageService.registerDevicesBatch(clusterId, body));
    }

    @DeleteMapping("/devices/{deviceId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId, @PathVariable UUID deviceId) {
        storageService.deleteDevice(clusterId, deviceId);
        return ResponseEntity.noContent().build();
    }
}
