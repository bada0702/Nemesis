package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorClient;
import com.nemesis.domain.aiops.AiOperatorProperties;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/** SP3 조율: 1차 필터 → HIGH만 사이드카 조사 → finding upsert/resolve. */
@Slf4j
@Service
public class AiMonitorService {
    private final AiPrefilter prefilter;
    private final AiOperatorClient client;
    private final AiFindingService findings;
    private final AiOperatorProperties props;
    private final NodeRepository nodeRepo;
    private final AiPredictPrefilter predictPrefilter;

    public AiMonitorService(AiPrefilter prefilter, AiOperatorClient client, AiFindingService findings,
                            AiOperatorProperties props, NodeRepository nodeRepo,
                            AiPredictPrefilter predictPrefilter) {
        this.prefilter = prefilter; this.client = client; this.findings = findings;
        this.props = props; this.nodeRepo = nodeRepo; this.predictPrefilter = predictPrefilter;
    }

    public void runScan() {
        Set<String> active = new HashSet<>();
        Set<String> scanned = new HashSet<>();
        // 두 패스는 시스템 설정 화면에서 독립적으로 on/off 되므로, 이번 틱에 실제로 스캔한
        // 카테고리만 reconcile 대상으로 넘긴다 — 꺼진 패스의 기존 findings를 오해소하지 않기 위함.
        if (props.getMonitor().isEnabled()) {
            scanPass(prefilter.evaluate(), active, AiFinding.REACTIVE);
            scanned.add(AiFinding.REACTIVE);
        }
        if (props.getMonitor().isPredictEnabled()) {
            scanPass(predictPrefilter.evaluate(), active, AiFinding.PREDICTIVE);
            scanned.add(AiFinding.PREDICTIVE);
        }
        findings.reconcileResolved(active, scanned);
    }

    private void scanPass(List<Suspect> suspects, Set<String> active, String category) {
        for (Suspect s : suspects) {
            active.add(AiFinding.fingerprint(s.nodeId(), s.signalType()));
            boolean high = AiFinding.HIGH.equals(s.severity()) || AiFinding.CRITICAL.equals(s.severity());
            if (!high) { findings.recordWarn(s, category); continue; }
            ScanFinding sf = investigate(s);
            findings.recordHigh(s, sf, category);
        }
    }

    private ScanFinding investigate(Suspect s) {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("clusterId", s.clusterId()); ctx.put("nodeId", s.nodeId());
        ctx.put("hostname", s.hostname()); ctx.put("role", s.role());
        ctx.put("suspectSignals", List.of(Map.of("signalType", s.signalType(), "detail", s.detail())));
        ScanResponse r = client.scan(ctx, sshTarget(s.nodeId()));
        if (r == null || r.findings() == null) return null;   // 폴백: 1차 정보만
        return r.findings().stream()
                .filter(f -> s.signalType().equals(f.signalType()))
                .findFirst().orElse(null);
    }

    private Map<String, Object> sshTarget(UUID nodeId) {
        Node node = nodeId != null ? nodeRepo.findById(nodeId).orElse(null) : null;
        Map<String, Object> t = new HashMap<>();
        t.put("host", node != null ? node.getServiceIp() : null);
        t.put("port", 22);
        t.put("user", props.getSshUser());
        return t;
    }
}
