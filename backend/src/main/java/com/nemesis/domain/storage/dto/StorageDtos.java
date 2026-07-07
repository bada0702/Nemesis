package com.nemesis.domain.storage.dto;

import java.util.UUID;

public class StorageDtos {
    public record RegisterDeviceRequest(String wwid, String label, Long sizeBytes,
                                         Integer pathCount, UUID discoveredNodeId) {}
}
