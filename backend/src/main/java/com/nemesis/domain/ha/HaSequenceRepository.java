package com.nemesis.domain.ha;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface HaSequenceRepository extends JpaRepository<HaSequence, UUID> {
    List<HaSequence> findByClusterGroupId(UUID clusterGroupId);
    Optional<HaSequence> findByClusterGroupIdAndType(UUID clusterGroupId, String type);
}
