package com.nemesis.domain.ai;

import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.aiops.AiOperatorClient;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiChatController {

    private final LlmService llmService;
    private final AiOperatorClient aibot;

    private static final String CHAT_SYSTEM =
            "당신은 Nemesis HA 시스템의 AI 어시스턴트입니다. " +
            "AIX/Linux 엔터프라이즈 인프라·고가용성·장애 분석 전문가로서 한국어로 간결하게 답하세요.";

    @PostMapping("/chat")
    public ResponseEntity<Map<String, String>> chat(@RequestBody Map<String, String> req) {
        String message = req.getOrDefault("message", "").trim();
        if (message.isEmpty())
            return ResponseEntity.badRequest().body(Map.of("error", "message가 비어 있습니다."));

        // 1순위: aibot(에이전트 루프). 불통이면 LLM 단발 폴백.
        if (aibot.health()) {
            String reply = aibot.chat(message);
            if (reply != null) return ResponseEntity.ok(Map.of("reply", reply));
        }
        if (!llmService.isAvailable())
            return ResponseEntity.ok(Map.of("reply",
                    "AI가 연결되지 않았습니다. aibot 서비스 또는 LLM_PROVIDER 설정을 확인하세요."));
        try {
            return ResponseEntity.ok(Map.of("reply", llmService.chat(CHAT_SYSTEM, message)));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("reply", "AI 응답 실패: " + e.getMessage()));
        }
    }
}
