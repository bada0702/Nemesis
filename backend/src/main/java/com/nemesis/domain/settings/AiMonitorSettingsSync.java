package com.nemesis.domain.settings;

import com.nemesis.domain.aiops.AiOperatorProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * DB의 SystemSettings.aiPredictEnabled 를 라이브 AiOperatorProperties.Monitor 빈에 반영한다.
 * - 기동 시(ApplicationReadyEvent): 저장된 값으로 초기화한다.
 * - 설정 변경 시(컨트롤러 PUT): 재기동 없이 즉시 반영한다.
 */
@Component
@RequiredArgsConstructor
public class AiMonitorSettingsSync {

    private static final int ID = 1;

    private final SystemSettingsRepository repository;
    private final AiOperatorProperties props;

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        repository.findById(ID).ifPresent(this::apply);
    }

    public void apply(SystemSettings s) {
        if (s == null) return;
        props.getMonitor().setPredictEnabled(s.isAiPredictEnabled());
    }
}
