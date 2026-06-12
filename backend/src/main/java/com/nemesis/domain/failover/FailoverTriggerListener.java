package com.nemesis.domain.failover;

import com.nemesis.detection.NodeFaultEvent;
import com.nemesis.domain.ai.AiDecisionService;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.event.TransactionPhase;

/**
 * 감지 엔진의 NodeFaultEvent를 받아 자동 페일오버를 트리거한다(B-3 트리거 일원화).
 * 감지 트랜잭션이 커밋된 뒤(AFTER_COMMIT) 비동기로 실행하여 감지 루프(1s)를 막지 않는다.
 *
 * 클러스터에 AI가 켜져 있으면(ai_enabled) 페일오버 전에 AI 보조 판단을 거친다(Phase C-2).
 * AI가 HOLD로 확신하면 보류, 그 외에는 Rule대로 진행한다(AI 실패 시에도 안전하게 페일오버).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FailoverTriggerListener {

    private final FailoverOrchestrator orchestrator;
    private final ClusterRepository    clusterRepository;
    private final AiDecisionService    aiDecisionService;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onNodeFault(NodeFaultEvent ev) {
        try {
            Cluster cluster = clusterRepository.findById(ev.clusterId()).orElse(null);

            if (cluster != null && cluster.isAiEnabled()) {
                AiDecisionService.Verdict v =
                        aiDecisionService.shouldFailover(ev.clusterId(), ev.nodeId(), ev.reason());
                if (!v.proceed()) {
                    log.warn("AI 판단으로 페일오버 보류: {} ({})", ev.hostname(), v.reason());
                    return;
                }
            }

            FailoverOrchestrator.Result r = orchestrator.failover(
                    ev.clusterId(), ev.nodeId(), null,
                    FailoverHistory.Trigger.DETECTION,
                    "감지: " + ev.reason());
            log.info("감지 트리거 페일오버 결과: {} - {}", r.status(), r.message());
        } catch (Exception e) {
            log.error("감지 트리거 페일오버 실패 node={}", ev.nodeId(), e);
        }
    }
}
