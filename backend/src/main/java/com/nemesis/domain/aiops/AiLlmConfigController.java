package com.nemesis.domain.aiops;

import com.nemesis.domain.settings.SystemSettings;
import com.nemesis.domain.settings.SystemSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * aibot 사이드카 전용 LLM 설정 조회.
 * aibot이 자기 .env 대신 Nemesis 시스템 설정의 모델을 단일 출처로 쓰도록,
 * 시크릿(API 키)을 제외한 provider/모델/base-url만 노출한다.
 * RbacFilter에서 사용자 토큰 검증을 면제하고, 여기서 aibot 공유 토큰을 직접 검증한다.
 */
@RestController
@RequestMapping("/api/ai/llm-config")
@RequiredArgsConstructor
public class AiLlmConfigController {

    private static final int ID = 1;
    private final SystemSettingsRepository repository;
    private final AiOperatorProperties aibotProps;

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(
            @RequestHeader(value = "Authorization", required = false) String auth) {

        String token = aibotProps.getToken();
        if (token == null || token.isBlank()
                || auth == null || !auth.equals("Bearer " + token)) {
            return ResponseEntity.status(401).body(Map.of("error", "aibot 토큰 불일치"));
        }

        SystemSettings s = repository.findById(ID).orElse(null);
        Map<String, Object> body = new HashMap<>();
        if (s != null) {
            body.put("llmProvider", s.getLlmProvider());
            body.put("llmOllamaModel", s.getLlmOllamaModel());
            body.put("llmOllamaBaseUrl", s.getLlmOllamaBaseUrl());
            body.put("llmOpenaiModel", s.getLlmOpenaiModel());
        }
        return ResponseEntity.ok(body);
    }
}
