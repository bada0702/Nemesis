package com.nemesis.domain.ai.llm;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Phase C LLM 설정. nemesis.llm.* 로 조정. provider로 활성 제공자를 선택한다.
 */
@Component
@ConfigurationProperties(prefix = "nemesis.llm")
@Getter
@Setter
public class LlmProperties {

    /** 활성 제공자: ollama | openai | anthropic */
    private String provider = "ollama";

    /** HA 판단용 LLM 타임아웃(초). 초과 시 Rule 폴백. HA를 막지 않도록 짧게. */
    private int timeoutSeconds = 10;

    /** 채팅용 LLM 타임아웃(초). 대형 모델의 긴 응답을 기다릴 수 있게 넉넉하게. */
    private int chatTimeoutSeconds = 120;

    /** 페일오버 판단 채택 신뢰도 임계. 미만이면 보수적으로 처리. */
    private double confidenceThreshold = 0.7;

    private Ollama    ollama    = new Ollama();
    private OpenAi    openai    = new OpenAi();
    private Anthropic anthropic = new Anthropic();
    private Gemini    gemini    = new Gemini();

    @Getter @Setter
    public static class Ollama {
        private String baseUrl   = "http://localhost:11434";
        private String model     = "gemma2:9b";
        /** 채팅 전용 모델. 비어 있으면 model과 동일하게 사용. */
        private String chatModel = "";
    }

    @Getter @Setter
    public static class OpenAi {
        private String apiKey  = "";
        private String baseUrl = "https://api.openai.com";
        private String model   = "gpt-4o-mini";
    }

    @Getter @Setter
    public static class Anthropic {
        private String apiKey   = "";
        private String baseUrl  = "https://api.anthropic.com";
        private String model    = "claude-haiku-4-5"; // 저지연 장애판단 분류기용 고속·저가 모델
        private String version  = "2023-06-01";
        private int    maxTokens = 1024;
    }

    @Getter @Setter
    public static class Gemini {
        private String apiKey  = "";
        private String baseUrl = "https://generativelanguage.googleapis.com";
        private String model   = "gemini-2.0-flash";
    }
}
