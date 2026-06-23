package com.nemesis.domain.aiops.monitor;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.AiOperatorProperties.Monitor;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** SP5 예측 사전필터: 노드별 disk/mem 롤링 추세로 임계 도달 ETA를 추정해 의심신호 방출. */
@Component
public class AiPredictPrefilter {
    private final MetricsCacheService metrics;
    private final NodeRepository nodeRepo;
    private final AiOperatorProperties props;

    private final Map<UUID, Deque<Double>> diskHist = new ConcurrentHashMap<>();
    private final Map<UUID, Deque<Double>> memHist  = new ConcurrentHashMap<>();

    public AiPredictPrefilter(MetricsCacheService metrics, NodeRepository nodeRepo, AiOperatorProperties props) {
        this.metrics = metrics; this.nodeRepo = nodeRepo; this.props = props;
    }

    /** 최근 샘플(시간순)로 최소제곱 기울기를 구해 target 도달까지 분 추정.
     *  증가추세 아님/이미 도달/샘플부족 시 -1. */
    public static long etaMinutes(double[] samples, long intervalMinutes, double target) {
        int n = samples.length;
        if (n < 2 || intervalMinutes <= 0) return -1;
        double current = samples[n - 1];
        if (current >= target) return -1;                 // 이미 도달 → 반응형이 처리
        double meanX = (n - 1) / 2.0, meanY = 0;
        for (double v : samples) meanY += v;
        meanY /= n;
        double num = 0, den = 0;
        for (int i = 0; i < n; i++) { num += (i - meanX) * (samples[i] - meanY); den += (i - meanX) * (i - meanX); }
        if (den == 0) return -1;
        double slopePerStep = num / den;
        if (slopePerStep <= 0) return -1;                 // 평탄/하강
        double slopePerMin = slopePerStep / intervalMinutes;
        return (long) Math.ceil((target - current) / slopePerMin);
    }

    public List<Suspect> evaluate() {
        Monitor cfg = props.getMonitor();
        if (!cfg.isPredictEnabled()) return List.of();
        long intervalMin = Math.max(1, cfg.getIntervalMs() / 60_000L);
        double target = cfg.getPredictTargetPercent();
        Map<UUID, MetricsPushRequest> all = metrics.getAll();
        List<Suspect> out = new ArrayList<>();
        for (Node node : nodeRepo.findAll()) {
            MetricsPushRequest mx = all.get(node.getId());
            if (mx == null) continue;
            UUID cid = node.getCluster() != null ? node.getCluster().getId() : null;
            String role = node.getRole() != null ? node.getRole().name() : "?";
            push(diskHist, node.getId(), mx.getDiskPercent(), cfg.getPredictWindowSize());
            push(memHist,  node.getId(), mx.getMemoryPercent(), cfg.getPredictWindowSize());
            predict(node, cid, role, AiFinding.DISK_TREND, diskHist.get(node.getId()),
                    mx.getDiskPercent(), intervalMin, target, cfg).ifPresent(out::add);
            predict(node, cid, role, AiFinding.MEM_TREND, memHist.get(node.getId()),
                    mx.getMemoryPercent(), intervalMin, target, cfg).ifPresent(out::add);
        }
        return out;
    }

    private void push(Map<UUID, Deque<Double>> hist, UUID id, double v, int max) {
        Deque<Double> q = hist.computeIfAbsent(id, k -> new ArrayDeque<>());
        q.addLast(v);
        while (q.size() > max) q.removeFirst();
    }

    private Optional<Suspect> predict(Node n, UUID cid, String role, String type, Deque<Double> hist,
                                      double current, long intervalMin, double target, Monitor cfg) {
        if (hist == null || hist.size() < cfg.getPredictMinSamples()) return Optional.empty();
        double[] arr = hist.stream().mapToDouble(Double::doubleValue).toArray();
        long eta = etaMinutes(arr, intervalMin, target);
        if (eta <= 0 || eta > cfg.getPredictHorizonMinutes()) return Optional.empty();
        String sev = eta <= cfg.getPredictCriticalEtaMinutes() ? AiFinding.CRITICAL
                   : eta <= cfg.getPredictHighEtaMinutes()     ? AiFinding.HIGH
                   : AiFinding.WARN;
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("current", current); d.put("etaMinutes", eta); d.put("target", target);
        return Optional.of(new Suspect(n.getId(), cid, n.getHostname(), role, type, sev, d));
    }
}
