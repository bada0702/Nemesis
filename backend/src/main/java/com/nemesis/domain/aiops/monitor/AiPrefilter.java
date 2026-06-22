package com.nemesis.domain.aiops.monitor;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** SP3 1차 결정론 필터: 이미 캐시된 메트릭/로그프리뷰로 의심 신호 추출(SSH·LLM 없음). */
@Component
public class AiPrefilter {
    private final MetricsCacheService metrics;
    private final NodeRepository nodeRepo;
    private final AiOperatorProperties props;
    private final Map<UUID, Integer> cpuStreak = new ConcurrentHashMap<>();

    public AiPrefilter(MetricsCacheService metrics, NodeRepository nodeRepo, AiOperatorProperties props) {
        this.metrics = metrics; this.nodeRepo = nodeRepo; this.props = props;
    }

    public List<Suspect> evaluate() {
        AiOperatorProperties.Monitor cfg = props.getMonitor();
        Map<UUID, MetricsPushRequest> all = metrics.getAll();
        List<Suspect> out = new ArrayList<>();
        for (Node node : nodeRepo.findAll()) {
            MetricsPushRequest mx = all.get(node.getId());
            if (mx == null) continue;
            UUID cid = node.getCluster() != null ? node.getCluster().getId() : null;
            String role = node.getRole() != null ? node.getRole().name() : "?";

            band(mx.getDiskPercent(), cfg.getDiskThreshold(), cfg.getCriticalBandOffset())
                .ifPresent(sev -> out.add(suspect(node, cid, role, AiFinding.DISK_FULL, sev,
                        Map.of("disk", mx.getDiskPercent()))));
            band(mx.getMemoryPercent(), cfg.getMemThreshold(), cfg.getCriticalBandOffset())
                .ifPresent(sev -> out.add(suspect(node, cid, role, AiFinding.MEM_HIGH, sev,
                        Map.of("mem", mx.getMemoryPercent()))));

            if (mx.getCpuPercent() >= cfg.getCpuThreshold()) {
                int streak = cpuStreak.merge(node.getId(), 1, Integer::sum);
                if (streak >= cfg.getCpuSustainedCycles()) {
                    String sev = band(mx.getCpuPercent(), cfg.getCpuThreshold(), cfg.getCriticalBandOffset())
                            .orElse(AiFinding.WARN);
                    out.add(suspect(node, cid, role, AiFinding.CPU_SUSTAINED, sev,
                            Map.of("cpu", mx.getCpuPercent(), "cycles", streak)));
                }
            } else {
                cpuStreak.remove(node.getId());
            }

            List<String> errs = mx.getErrorLogPreview();
            if (errs != null && errs.size() >= cfg.getErrorPatternCount()) {
                out.add(suspect(node, cid, role, AiFinding.LOG_ERROR_PATTERN, AiFinding.WARN,
                        Map.of("errorCount", errs.size())));
            }
        }
        return out;
    }

    private Optional<String> band(double value, int threshold, int offset) {
        if (value >= threshold + offset) return Optional.of(AiFinding.HIGH);
        if (value >= threshold) return Optional.of(AiFinding.WARN);
        return Optional.empty();
    }
    private Suspect suspect(Node n, UUID cid, String role, String type, String sev, Map<String, Object> d) {
        return new Suspect(n.getId(), cid, n.getHostname(), role, type, sev, d);
    }
}
