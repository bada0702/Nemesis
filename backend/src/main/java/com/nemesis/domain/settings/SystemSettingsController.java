package com.nemesis.domain.settings;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 전역 시스템 설정 조회/저장. 단일 행(id=1)을 읽고 쓴다.
 * 설정은 V10 시드로 항상 존재하지만, 안전하게 없으면 기본값으로 생성한다.
 */
@RestController
@RequestMapping("/api/settings/system")
@RequiredArgsConstructor
public class SystemSettingsController {

    private static final int ID = 1;
    private final SystemSettingsRepository repository;
    private final LlmSettingsSync          llmSettingsSync;

    @GetMapping
    public ResponseEntity<SystemSettings> get() {
        return ResponseEntity.ok(load());
    }

    @PutMapping
    public ResponseEntity<SystemSettings> update(@RequestBody Map<String, Object> body) {
        SystemSettings s = load();
        if (body.get("pollingIntervalSec")   != null) s.setPollingIntervalSec(asInt(body.get("pollingIntervalSec")));
        if (body.get("metricsRetentionDays") != null) s.setMetricsRetentionDays(asInt(body.get("metricsRetentionDays")));
        if (body.get("alertRetentionDays")   != null) s.setAlertRetentionDays(asInt(body.get("alertRetentionDays")));
        if (body.get("maxFailoverCount")     != null) s.setMaxFailoverCount(asInt(body.get("maxFailoverCount")));
        if (body.get("pingpongGuardSec")     != null) s.setPingpongGuardSec(asInt(body.get("pingpongGuardSec")));
        if (body.get("aiEnabled")            != null) s.setAiEnabled(Boolean.TRUE.equals(body.get("aiEnabled")));
        if (body.get("notificationEmail")    != null) s.setNotificationEmail((String) body.get("notificationEmail"));
        if (body.get("notificationSlack")    != null) s.setNotificationSlack((String) body.get("notificationSlack"));
        if (body.get("timezone")             != null) s.setTimezone((String) body.get("timezone"));
        if (body.get("language")             != null) s.setLanguage((String) body.get("language"));

        // ── AI(LLM) ──
        if (body.get("llmProvider")       != null) s.setLlmProvider((String) body.get("llmProvider"));
        if (body.get("llmOllamaBaseUrl")  != null) s.setLlmOllamaBaseUrl((String) body.get("llmOllamaBaseUrl"));
        if (body.get("llmOllamaModel")    != null) s.setLlmOllamaModel((String) body.get("llmOllamaModel"));
        if (body.get("llmAnthropicModel") != null) s.setLlmAnthropicModel((String) body.get("llmAnthropicModel"));
        if (body.get("llmOpenaiModel")    != null) s.setLlmOpenaiModel((String) body.get("llmOpenaiModel"));
        // API 키는 비어있지 않은 값이 올 때만 갱신(빈 값/누락 시 기존 키 유지)
        if (notBlank(body.get("llmAnthropicApiKey"))) s.setLlmAnthropicApiKey(((String) body.get("llmAnthropicApiKey")).trim());
        if (notBlank(body.get("llmOpenaiApiKey")))    s.setLlmOpenaiApiKey(((String) body.get("llmOpenaiApiKey")).trim());

        SystemSettings saved = repository.save(s);
        llmSettingsSync.apply(saved);   // 재기동 없이 라이브 LlmProperties에 즉시 반영
        return ResponseEntity.ok(saved);
    }

    private boolean notBlank(Object v) {
        return v instanceof String str && !str.isBlank();
    }

    private SystemSettings load() {
        return repository.findById(ID)
                .orElseGet(() -> repository.save(SystemSettings.builder().id(ID).build()));
    }

    private int asInt(Object v) {
        if (v instanceof Number n) return n.intValue();
        return Integer.parseInt(v.toString().trim());
    }
}
