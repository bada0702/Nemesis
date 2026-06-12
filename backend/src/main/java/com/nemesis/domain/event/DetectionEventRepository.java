package com.nemesis.domain.event;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface DetectionEventRepository extends JpaRepository<DetectionEvent, Long> {

    List<DetectionEvent> findByClusterGroupIdOrderByCreatedAtDesc(UUID clusterGroupId, Pageable pageable);

    List<DetectionEvent> findByNodeIdOrderByCreatedAtDesc(UUID nodeId, Pageable pageable);

    List<DetectionEvent> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
