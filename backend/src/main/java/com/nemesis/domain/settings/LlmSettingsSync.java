package com.nemesis.domain.settings;

import com.nemesis.domain.ai.llm.LlmProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * DB의 SystemSettings LLM 설정을 라이브 LlmProperties 빈에 반영한다.
 * - 기동 시(ApplicationReadyEvent): 저장된 값으로 env 기본값을 덮어쓴다.
 * - 설정 변경 시(컨트롤러 PUT): 재기동 없이 즉시 반영한다.
 * 빈 값은 적용하지 않아 미설정 항목은 기존(env) 값을 유지한다.
 */
@Component
@RequiredArgsConstructor
public class LlmSettingsSync {

    private static final int ID = 1;

    private final SystemSettingsRepository repository;
    private final LlmProperties props;

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        repository.findById(ID).ifPresent(this::apply);
    }

    public void apply(SystemSettings s) {
        if (s == null) return;
        if (notBlank(s.getLlmProvider()))        props.setProvider(s.getLlmProvider().trim());
        if (notBlank(s.getLlmOllamaBaseUrl()))   props.getOllama().setBaseUrl(s.getLlmOllamaBaseUrl().trim());
        if (notBlank(s.getLlmOllamaModel()))     props.getOllama().setModel(s.getLlmOllamaModel().trim());
        if (notBlank(s.getLlmAnthropicApiKey())) props.getAnthropic().setApiKey(s.getLlmAnthropicApiKey().trim());
        if (notBlank(s.getLlmAnthropicModel()))  props.getAnthropic().setModel(s.getLlmAnthropicModel().trim());
        if (notBlank(s.getLlmOpenaiApiKey()))    props.getOpenai().setApiKey(s.getLlmOpenaiApiKey().trim());
        if (notBlank(s.getLlmOpenaiModel()))     props.getOpenai().setModel(s.getLlmOpenaiModel().trim());
    }

    private boolean notBlank(String v) {
        return v != null && !v.isBlank();
    }
}
