package com.nemesis.domain.runbook;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RunbookRepository extends JpaRepository<Runbook, Long> {
    List<Runbook> findAllByOrderByCreatedAtDesc();
}
