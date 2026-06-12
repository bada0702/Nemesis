package com.nemesis.domain.ai.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Phase C: 활성 LLM 제공자를 선택해 호출하고 결과를 파싱한다.
 * LLM 실패/미설정 시 예외 대신 폴백을 반환해 HA가 LLM에 의존하지 않게 한다.
 */
@Slf4j
@Service
public class LlmService {

    private final Map<String, LlmProvider> providers;
    private final LlmProperties props;
    private final ObjectMapper mapper = new ObjectMapper();

    public LlmService(List<LlmProvider> providerList, LlmProperties props) {
        this.providers = new java.util.HashMap<>();
        providerList.forEach(p -> providers.put(p.name(), p));
        this.props = props;
    }

    public String activeProviderName() { return props.getProvider(); }

    /** 활성 제공자가 설정되어 사용 가능한지. */
    public boolean isAvailable() {
        LlmProvider p = providers.get(props.getProvider());
        return p != null && p.isConfigured();
    }

    private static final String ANALYZE_SYSTEM =
            "당신은 AIX/Linux 엔터프라이즈 장애 분석 전문가입니다. 에러 로그를 분석해 근본 원인과 수정 명령을 " +
            "아래 JSON으로만 반환하세요(설명 금지): " +
            "{\"rootCause\":\"...\",\"fixCommands\":[{\"order\":1,\"command\":\"...\",\"description\":\"...\",\"risk\":\"LOW\"}]}";

    /** 자유 대화. 채팅 전용 긴 타임아웃을 사용한다. 실패 시 예외를 그대로 던진다(컨트롤러에서 처리). */
    public String chat(String systemPrompt, String userMessage) throws Exception {
        LlmProvider p = providers.get(props.getProvider());
        if (p == null || !p.isConfigured()) {
            throw new IllegalStateException("LLM 미설정(" + props.getProvider() + ")");
        }
        return p.completeChat(systemPrompt, userMessage);
    }

    /** 에러 로그 원인 분석. 실패 시 rootCause에 사유를 담아 폴백 반환. */
    public Map<String, Object> analyze(String errorLogs) {
        LlmProvider p = providers.get(props.getProvider());
        if (p == null || !p.isConfigured()) {
            return Map.of("rootCause", "LLM 미설정(" + props.getProvider() + ")", "fixCommands", List.of());
        }
        try {
            String raw = p.complete(ANALYZE_SYSTEM, "다음 에러 로그를 분석하세요:\n" + errorLogs);
            return parseJsonObject(raw, Map.of("rootCause", raw, "fixCommands", List.of()));
        } catch (Exception e) {
            log.warn("LLM 분석 실패(provider={}): {}", props.getProvider(), e.getMessage());
            return Map.of("rootCause", "AI 분석 실패: " + e.getMessage(), "fixCommands", List.of());
        }
    }

    private static final String DECISION_SYSTEM =
            "당신은 HA 페일오버 판단 보조자입니다. 주어진 노드/클러스터 상태를 보고 페일오버 여부를 판단해 " +
            "아래 JSON으로만 답하세요(설명 금지): " +
            "{\"action\":\"FAILOVER_NOW|HOLD|SELF_HEAL_FIRST\",\"confidence\":0.0~1.0,\"reason\":\"한국어 한 줄\"}. " +
            "원인이 일시적/네트워크 플래핑으로 의심되면 HOLD, 복구 가능한 소프트 장애면 SELF_HEAL_FIRST, " +
            "명백한 노드 다운이면 FAILOVER_NOW.";

    /** 페일오버 판단. 실패 시 null 반환(호출자가 Rule로 폴백). */
    public Decision decideFailover(String contextJson) {
        LlmProvider p = providers.get(props.getProvider());
        if (p == null || !p.isConfigured()) return null;
        long t0 = System.currentTimeMillis();
        try {
            String raw = p.complete(DECISION_SYSTEM, contextJson);
            Map<String, Object> m = parseJsonObject(raw, null);
            if (m == null || m.get("action") == null) return null;
            Action action = Action.parse(String.valueOf(m.get("action")));
            double conf = m.get("confidence") instanceof Number n ? n.doubleValue() : 0.0;
            String reason = String.valueOf(m.getOrDefault("reason", ""));
            return new Decision(action, conf, reason, props.getProvider(),
                    System.currentTimeMillis() - t0, false);
        } catch (Exception e) {
            log.warn("LLM 판단 실패(provider={}): {}", props.getProvider(), e.getMessage());
            return null;
        }
    }

    public double confidenceThreshold() { return props.getConfidenceThreshold(); }

    // ------------------------------------------------------------------ types

    public enum Action {
        FAILOVER_NOW, HOLD, SELF_HEAL_FIRST;
        static Action parse(String s) {
            try { return valueOf(s.trim().toUpperCase()); }
            catch (Exception e) { return FAILOVER_NOW; } // 모호하면 안전하게 페일오버
        }
    }

    public record Decision(Action action, double confidence, String reason,
                           String provider, long latencyMs, boolean fallback) {}

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJsonObject(String content, Map<String, Object> fallback) {
        try {
            String json = content.trim()
                    .replaceAll("(?s)^```json\\s*", "")
                    .replaceAll("(?s)^```\\s*", "")
                    .replaceAll("(?s)```\\s*$", "")
                    .trim();
            return mapper.readValue(json, Map.class);
        } catch (Exception e) {
            return fallback;
        }
    }
}
