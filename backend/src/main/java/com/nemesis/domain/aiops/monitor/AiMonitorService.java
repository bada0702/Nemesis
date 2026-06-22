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

    public AiMonitorService(AiPrefilter prefilter, AiOperatorClient client, AiFindingService findings,
                            AiOperatorProperties props, NodeRepository nodeRepo) {
        this.prefilter = prefilter; this.client = client; this.findings = findings;
        this.props = props; this.nodeRepo = nodeRepo;
    }

    public void runScan() {
        List<Suspect> suspects = prefilter.evaluate();
        Set<String> active = new HashSet<>();
        for (Suspect s : suspects) {
            active.add(AiFinding.fingerprint(s.nodeId(), s.signalType()));
            boolean high = AiFinding.HIGH.equals(s.severity()) || AiFinding.CRITICAL.equals(s.severity());
            if (!high) { findings.recordWarn(s); continue; }
            ScanFinding sf = investigate(s);
            findings.recordHigh(s, sf);
        }
        findings.reconcileResolved(active);
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
