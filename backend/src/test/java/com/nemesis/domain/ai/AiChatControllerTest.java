package com.nemesis.domain.ai;

import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.aiops.AiOperatorClient;
import org.junit.jupiter.api.Test;

import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiChatControllerTest {

    @Test
    void uses_aibot_when_available() {
        AiOperatorClient aibot = mock(AiOperatorClient.class);
        LlmService llm = mock(LlmService.class);
        when(aibot.health()).thenReturn(true);
        when(aibot.chat("상태?")).thenReturn("aibot 응답");
        AiChatController c = new AiChatController(llm, aibot);
        var resp = c.chat(Map.of("message", "상태?"));
        assertThat(resp.getBody().get("reply")).isEqualTo("aibot 응답");
        verifyNoInteractions(llm);
    }

    @Test
    void falls_back_to_llm_when_aibot_down() throws Exception {
        AiOperatorClient aibot = mock(AiOperatorClient.class);
        LlmService llm = mock(LlmService.class);
        when(aibot.health()).thenReturn(false);
        when(llm.isAvailable()).thenReturn(true);
        when(llm.chat(anyString(), eq("상태?"))).thenReturn("llm 응답");
        AiChatController c = new AiChatController(llm, aibot);
        var resp = c.chat(Map.of("message", "상태?"));
        assertThat(resp.getBody().get("reply")).isEqualTo("llm 응답");
    }
}
