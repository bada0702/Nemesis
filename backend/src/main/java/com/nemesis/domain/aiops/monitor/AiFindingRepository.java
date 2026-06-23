package com.nemesis.domain.aiops.monitor;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AiFindingRepository extends JpaRepository<AiFinding, UUID> {
    Optional<AiFinding> findByFingerprintAndStatus(String fingerprint, String status);
    List<AiFinding> findByStatusOrderByLastSeenAtDesc(String status);
    List<AiFinding> findByStatusAndCategoryOrderByLastSeenAtDesc(String status, String category);
    List<AiFinding> findTop50ByOrderByLastSeenAtDesc();
    long countByStatus(String status);
}
