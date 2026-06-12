package com.nemesis.domain.ai.llm;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * Anthropic Messages API 제공자 (POST /v1/messages).
 * 헤더: x-api-key, anthropic-version. 응답 content[0].text를 추출한다.
 * 기본 모델은 저지연 분류기용 claude-haiku-4-5.
 */
@Component
public class AnthropicProvider implements LlmProvider {

    private final RestTemplate restTemplate;
    private final LlmProperties props;

    public AnthropicProvider(@Qualifier("llmRestTemplate") RestTemplate restTemplate, LlmProperties props) {
        this.restTemplate = restTemplate;
        this.props = props;
    }

    @Override public String name() { return "anthropic"; }

    @Override public boolean isConfigured() {
        String k = props.getAnthropic().getApiKey();
        return k != null && !k.isBlank();
    }

    @Override
    @SuppressWarnings("unchecked")
    public String complete(String systemPrompt, String userPrompt) {
        LlmProperties.Anthropic cfg = props.getAnthropic();
        Map<String, Object> body = Map.of(
                "model", cfg.getModel(),
                "max_tokens", cfg.getMaxTokens(),
                "system", systemPrompt,
                "messages", List.of(Map.of("role", "user", "content", userPrompt)));

        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.set("x-api-key", cfg.getApiKey());
        h.set("anthropic-version", cfg.getVersion());

        ResponseEntity<Map> resp = restTemplate.exchange(
                cfg.getBaseUrl() + "/v1/messages",
                HttpMethod.POST, new HttpEntity<>(body, h), Map.class);

        List<Map<String, Object>> content = (List<Map<String, Object>>) resp.getBody().get("content");
        // content는 블록 배열. 첫 text 블록을 반환.
        for (Map<String, Object> block : content) {
            if ("text".equals(block.get("type"))) return (String) block.get("text");
        }
        return "";
    }
}
