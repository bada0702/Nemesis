package com.nemesis.domain.settings;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

/** 전역 시스템 설정(단일 행, id=1). 모니터링·HA·AI·알림·로케일 파라미터. */
@Entity
@Table(name = "system_settings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SystemSettings {

    @Id
    @Builder.Default
    private Integer id = 1;

    @Column(name = "polling_interval_sec", nullable = false)
    @Builder.Default
    private int pollingIntervalSec = 5;

    @Column(name = "metrics_retention_days", nullable = false)
    @Builder.Default
    private int metricsRetentionDays = 30;

    @Column(name = "alert_retention_days", nullable = false)
    @Builder.Default
    private int alertRetentionDays = 30;

    @Column(name = "max_failover_count", nullable = false)
    @Builder.Default
    private int maxFailoverCount = 5;

    @Column(name = "pingpong_guard_sec", nullable = false)
    @Builder.Default
    private int pingpongGuardSec = 180;

    @Column(name = "ai_enabled", nullable = false)
    @Builder.Default
    private boolean aiEnabled = false;

    /** SP5: 추세 기반 장애 예측 스캔 on/off (반응형 능동 모니터링과 별개). */
    @Column(name = "ai_predict_enabled", nullable = false)
    @Builder.Default
    private boolean aiPredictEnabled = false;

    @Column(name = "notification_email", length = 500)
    @Builder.Default
    private String notificationEmail = "";

    @Column(name = "notification_slack", length = 500)
    @Builder.Default
    private String notificationSlack = "";

    @Column(nullable = false, length = 50)
    @Builder.Default
    private String timezone = "Asia/Seoul";

    @Column(nullable = false, length = 10)
    @Builder.Default
    private String language = "ko";

    // ── AI(LLM) 설정 ──────────────────────────────────────────
    @Column(name = "llm_provider", nullable = false, length = 20)
    @Builder.Default
    private String llmProvider = "ollama";

    @Column(name = "llm_ollama_base_url", length = 200)
    @Builder.Default
    private String llmOllamaBaseUrl = "";

    @Column(name = "llm_ollama_model", length = 100)
    @Builder.Default
    private String llmOllamaModel = "";

    /** 비밀값: GET 응답에 노출하지 않는다(아래 *KeySet 으로 설정 여부만 노출). */
    @com.fasterxml.jackson.annotation.JsonIgnore
    @Column(name = "llm_anthropic_api_key", length = 200)
    @Builder.Default
    private String llmAnthropicApiKey = "";

    @Column(name = "llm_anthropic_model", length = 100)
    @Builder.Default
    private String llmAnthropicModel = "";

    @com.fasterxml.jackson.annotation.JsonIgnore
    @Column(name = "llm_openai_api_key", length = 200)
    @Builder.Default
    private String llmOpenaiApiKey = "";

    @Column(name = "llm_openai_model", length = 100)
    @Builder.Default
    private String llmOpenaiModel = "";

    @com.fasterxml.jackson.annotation.JsonIgnore
    @Column(name = "llm_gemini_api_key", length = 200)
    @Builder.Default
    private String llmGeminiApiKey = "";

    @Column(name = "llm_gemini_model", length = 100)
    @Builder.Default
    private String llmGeminiModel = "";

    /** 키 노출 없이 설정 여부만 프론트에 전달. */
    @Transient
    public boolean isLlmAnthropicApiKeySet() {
        return llmAnthropicApiKey != null && !llmAnthropicApiKey.isBlank();
    }

    @Transient
    public boolean isLlmOpenaiApiKeySet() {
        return llmOpenaiApiKey != null && !llmOpenaiApiKey.isBlank();
    }

    @Transient
    public boolean isLlmGeminiApiKeySet() {
        return llmGeminiApiKey != null && !llmGeminiApiKey.isBlank();
    }

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @PreUpdate
    @PrePersist
    void touch() {
        this.updatedAt = OffsetDateTime.now();
    }
}
