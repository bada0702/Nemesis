package com.nemesis.domain.ai.llm;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

@Configuration
public class LlmConfig {

    @Bean(name = "llmRestTemplate")
    public RestTemplate llmRestTemplate(LlmProperties props) {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(3_000);
        f.setReadTimeout(Math.max(2, props.getTimeoutSeconds()) * 1_000);
        return new RestTemplate(f);
    }

    @Bean(name = "chatLlmRestTemplate")
    public RestTemplate chatLlmRestTemplate(LlmProperties props) {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(5_000);
        f.setReadTimeout(Math.max(30, props.getChatTimeoutSeconds()) * 1_000);
        return new RestTemplate(f);
    }
}
