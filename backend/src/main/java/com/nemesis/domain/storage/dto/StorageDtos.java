package com.nemesis.domain.storage.dto;

import java.util.List;
import java.util.UUID;

public class StorageDtos {
    public record RegisterDeviceRequest(String wwid, String label, Long sizeBytes,
                                         Integer pathCount, UUID discoveredNodeId,
                                         String dirName, String fstype, UUID activeNodeId) {}

    public record BatchDeviceItem(String wwid, String dirName, String fstype,
                                   Long sizeBytes, Integer pathCount, UUID discoveredNodeId) {}

    public record BatchRegisterRequest(UUID activeNodeId, List<BatchDeviceItem> items) {}

    public record BatchItemResult(String wwid, boolean success, String error) {}
}
