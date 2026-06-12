package com.nemesis.domain.ai;

import com.nemesis.domain.ai.llm.LlmService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiChatController {

    private final LlmService llmService;

    private static final String CHAT_SYSTEM =
            "당신은 Nemesis HA 시스템의 AI 어시스턴트입니다. " +
            "AIX/Linux 엔터프라이즈 인프라, 고가용성, 장애 분석 전문가로서 " +
            "운영자의 질문에 한국어로 간결하게 답하세요.";

    @PostMapping("/chat")
    public ResponseEntity<Map<String, String>> chat(@RequestBody Map<String, String> req) {
        String message = req.getOrDefault("message", "").trim();
        if (message.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "message가 비어 있습니다."));
        }
        if (!llmService.isAvailable()) {
            return ResponseEntity.ok(Map.of("reply",
                    "AI가 연결되지 않았습니다. .env의 LLM_PROVIDER 및 모델 설정을 확인하세요."));
        }
        try {
            String reply = llmService.chat(CHAT_SYSTEM, message);
            return ResponseEntity.ok(Map.of("reply", reply));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("reply", "AI 응답 실패: " + e.getMessage()));
        }
    }
}
