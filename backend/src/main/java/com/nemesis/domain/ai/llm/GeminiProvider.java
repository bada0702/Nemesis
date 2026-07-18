package com.nemesis.domain.ai.llm;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.List;
import java.util.Map;

/**
 * Google Gemini(Generative Language API) 제공자.
 * POST {baseUrl}/v1beta/models/{model}:generateContent?key={apiKey}
 * body: {contents:[{parts:[{text:user}]}], systemInstruction:{parts:[{text:system}]}}
 * resp: candidates[0].content.parts[0].text
 */
@Component
public class GeminiProvider implements LlmProvider {

    private final RestTemplate restTemplate;
    private final LlmProperties props;

    public GeminiProvider(@Qualifier("llmRestTemplate") RestTemplate restTemplate, LlmProperties props) {
        this.restTemplate = restTemplate;
        this.props = props;
    }

    @Override public String name() { return "gemini"; }

    @Override public boolean isConfigured() {
        String k = props.getGemini().getApiKey();
        return k != null && !k.isBlank();
    }

    @Override
    @SuppressWarnings("unchecked")
    public String complete(String systemPrompt, String userPrompt) {
        Map<String, Object> body = Map.of(
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                "contents", List.of(Map.of("parts", List.of(Map.of("text", userPrompt)))));
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        // API 키는 쿼리 파라미터로 전달(Google GL API 규약). URI 로 1회 인코딩.
        URI uri = UriComponentsBuilder
                .fromHttpUrl(props.getGemini().getBaseUrl())
                .path("/v1beta/models/{model}:generateContent")
                .queryParam("key", props.getGemini().getApiKey())
                .buildAndExpand(props.getGemini().getModel())
                .encode().toUri();
        ResponseEntity<Map> resp = restTemplate.exchange(
                uri, HttpMethod.POST, new HttpEntity<>(body, h), Map.class);
        List<Map<String, Object>> candidates = (List<Map<String, Object>>) resp.getBody().get("candidates");
        if (candidates == null || candidates.isEmpty()) return "";
        Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
        List<Map<String, Object>> parts = (List<Map<String, Object>>) content.get("parts");
        if (parts == null || parts.isEmpty()) return "";
        return (String) parts.get(0).get("text");
    }
}
