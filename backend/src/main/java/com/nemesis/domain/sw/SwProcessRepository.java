package com.nemesis.domain.sw;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SwProcessRepository extends JpaRepository<SwProcess, Long> {
    List<SwProcess> findByNodeId(UUID nodeId);
    boolean existsByNodeIdAndName(UUID nodeId, String name);
}
