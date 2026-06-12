package com.nemesis.domain.ai.llm;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/** 온프레미스 Ollama(/api/chat) 제공자. */
@Component
public class OllamaProvider implements LlmProvider {

    private final RestTemplate restTemplate;
    private final RestTemplate chatRestTemplate;
    private final LlmProperties props;

    public OllamaProvider(@Qualifier("llmRestTemplate") RestTemplate restTemplate,
                          @Qualifier("chatLlmRestTemplate") RestTemplate chatRestTemplate,
                          LlmProperties props) {
        this.restTemplate = restTemplate;
        this.chatRestTemplate = chatRestTemplate;
        this.props = props;
    }

    @Override public String name() { return "ollama"; }

    @Override public boolean isConfigured() { return true; } // 로컬 서버, 키 불필요

    @Override
    @SuppressWarnings("unchecked")
    public String complete(String systemPrompt, String userPrompt) {
        return doComplete(systemPrompt, userPrompt, restTemplate);
    }

    @Override
    @SuppressWarnings("unchecked")
    public String completeChat(String systemPrompt, String userPrompt) {
        String chatModel = props.getOllama().getChatModel();
        String model = (chatModel != null && !chatModel.isBlank()) ? chatModel : props.getOllama().getModel();
        return doComplete(model, systemPrompt, userPrompt, chatRestTemplate);
    }

    @SuppressWarnings("unchecked")
    private String doComplete(String systemPrompt, String userPrompt, RestTemplate rt) {
        return doComplete(props.getOllama().getModel(), systemPrompt, userPrompt, rt);
    }

    @SuppressWarnings("unchecked")
    private String doComplete(String model, String systemPrompt, String userPrompt, RestTemplate rt) {
        Map<String, Object> body = Map.of(
                "model", model,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user",   "content", userPrompt)),
                "stream", false);
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map> resp = rt.exchange(
                props.getOllama().getBaseUrl() + "/api/chat",
                HttpMethod.POST, new HttpEntity<>(body, h), Map.class);
        Map<String, Object> msg = (Map<String, Object>) resp.getBody().get("message");
        return (String) msg.get("content");
    }
}
