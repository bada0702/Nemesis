package com.nemesis.domain.ai.llm;

/**
 * Phase C-1: LLM 제공자 추상화. Ollama/OpenAI/Anthropic을 동일 인터페이스로 다룬다.
 * 구현체는 동기 호출이며, 타임아웃은 주입된 RestTemplate에서 강제한다(HA가 LLM에 묶이지 않게).
 */
public interface LlmProvider {

    /** 설정의 nemesis.llm.provider 값과 매칭되는 이름(ollama/openai/anthropic). */
    String name();

    /** API 키 등 필수 설정이 갖춰졌는지. */
    boolean isConfigured();

    /** HA 판단/분석용 완성 요청(짧은 타임아웃). 실패 시 예외를 던진다. */
    String complete(String systemPrompt, String userPrompt) throws Exception;

    /** 채팅용 완성 요청(긴 타임아웃). 기본 구현은 complete()에 위임. */
    default String completeChat(String systemPrompt, String userPrompt) throws Exception {
        return complete(systemPrompt, userPrompt);
    }
}
