package com.nemesis.domain.failover;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.detection.DetectionProperties;
import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Fencing(STONITH soft-fence) 서비스 — 스플릿브레인 방지의 핵심 안전장치.
 *
 * 페일오버에서 승격 노드가 VIP를 잡기 '전에' 구 active를 강제 격리한다.
 * 현재 메서드는 'ssh-soft': 에이전트 명령 채널로 대상에게 `control.sh fence-self`를
 * 보내 스스로 VIP를 내려놓게 한다(도달 가능할 때만 동작).
 *
 * 도달 불가 시 관리서버가 witness 역할로 메트릭 신선도를 보고 판정한다:
 *   - 메트릭이 오래됨(stale) → 사망 추정(PRESUMED_DEAD) → 인수 허용(제3자가 단절 확인).
 *   - 메트릭이 아직 신선 → 살아있는데 fence만 실패 = 진짜 분할 위험 → FAILED → 인수 중단.
 *
 * fence_method=none이면 격리를 건너뛴다(DISABLED, 호출자가 기존 best-effort 경로 사용).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FenceService {

    private final AgentCommandClient    commandClient;
    private final MetricsCacheService   metricsCache;
    private final DetectionProperties   props;
    private final FenceHistoryRepository historyRepository;

    /**
     * 구 active(victim)를 격리한다. 호출자(오케스트레이터)는 결과로 인수 진행/중단을 판단한다.
     */
    public FenceHistory.Outcome fence(Cluster cluster, Node victim) {
        String method = cluster.getFenceMethod() == null ? "ssh-soft" : cluster.getFenceMethod();
        long t0 = System.currentTimeMillis();

        if ("none".equalsIgnoreCase(method)) {
            return record(cluster, victim, method, FenceHistory.Outcome.DISABLED,
                    "fencing 비활성(method=none)", t0);
        }

        // ssh-soft: 대상에게 self-fence 명령
        String iface = (victim.getNetIface() == null || victim.getNetIface().isBlank())
                ? "eth0" : victim.getNetIface();
        String vip  = cluster.getVip();
        int    cidr = cluster.getVipCidr();
        String cmd  = "control.sh fence-self " + iface + " " + (vip == null ? "" : vip) + " " + cidr;

        AgentCommandClient.Result r = commandClient.execute(victim, cmd);
        if (r.ok()) {
            log.warn("fence 확인: {} self-fence 성공(VIP 내림)", victim.getHostname());
            return record(cluster, victim, method, FenceHistory.Outcome.CONFIRMED,
                    "self-fence 확인", t0);
        }

        // 도달 불가 — witness(메트릭 신선도)로 사망 추정 vs 위험 판정
        boolean stillAlive = metricsCache.isFresh(victim.getId(), props.metricsFreshMillis());
        String err = r.error() != null ? r.error() : r.stderr();
        if (stillAlive) {
            log.error("fence 실패: {} 도달 불가하나 메트릭 신선 — 분할 위험, 인수 중단 ({})",
                    victim.getHostname(), err);
            return record(cluster, victim, method, FenceHistory.Outcome.FAILED,
                    "도달 불가 + 메트릭 신선(살아있음): " + err, t0);
        }
        log.warn("fence 추정: {} 도달 불가 + 메트릭 stale → 사망 추정, 인수 허용 ({})",
                victim.getHostname(), err);
        return record(cluster, victim, method, FenceHistory.Outcome.PRESUMED_DEAD,
                "도달 불가 + 메트릭 stale(사망 추정): " + err, t0);
    }

    private FenceHistory.Outcome record(Cluster c, Node victim, String method,
                                        FenceHistory.Outcome outcome, String detail, long t0) {
        historyRepository.save(FenceHistory.builder()
                .clusterGroupId(c.getId())
                .targetNodeId(victim != null ? victim.getId() : null)
                .method(method)
                .outcome(outcome)
                .detail(detail != null && detail.length() > 500 ? detail.substring(0, 500) : detail)
                .durationMs(System.currentTimeMillis() - t0)
                .build());
        return outcome;
    }
}
