package com.nemesis.domain.alert;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AlertRuleRepository extends JpaRepository<AlertRule, UUID> {
    List<AlertRule> findAllByOrderBySortOrderAsc();
}
