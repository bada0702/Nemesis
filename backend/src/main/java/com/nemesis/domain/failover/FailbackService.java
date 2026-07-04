package com.nemesis.domain.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.*;

/**
 * 자동 페일백: 자동(DETECTION/AI) 페일오버로 강등됐던 원 노드가 복구되어
 * 안정화 시간 동안 연속으로 건강하면, 원 노드로 역할을 자동 환원한다.
 *
 * 수순: 장애 감지 → 즉시 페일오버 → (장애 조치) → 원 노드 복구·안정화 → 페일백.
 * "장애 조치 완료"의 판정은 [원 노드 standby 복귀 + 메트릭 신선 + haManaged 서비스
 * 전부 실행 중 + stabilizationSeconds 연속 유지]로 담보한다 — 서비스가 다시 떠야만
 * 페일백하므로, 미조치 상태로 승격해 프로세스다운 페일오버와 핑퐁하는 것을 막는다.
 *
 * 실행은 FailoverOrchestrator 일원화 경로(트리거 FAILBACK)를 그대로 사용해
 * 기존 가드(핑퐁/최대횟수/대상 생존)를 상속받는다. MANUAL 페일오버는 운영자 의도이므로
 * 자동 페일백하지 않으며, FAILBACK 성공 후에는 최신 이력이 FAILBACK이라 자연 종료된다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@ConditionalOnProperty(name = "nemesis.failback.enabled", havingValue = "true", matchIfMissing = true)
public class FailbackService {

    private final ClusterRepository         clusterRepository;
    private final NodeRepository            nodeRepository;
    private final FailoverHistoryRepository historyRepository;
    private final ManagedServiceRepository  managedServiceRepository;
    private final MetricsCacheService       metricsCache;
    private final DetectionProperties       detectionProps;
    private final FailbackProperties        props;
    private final FailoverOrchestrator      orchestrator;

    /** 클러스터별 페일백 후보의 안정화 시작 시각(ms). 조건이 깨지면 리셋. */
    private final Map<UUID, Long> readySince = new HashMap<>();

    @Scheduled(fixedDelayString = "${nemesis.failback.check-interval-ms:15000}")
    @Transactional
    public void tick() {
        for (Cluster cluster : clusterRepository.findAll()) {
            try {
                evaluate(cluster);
            } catch (Exception e) {
                log.error("자동 페일백 평가 실패: cluster={}", cluster.getId(), e);
            }
        }
    }

    void evaluate(Cluster cluster) {
        Node candidate = failbackCandidate(cluster);
        if (candidate == null || !isHealthy(cluster, candidate)) {
            readySince.remove(cluster.getId());
            return;
        }

        long now = System.currentTimeMillis();
        Long since = readySince.computeIfAbsent(cluster.getId(), k -> now);
        if (now - since < props.stabilizationMillis()) return;   // 안정화 대기

        // 핑퐁 가드 윈도 내에는 시도 자체를 미룬다(SKIPPED 이력 스팸 방지, 시계는 유지).
        if (cluster.getLastFailoverAt() != null) {
            long sinceFailoverSec = Duration.between(cluster.getLastFailoverAt(), OffsetDateTime.now()).getSeconds();
            if (sinceFailoverSec < cluster.getPingpongGuardSeconds()) return;
        }

        readySince.remove(cluster.getId());   // 시도 후에는 결과와 무관하게 재안정화부터
        FailoverOrchestrator.Result r = orchestrator.failover(
                cluster.getId(), null, candidate.getId(),
                FailoverHistory.Trigger.FAILBACK,
                "자동 페일백: " + candidate.getHostname() + " 복구·안정화("
                        + props.getStabilizationSeconds() + "s) 확인");
        log.warn("자동 페일백 실행: cluster={} → {} 결과={} - {}",
                cluster.getName(), candidate.getHostname(), r.status(), r.message());
    }

    /**
     * 페일백 후보 = 가장 최근 SUCCESS 페일오버가 자동(DETECTION/AI) 트리거였을 때
     * 그 이력의 fromNode(강등됐던 원 노드). MANUAL/FAILBACK이면 후보 없음.
     */
    private Node failbackCandidate(Cluster cluster) {
        Optional<FailoverHistory> lastOpt = historyRepository
                .findFirstByClusterGroupIdAndStatusOrderByCreatedAtDesc(
                        cluster.getId(), FailoverHistory.Status.SUCCESS);
        if (lastOpt.isEmpty()) return null;
        FailoverHistory last = lastOpt.get();
        if (last.getTrigger() != FailoverHistory.Trigger.DETECTION
                && last.getTrigger() != FailoverHistory.Trigger.AI) return null;
        if (last.getFromNodeId() == null) return null;
        return nodeRepository.findById(last.getFromNodeId()).orElse(null);
    }

    /** standby 복귀 + 메트릭 신선 + (등록돼 있다면) haManaged 서비스 전부 실행 중. */
    private boolean isHealthy(Cluster cluster, Node candidate) {
        if (candidate.getRole() != Node.Role.standby) return false;
        Optional<MetricsPushRequest> m = metricsCache.getFresh(
                candidate.getId(), detectionProps.metricsFreshMillis());
        if (m.isEmpty()) return false;

        List<ManagedService> ha = managedServiceRepository.findByClusterIdAndHaManagedTrue(cluster.getId());
        if (ha.isEmpty()) return true;
        if (m.get().getProcesses() == null) return false;

        Set<String> names = new HashSet<>();
        for (Map<String, String> p : m.get().getProcesses()) {
            String name = p.get("name");
            if (name != null) names.add(name.toLowerCase());
        }
        return ha.stream().allMatch(svc ->
                names.stream().anyMatch(n -> n.contains(svc.getName())));
    }
}
