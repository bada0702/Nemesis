package com.nemesis.detection;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.event.DetectionEvent;
import com.nemesis.domain.event.DetectionEventRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Phase A 감지 엔진.
 * 주기적으로 모든 노드의 생존(staleness)·자원 임계·프로세스 다운을 검사하여
 * 노드 role 전이(active/standby ↔ fault)와 감지 이벤트를 생성한다.
 *
 * 설계 원칙:
 *  - 생존 판정은 캐시 존재 여부가 아니라 last_seen_at 신선도로 한다(C-2).
 *  - role=recovering(페일오버 진행 중, Phase B) 노드는 건드리지 않는다.
 *  - 임계/프로세스 이벤트는 상태 전이 시 1회만 발생시켜 알람 폭주를 막는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@ConditionalOnProperty(name = "nemesis.detection.enabled", havingValue = "true", matchIfMissing = true)
public class HealthMonitorService {

    private final NodeRepository           nodeRepository;
    private final MetricsCacheService      metricsCache;
    private final DetectionEventRepository eventRepository;
    private final DetectionProperties      props;
    private final ApplicationEventPublisher eventPublisher;

    /** 노드별 현재 발효 중인 자원 알람(중복 발생 방지). */
    private final Map<UUID, Set<DetectionEvent.Type>> activeAlerts = new HashMap<>();

    /** 노드별 직전 스캔에서 실행 중이던 프로세스 이름 집합. */
    private final Map<UUID, Set<String>> lastRunningProcs = new HashMap<>();

    @Scheduled(fixedDelayString = "${nemesis.detection.scan-interval-ms:1000}")
    @Transactional
    public void scan() {
        long now = System.currentTimeMillis();
        for (Node node : nodeRepository.findAll()) {
            try {
                evaluate(node, now);
            } catch (Exception e) {
                log.error("노드 감지 평가 실패: {}", node.getId(), e);
            }
        }
    }

    private void evaluate(Node node, long now) {
        // 페일오버 진행 중(Phase B) 노드는 감지 엔진이 개입하지 않는다.
        if (node.getRole() == Node.Role.recovering) return;

        UUID nodeId = node.getId();
        Cluster cluster = node.getCluster();
        long faultTimeout = props.faultTimeoutMillis(cluster.getHeartbeatFailThreshold());

        OffsetDateTime lastSeen = node.getLastSeenAt();
        boolean everSeen = lastSeen != null;
        long sinceSeen = everSeen ? now - lastSeen.toInstant().toEpochMilli() : Long.MAX_VALUE;
        boolean stale = everSeen && sinceSeen > faultTimeout;

        // ── 생존 판정 ───────────────────────────────────────────────
        if (node.getRole() == Node.Role.fault) {
            // 복구 감지: 다시 신선하게 보고하기 시작하면 standby로 되돌린다(승격은 Phase B).
            if (everSeen && !stale) {
                node.setRole(Node.Role.standby);
                nodeRepository.save(node);
                clearNodeState(nodeId);
                record(node, DetectionEvent.Type.NODE_RECOVERED, DetectionEvent.Severity.INFO,
                        node.getHostname() + " 노드 복구 감지 (standby 복귀)",
                        "마지막 보고 " + (sinceSeen / 1000) + "초 전");
                log.info("노드 복구: {} → standby", node.getHostname());
            }
            return; // fault 상태에서는 자원/프로세스 평가를 건너뛴다.
        }

        if (stale) {
            DetectionEvent.Severity sev = node.getRole() == Node.Role.active
                    ? DetectionEvent.Severity.CRITICAL : DetectionEvent.Severity.WARNING;
            Node.Role prev = node.getRole();
            node.setRole(Node.Role.fault);
            nodeRepository.save(node);
            clearNodeState(nodeId);
            metricsCache.remove(nodeId);
            String reason = node.getHostname() + " 무응답 (마지막 보고 " + (sinceSeen / 1000) + "초 전)";
            record(node, DetectionEvent.Type.NODE_FAULT, sev,
                    node.getHostname() + " 노드 무응답 감지 (" + prev + " → fault)",
                    "마지막 보고 " + (sinceSeen / 1000) + "초 전, 임계 " + (faultTimeout / 1000) + "초");
            log.warn("노드 Fault 판정: {} (마지막 보고 {}초 전)", node.getHostname(), sinceSeen / 1000);

            // active 노드가 죽으면 자동 페일오버를 트리거(Phase B). 커밋 후 비동기 실행.
            if (prev == Node.Role.active) {
                eventPublisher.publishEvent(new NodeFaultEvent(
                        cluster.getId(), nodeId, node.getHostname(), reason));
            }
            return;
        }

        // ── 자원/프로세스 평가 (신선한 메트릭이 있을 때만) ──────────────
        metricsCache.getFresh(nodeId, props.metricsFreshMillis())
                .ifPresent(m -> evaluateMetrics(node, m));
    }

    private void evaluateMetrics(Node node, MetricsPushRequest m) {
        UUID nodeId = node.getId();
        Set<DetectionEvent.Type> active = activeAlerts.computeIfAbsent(nodeId, k -> new HashSet<>());

        checkThreshold(node, active, DetectionEvent.Type.CPU_HIGH,
                m.getCpuPercent(), props.getCpuThreshold(), "CPU");
        checkThreshold(node, active, DetectionEvent.Type.MEM_HIGH,
                m.getMemoryPercent(), props.getMemThreshold(), "Memory");
        checkThreshold(node, active, DetectionEvent.Type.DISK_HIGH,
                m.getDiskPercent(), props.getDiskThreshold(), "Disk");

        checkProcessDown(node, m);
    }

    private void checkThreshold(Node node, Set<DetectionEvent.Type> active,
                                DetectionEvent.Type type, double value, double threshold, String label) {
        if (value > threshold) {
            if (active.add(type)) { // 임계 진입 시 1회만 발생
                record(node, type, DetectionEvent.Severity.WARNING,
                        node.getHostname() + " " + label + " " + Math.round(value) + "% 초과 (임계 "
                                + Math.round(threshold) + "%)",
                        null);
            }
        } else {
            active.remove(type); // 정상 복귀 시 상태 해제 → 다음 초과 시 재발생
        }
    }

    private void checkProcessDown(Node node, MetricsPushRequest m) {
        UUID nodeId = node.getId();
        Set<String> current = new HashSet<>();
        if (m.getProcesses() != null) {
            current = m.getProcesses().stream()
                    .map(p -> p.get("name"))
                    .filter(Objects::nonNull)
                    .collect(Collectors.toCollection(HashSet::new));
        }
        Set<String> previous = lastRunningProcs.get(nodeId);
        if (previous != null) {
            Set<String> disappeared = new HashSet<>(previous);
            disappeared.removeAll(current);
            for (String name : disappeared) {
                record(node, DetectionEvent.Type.PROCESS_DOWN, DetectionEvent.Severity.WARNING,
                        node.getHostname() + " 프로세스 다운 감지: " + name, null);
                log.warn("프로세스 다운: {} on {}", name, node.getHostname());
            }
        }
        lastRunningProcs.put(nodeId, current);
    }

    private void record(Node node, DetectionEvent.Type type, DetectionEvent.Severity severity,
                        String message, String details) {
        eventRepository.save(DetectionEvent.builder()
                .clusterGroupId(node.getCluster().getId())
                .nodeId(node.getId())
                .type(type)
                .severity(severity)
                .message(message)
                .details(details)
                .build());
    }

    private void clearNodeState(UUID nodeId) {
        activeAlerts.remove(nodeId);
        lastRunningProcs.remove(nodeId);
    }
}
