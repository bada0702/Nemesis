package com.nemesis.domain.ai;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Phase C-2: AI를 페일오버 "결정 보조"로 사용한다.
 * 감지 이벤트 컨텍스트를 LLM에 주고 FAILOVER_NOW/HOLD/SELF_HEAL_FIRST 판단을 받는다.
 * LLM 미설정/실패/저신뢰 시 Rule(즉시 페일오버)로 폴백한다 — HA는 LLM에 의존하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiDecisionService {

    private final LlmService          llmService;
    private final MetricsCacheService metricsCache;
    private final NodeRepository      nodeRepository;
    private final AiDecisionRepository decisionRepository;

    /** 판단 결과: 페일오버를 진행해야 하는가 + 사유. */
    public record Verdict(boolean proceed, String reason) {}

    /**
     * 노드 fault에 대해 페일오버를 진행할지 AI 보조 판단.
     * @return proceed=true면 페일오버 진행, false면 보류(HOLD).
     */
    @Transactional
    public Verdict shouldFailover(UUID clusterId, UUID nodeId, String triggerReason) {
        long t0 = System.currentTimeMillis();

        // LLM 미사용/미설정이면 즉시 Rule 진행(폴백 기록)
        if (!llmService.isAvailable()) {
            record(clusterId, nodeId, "rule-fallback", LlmService.Action.FAILOVER_NOW,
                    1.0, "LLM 미설정 — Rule 즉시 페일오버", System.currentTimeMillis() - t0, true);
            return new Verdict(true, "Rule 폴백(LLM 미설정)");
        }

        String context = buildContext(clusterId, nodeId, triggerReason);
        LlmService.Decision d = llmService.decideFailover(context);

        if (d == null) { // LLM 실패 → Rule 폴백
            record(clusterId, nodeId, "rule-fallback", LlmService.Action.FAILOVER_NOW,
                    1.0, "LLM 응답 실패 — Rule 즉시 페일오버", System.currentTimeMillis() - t0, true);
            return new Verdict(true, "Rule 폴백(LLM 실패)");
        }

        record(clusterId, nodeId, d.provider(), d.action(), d.confidence(), d.reason(),
                d.latencyMs(), false);

        // HOLD는 신뢰도가 임계 이상일 때만 채택(애매하면 안전하게 페일오버)
        boolean confident = d.confidence() >= llmService.confidenceThreshold();
        boolean proceed = switch (d.action()) {
            case HOLD            -> !confident; // 확신 있는 HOLD만 보류
            case SELF_HEAL_FIRST -> !confident; // 자가복구 우선이 확신이면 일단 보류(복구는 Phase D)
            case FAILOVER_NOW    -> true;
        };
        String reason = "AI(" + d.provider() + ") " + d.action() + " conf=" + d.confidence()
                + " → " + (proceed ? "진행" : "보류") + ": " + d.reason();
        log.info("AI 페일오버 판단: {}", reason);
        return new Verdict(proceed, reason);
    }

    private String buildContext(UUID clusterId, UUID nodeId, String triggerReason) {
        Node node = nodeRepository.findById(nodeId).orElse(null);
        StringBuilder sb = new StringBuilder("{");
        sb.append("\"trigger\":\"").append(escape(triggerReason)).append("\",");
        sb.append("\"hostname\":\"").append(node != null ? escape(node.getHostname()) : "?").append("\",");
        sb.append("\"role\":\"").append(node != null ? node.getRole() : "?").append("\"");
        metricsCache.get(nodeId).ifPresent(m -> sb.append(metricsJson(m)));
        sb.append("}");
        return sb.toString();
    }

    private String metricsJson(MetricsPushRequest m) {
        StringBuilder sb = new StringBuilder();
        sb.append(",\"cpu\":").append(m.getCpuPercent());
        sb.append(",\"mem\":").append(m.getMemoryPercent());
        sb.append(",\"disk\":").append(m.getDiskPercent());
        if (m.getErrorLogPreview() != null && !m.getErrorLogPreview().isEmpty()) {
            sb.append(",\"errors\":\"")
              .append(escape(String.join(" | ", m.getErrorLogPreview())))
              .append("\"");
        }
        return sb.toString();
    }

    private void record(UUID clusterId, UUID nodeId, String provider, LlmService.Action action,
                        double confidence, String reason, long latencyMs, boolean fallback) {
        decisionRepository.save(AiDecision.builder()
                .clusterGroupId(clusterId).nodeId(nodeId).provider(provider)
                .action(action.name()).confidence(confidence).reason(reason)
                .latencyMs(latencyMs).fallback(fallback).build());
    }

    private String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }
}
