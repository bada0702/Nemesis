package com.nemesis.domain.alert;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 알람 규칙(임계치) 조회/수정. 수정 결과는 대시보드 알람 생성에 즉시 반영된다. */
@RestController
@RequestMapping("/api/alerts/config")
@RequiredArgsConstructor
public class AlertConfigController {

    private final AlertRuleRepository repository;

    @GetMapping
    public ResponseEntity<Map<String, Object>> list() {
        List<Map<String, Object>> items = repository.findAllByOrderBySortOrderAsc()
                .stream().map(this::toMap).toList();
        return ResponseEntity.ok(Map.of("items", items));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable UUID id,
                                                      @RequestBody Map<String, Object> body) {
        AlertRule rule = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("AlertRule not found: " + id));
        if (body.get("name")        != null) rule.setName((String) body.get("name"));
        if (body.get("threshold")   != null) rule.setThreshold(asInt(body.get("threshold")));
        if (body.get("level")       != null) rule.setLevel((String) body.get("level"));
        if (body.get("cooldownMin") != null) rule.setCooldownMin(asInt(body.get("cooldownMin")));
        if (body.get("enabled")     != null) rule.setEnabled(Boolean.TRUE.equals(body.get("enabled")));
        return ResponseEntity.ok(toMap(repository.save(rule)));
    }

    private Map<String, Object> toMap(AlertRule r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",          r.getId());
        m.put("name",        r.getName());
        m.put("metric",      r.getMetric());
        m.put("threshold",   r.getThreshold());
        m.put("level",       r.getLevel());
        m.put("cooldownMin", r.getCooldownMin());
        m.put("enabled",     r.isEnabled());
        return m;
    }

    private int asInt(Object v) {
        if (v instanceof Number n) return n.intValue();
        return Integer.parseInt(v.toString().trim());
    }
}
