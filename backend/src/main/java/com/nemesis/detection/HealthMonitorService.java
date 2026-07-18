package com.nemesis.detection;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.catalog.ManagedService;
import com.nemesis.domain.catalog.ManagedServiceRepository;
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
    private final ManagedServiceRepository  managedServiceRepository;

    /** 노드별 현재 발효 중인 자원 알람(중복 발생 방지). */
    private final Map<UUID, Set<DetectionEvent.Type>> activeAlerts = new HashMap<>();

    /** 노드별 직전 스캔에서 실행 중이던 프로세스 이름 집합. */
    private final Map<UUID, Set<String>> lastRunningProcs = new HashMap<>();

    /** active 노드의 HA 서비스 프로세스 최초 소실 시각(ms). key = nodeId:패턴 */
    private final Map<String, Long> haMissingSince = new HashMap<>();

    /** 이번 소실 인시던트에 대해 이미 발화(페일오버/보류 경보)했는지. key = nodeId:패턴 */
    private final Set<String> haMissingFired = new HashSet<>();

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
        // 한 번도 보고하지 않은 노드(에이전트 미연동)도 staleness 판정 대상으로 본다.
        // 기준 시각: 보고 이력이 있으면 last_seen_at, 없으면 등록 시각(created_at).
        // → 등록 직후 최초 연결까지 faultTimeout 만큼 유예한 뒤 fault로 전이한다(C-2).
        long referenceMs = everSeen
                ? lastSeen.toInstant().toEpochMilli()
                : (node.getCreatedAt() != null ? node.getCreatedAt().toInstant().toEpochMilli() : now);
        long sinceSeen = now - referenceMs;
        boolean stale = sinceSeen > faultTimeout;

        // ── 생존 판정 ───────────────────────────────────────────────
        if (node.getRole() == Node.Role.fault) {
            // 복구 감지: 다시 신선하게 보고하기 시작하면 standby로 되돌린다(승격은 Phase B).
            if (everSeen && !stale) {
                node.changeRole(Node.Role.standby);
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
            Node.Role prev = node.getRole();
            String elapsed = everSeen
                    ? "마지막 보고 " + (sinceSeen / 1000) + "초 전"
                    : "에이전트 미연동 (등록 후 " + (sinceSeen / 1000) + "초 무응답)";

            // active(master)가 무응답이어도 승격 가능한 standby가 없으면 강등하지 않는다.
            // 강등하면 클러스터에 master 공백이 생기고(페일오버도 어차피 스킵), 복구돼도
            // standby로 남아 수동 재승격이 필요해진다. role=active를 유지하고 경보만 남겨,
            // 노드가 복구되면 그대로 master로 서비스가 재개되게 한다.
            if (prev == Node.Role.active && everSeen && !hasFailoverTarget(node)) {
                Set<DetectionEvent.Type> held = activeAlerts.computeIfAbsent(nodeId, k -> new HashSet<>());
                if (held.add(DetectionEvent.Type.NODE_FAULT)) {
                    record(node, DetectionEvent.Type.NODE_FAULT, DetectionEvent.Severity.CRITICAL,
                            node.getHostname() + " master 무응답 — 승격 가능한 standby 없음 (master 유지)",
                            elapsed + ", 페일오버 대상 없음");
                    log.warn("master 무응답이나 페일오버 대상 없음 → role 유지: {} ({})",
                            node.getHostname(), elapsed);
                }
                return;
            }

            DetectionEvent.Severity sev = prev == Node.Role.active
                    ? DetectionEvent.Severity.CRITICAL : DetectionEvent.Severity.WARNING;
            node.changeRole(Node.Role.fault);
            nodeRepository.save(node);
            clearNodeState(nodeId);
            metricsCache.remove(nodeId);
            String reason = node.getHostname() + " 무응답 (" + elapsed + ")";
            record(node, DetectionEvent.Type.NODE_FAULT, sev,
                    node.getHostname() + " 노드 무응답 감지 (" + prev + " → fault)",
                    elapsed + ", 임계 " + (faultTimeout / 1000) + "초");
            log.warn("노드 Fault 판정: {} ({})", node.getHostname(), elapsed);

            // 한 번이라도 active로 서비스하던 노드가 죽은 경우에만 자동 페일오버(Phase B).
            // 등록 후 한 번도 연결된 적 없는 노드는 실제 서비스 이력이 없으므로 페일오버를 트리거하지 않는다.
            if (prev == Node.Role.active && everSeen) {
                eventPublisher.publishEvent(new NodeFaultEvent(
                        cluster.getId(), nodeId, node.getHostname(), reason));
            }
            return;
        }

        // fresh 복귀: '대상 없는 master 무응답'으로 잡아둔 NODE_FAULT 경보를 해제한다.
        Set<DetectionEvent.Type> heldFault = activeAlerts.get(nodeId);
        if (heldFault != null && heldFault.remove(DetectionEvent.Type.NODE_FAULT)) {
            record(node, DetectionEvent.Type.NODE_RECOVERED, DetectionEvent.Severity.INFO,
                    node.getHostname() + " master 응답 복구", "정상 보고 재개");
        }

        // ── 자원/프로세스 평가 (신선한 메트릭이 있을 때만) ──────────────
        metricsCache.getFresh(nodeId, props.metricsFreshMillis())
                .ifPresent(m -> evaluateMetrics(node, m));
    }

    /**
     * 같은 클러스터에 승격 가능한 페일오버 대상(role=standby + 신선한 메트릭)이 있는가.
     * FailoverOrchestrator의 대상 선정/생존 가드와 동일한 기준(standby + isFresh)을 쓴다.
     */
    private boolean hasFailoverTarget(Node active) {
        UUID selfId = active.getId();
        for (Node n : nodeRepository.findByClusterId(active.getCluster().getId())) {
            if (!n.getId().equals(selfId)
                    && n.getRole() == Node.Role.standby
                    && metricsCache.isFresh(n.getId(), props.metricsFreshMillis())) {
                return true;
            }
        }
        return false;
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
        checkHaServiceFailover(node, m);
    }

    /**
     * active 노드에서 haManaged 서비스 프로세스가 유예시간 이상 사라지면 자동 페일오버를
     * 트리거한다(인시던트당 1회). 임의 프로세스 소실(checkProcessDown, WARNING)과 달리
     * 운영자가 HA 대상으로 명시한 서비스만 대상이며, 서비스가 실행 중인 standby가 없으면
     * 승격해도 서비스 공백이라 트리거하지 않고 CRITICAL 경보만 남긴다.
     */
    private void checkHaServiceFailover(Node node, MetricsPushRequest m) {
        if (!props.isProcessFailoverEnabled()) return;
        if (node.getRole() != Node.Role.active) { clearHaState(node.getId()); return; }
        if (m.getProcesses() == null) return;   // 프로세스 미보고 → 판정 불가(오탐 방지)

        List<ManagedService> haServices =
                managedServiceRepository.findByClusterIdAndHaManagedTrue(node.getCluster().getId());
        if (haServices.isEmpty()) return;

        Set<String> running = processNames(m);
        long now = System.currentTimeMillis();

        for (ManagedService svc : haServices) {
            String pattern = svc.getName();
            String key = node.getId() + ":" + pattern;

            if (matches(running, pattern)) {   // 프로세스 복귀 → 인시던트 종료, 다음엔 유예부터
                haMissingSince.remove(key);
                haMissingFired.remove(key);
                continue;
            }

            long since = haMissingSince.computeIfAbsent(key, k -> now);
            if (now - since < props.getProcessFailoverGraceSeconds() * 1000L) continue;
            if (!haMissingFired.add(key)) continue;   // 인시던트당 1회만 발화

            Node target = findStandbyRunning(node, pattern);
            if (target == null) {
                record(node, DetectionEvent.Type.PROCESS_DOWN, DetectionEvent.Severity.CRITICAL,
                        node.getHostname() + " HA 서비스 '" + svc.getDisplayName()
                                + "' 프로세스 다운 — 서비스 실행 중인 standby 없음 (페일오버 보류)",
                        "패턴 " + pattern + ", 소실 " + ((now - since) / 1000) + "초");
                log.warn("HA 서비스 다운이나 페일오버 대상 없음: {} / {} on {}",
                        svc.getDisplayName(), pattern, node.getHostname());
                continue;
            }

            String reason = "HA 서비스 프로세스 다운: " + svc.getDisplayName()
                    + " (" + pattern + ", " + ((now - since) / 1000) + "초 지속)";
            record(node, DetectionEvent.Type.PROCESS_DOWN, DetectionEvent.Severity.CRITICAL,
                    node.getHostname() + " HA 서비스 '" + svc.getDisplayName()
                            + "' 프로세스 다운 → 자동 페일오버 트리거",
                    "패턴 " + pattern + ", 대상 " + target.getHostname());
            log.warn("HA 서비스 다운 페일오버 트리거: {} on {} → {}",
                    svc.getDisplayName(), node.getHostname(), target.getHostname());
            eventPublisher.publishEvent(new NodeFaultEvent(
                    node.getCluster().getId(), node.getId(), node.getHostname(), reason));
        }
    }

    /** 같은 클러스터에서 [standby + 신선 메트릭 + 해당 서비스 프로세스 실행 중]인 노드. */
    private Node findStandbyRunning(Node active, String pattern) {
        for (Node n : nodeRepository.findByClusterId(active.getCluster().getId())) {
            if (n.getId().equals(active.getId()) || n.getRole() != Node.Role.standby) continue;
            Optional<MetricsPushRequest> m = metricsCache.getFresh(n.getId(), props.metricsFreshMillis());
            if (m.isPresent() && m.get().getProcesses() != null
                    && matches(processNames(m.get()), pattern)) {
                return n;
            }
        }
        return null;
    }

    /** 프로세스명 소문자 집합 (ServiceCatalogService.instanceState와 동일 매칭 규칙). */
    private static Set<String> processNames(MetricsPushRequest m) {
        Set<String> names = new HashSet<>();
        for (Map<String, String> p : m.getProcesses()) {
            String name = p.get("name");
            if (name != null) names.add(name.toLowerCase());
        }
        return names;
    }

    private static boolean matches(Set<String> names, String pattern) {
        return names.stream().anyMatch(n -> n.contains(pattern));
    }

    private void clearHaState(UUID nodeId) {
        String prefix = nodeId + ":";
        haMissingSince.keySet().removeIf(k -> k.startsWith(prefix));
        haMissingFired.removeIf(k -> k.startsWith(prefix));
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
        clearHaState(nodeId);
    }
}
