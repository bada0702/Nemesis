package com.nemesis.domain.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Phase B 자동 페일오버 오케스트레이터.
 *
 * 수동/감지/AI 3개 트리거가 모두 이 한 곳을 호출하도록 일원화한다(B-3).
 * 가드(핑퐁/최대횟수/대상 생존)를 적용하고, 실제 VIP 인수를 에이전트 명령으로 실행한 뒤
 * role 상태 머신(active→fault, standby→recovering→active)을 전이하고 이력을 남긴다.
 *
 * 설계 원칙: VIP 인수가 성공해야만 role을 커밋한다. 실패 시 대상 노드를 standby로 롤백한다.
 * LLM 등 외부 의존 없이 결정적으로 동작한다(AI는 호출자가 판단 후 트리거로만 진입).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FailoverOrchestrator {

    private final NodeRepository            nodeRepository;
    private final ClusterRepository         clusterRepository;
    private final FailoverHistoryRepository historyRepository;
    private final AgentCommandClient        commandClient;
    private final MetricsCacheService       metricsCache;
    private final DetectionProperties       props;

    /** max_failover_count 판정 윈도(이 시간 내 성공 횟수를 센다). */
    private static final Duration COUNT_WINDOW = Duration.ofHours(1);

    public record Result(FailoverHistory.Status status, String message,
                         UUID fromNodeId, UUID toNodeId) {
        public boolean success() { return status == FailoverHistory.Status.SUCCESS; }
    }

    /**
     * 페일오버 실행.
     * @param fromNodeId 강등 대상(현재 active). null이면 클러스터의 현재 active를 자동 탐색.
     * @param toNodeId   승격 대상(standby). null이면 생존 standby 자동 선택.
     */
    @Transactional
    public Result failover(UUID clusterId, UUID fromNodeId, UUID toNodeId,
                           FailoverHistory.Trigger trigger, String reason) {
        long t0 = System.currentTimeMillis();
        OffsetDateTime now = OffsetDateTime.now();

        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("cluster not found: " + clusterId));
        boolean manual = trigger == FailoverHistory.Trigger.MANUAL;

        // ── 가드 1: 핑퐁 방지 (수동은 운영자 의도이므로 면제) ──────────────
        if (!manual && cluster.getLastFailoverAt() != null) {
            long sinceSec = Duration.between(cluster.getLastFailoverAt(), now).getSeconds();
            if (sinceSec < cluster.getPingpongGuardSeconds()) {
                return skip(cluster, fromNodeId, toNodeId, trigger,
                        "핑퐁 가드: 최근 페일오버 후 " + sinceSec + "s < " + cluster.getPingpongGuardSeconds() + "s");
            }
        }

        // ── 가드 2: 최대 페일오버 횟수 (윈도 내) ──────────────────────────
        if (!manual) {
            long recent = historyRepository.countByClusterGroupIdAndStatusAndCreatedAtAfter(
                    clusterId, FailoverHistory.Status.SUCCESS, now.minus(COUNT_WINDOW));
            if (recent >= cluster.getMaxFailoverCount()) {
                return skip(cluster, fromNodeId, toNodeId, trigger,
                        "최대 페일오버 횟수 초과: " + recent + "/" + cluster.getMaxFailoverCount() + " (최근 1시간)");
            }
        }

        List<Node> nodes = nodeRepository.findByClusterId(clusterId);

        // 강등 대상(from): 명시 없으면 현재 active
        Node from = fromNodeId != null
                ? findIn(nodes, fromNodeId)
                : nodes.stream().filter(n -> n.getRole() == Node.Role.active).findFirst().orElse(null);

        // 승격 대상(to): 명시 없으면 생존 standby 우선 자동 선택
        Node to = toNodeId != null ? findIn(nodes, toNodeId) : pickStandby(nodes, from);
        if (to == null) {
            return skip(cluster, from != null ? from.getId() : null, toNodeId, trigger,
                    "승격 가능한 standby 노드가 없습니다");
        }
        if (from != null && to.getId().equals(from.getId())) {
            return skip(cluster, from.getId(), to.getId(), trigger, "from과 to가 동일 노드입니다");
        }

        // ── 가드 3: 대상 standby 생존 확인 (자동 트리거만) ────────────────
        if (!manual && !metricsCache.isFresh(to.getId(), props.metricsFreshMillis())) {
            return skip(cluster, from != null ? from.getId() : null, to.getId(), trigger,
                    "대상 standby가 생존하지 않습니다: " + to.getHostname());
        }

        // ── 상태 머신: to → recovering ───────────────────────────────────
        to.setRole(Node.Role.recovering);
        nodeRepository.save(to);

        // ── 실제 인수: VIP 이동 ───────────────────────────────────────────
        String vip = cluster.getVip();
        int cidr = cluster.getVipCidr();
        if (vip != null && !vip.isBlank()) {
            // 구 active에서 VIP 내림(죽은 노드면 실패해도 무시 — best effort)
            if (from != null) {
                AgentCommandClient.Result down = commandClient.execute(from,
                        "control.sh vip-down " + ifaceOf(from) + " " + vip + " " + cidr);
                if (!down.ok()) {
                    log.info("구 active VIP 내림 실패(무시, 노드 다운 가능): {} - {}",
                            from.getHostname(), down.error() != null ? down.error() : down.stderr());
                }
            }
            // 신규 노드에서 VIP 올림 + GARP
            AgentCommandClient.Result up = commandClient.execute(to,
                    "control.sh vip-up " + ifaceOf(to) + " " + vip + " " + cidr);
            if (!up.ok()) {
                // 롤백: 대상 노드를 standby로 되돌림
                to.setRole(Node.Role.standby);
                nodeRepository.save(to);
                String err = up.error() != null ? up.error() : up.stderr();
                return record(cluster, from, to, trigger, FailoverHistory.Status.FAILED,
                        "VIP 인수 실패: " + err, t0);
            }
        } else {
            log.warn("클러스터 {} VIP 미설정 — role 전환만 수행", cluster.getName());
        }

        // ── 커밋: role 전이 ───────────────────────────────────────────────
        if (from != null) {
            // 감지/AI 트리거면 이미 fault일 수 있음. 수동이면 standby로 정상 강등.
            from.setRole(manual ? Node.Role.standby : Node.Role.fault);
            nodeRepository.save(from);
        }
        to.setRole(Node.Role.active);
        nodeRepository.save(to);

        cluster.setLastFailoverAt(now);
        clusterRepository.save(cluster);

        log.warn("페일오버 성공: {} → {} (트리거={}, vip={})",
                from != null ? from.getHostname() : "-", to.getHostname(), trigger, vip);
        return record(cluster, from, to, trigger, FailoverHistory.Status.SUCCESS,
                reason != null ? reason : "페일오버 완료", t0);
    }

    // ------------------------------------------------------------------ helpers

    private Node findIn(List<Node> nodes, UUID id) {
        return nodes.stream().filter(n -> n.getId().equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("노드가 클러스터에 없습니다: " + id));
    }

    /** 생존(신선 메트릭) standby 우선, 그 다음 임의 standby를 선택. */
    private Node pickStandby(List<Node> nodes, Node exclude) {
        return nodes.stream()
                .filter(n -> n.getRole() == Node.Role.standby)
                .filter(n -> exclude == null || !n.getId().equals(exclude.getId()))
                .max(Comparator.comparingInt(n ->
                        metricsCache.isFresh(n.getId(), props.metricsFreshMillis()) ? 1 : 0))
                .orElse(null);
    }

    private String ifaceOf(Node n) {
        return (n.getNetIface() == null || n.getNetIface().isBlank()) ? "eth0" : n.getNetIface();
    }

    private Result skip(Cluster c, UUID fromId, UUID toId, FailoverHistory.Trigger trigger, String reason) {
        log.info("페일오버 보류: {} (cluster={})", reason, c.getName());
        historyRepository.save(FailoverHistory.builder()
                .clusterGroupId(c.getId()).fromNodeId(fromId).toNodeId(toId)
                .trigger(trigger).status(FailoverHistory.Status.SKIPPED)
                .reason(reason).vip(c.getVip()).durationMs(0L).build());
        return new Result(FailoverHistory.Status.SKIPPED, reason, fromId, toId);
    }

    private Result record(Cluster c, Node from, Node to, FailoverHistory.Trigger trigger,
                          FailoverHistory.Status status, String reason, long t0) {
        UUID fromId = from != null ? from.getId() : null;
        historyRepository.save(FailoverHistory.builder()
                .clusterGroupId(c.getId()).fromNodeId(fromId).toNodeId(to.getId())
                .trigger(trigger).status(status).reason(reason).vip(c.getVip())
                .durationMs(System.currentTimeMillis() - t0).build());
        return new Result(status, reason, fromId, to.getId());
    }
}
