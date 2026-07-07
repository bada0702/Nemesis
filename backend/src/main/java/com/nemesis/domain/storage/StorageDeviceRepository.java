package com.nemesis.domain.storage;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface StorageDeviceRepository extends JpaRepository<StorageDevice, UUID> {
    List<StorageDevice> findByClusterId(UUID clusterId);
    Optional<StorageDevice> findByClusterIdAndWwid(UUID clusterId, String wwid);
}
