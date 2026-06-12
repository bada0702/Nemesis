package com.nemesis.domain.ai.llm;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/** OpenAI Chat Completions 제공자. */
@Component
public class OpenAiProvider implements LlmProvider {

    private final RestTemplate restTemplate;
    private final LlmProperties props;

    public OpenAiProvider(@Qualifier("llmRestTemplate") RestTemplate restTemplate, LlmProperties props) {
        this.restTemplate = restTemplate;
        this.props = props;
    }

    @Override public String name() { return "openai"; }

    @Override public boolean isConfigured() {
        String k = props.getOpenai().getApiKey();
        return k != null && !k.isBlank();
    }

    @Override
    @SuppressWarnings("unchecked")
    public String complete(String systemPrompt, String userPrompt) {
        Map<String, Object> body = Map.of(
                "model", props.getOpenai().getModel(),
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user",   "content", userPrompt)));
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.setBearerAuth(props.getOpenai().getApiKey());
        ResponseEntity<Map> resp = restTemplate.exchange(
                props.getOpenai().getBaseUrl() + "/v1/chat/completions",
                HttpMethod.POST, new HttpEntity<>(body, h), Map.class);
        List<Map<String, Object>> choices = (List<Map<String, Object>>) resp.getBody().get("choices");
        Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
        return (String) message.get("content");
    }
}
