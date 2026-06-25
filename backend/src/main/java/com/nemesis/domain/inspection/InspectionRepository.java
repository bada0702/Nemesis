package com.nemesis.domain.inspection;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface InspectionRepository extends JpaRepository<Inspection, UUID> {
    List<Inspection> findAllByOrderByCreatedAtDesc();
}
