package com.nemesis.domain.ha;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.VipService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class HaSequenceExecutor {

    private final HaSequenceRepository  sequenceRepository;
    private final NodeRepository        nodeRepository;
    private final AgentCommandClient    commandClient;
    private final VipService            vipService;

    /**
     * 주어진 타입(STARTUP/SHUTDOWN/FAILOVER)의 절차를 순서대로 실행하고
     * 단계별 결과 목록을 반환한다.
     */
    public Map<String, Object> execute(UUID clusterId, String type) {
        HaSequence seq = sequenceRepository.findByClusterGroupIdAndType(clusterId, type)
                .orElseThrow(() -> new IllegalStateException(type + " 절차가 정의되지 않았습니다."));

        List<Map<String, Object>> steps = seq.getSteps();
        if (steps == null || steps.isEmpty()) {
            throw new IllegalStateException("실행할 단계가 없습니다.");
        }

        List<Node> clusterNodes = nodeRepository.findByClusterId(clusterId);
        List<Map<String, Object>> results = new ArrayList<>();
        boolean allOk = true;

        for (int i = 0; i < steps.size(); i++) {
            Map<String, Object> step = steps.get(i);
            String action      = str(step, "action");
            String serviceName = str(step, "serviceName");
            String nodeRole    = str(step, "nodeRole");
            int    waitSec     = num(step, "waitAfterSec");

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("index",       i);
            result.put("action",      action);
            result.put("serviceName", serviceName);
            result.put("nodeRole",    nodeRole);
            result.put("ok",          false);

            try {
                switch (action) {
                    case "VIP_TRANSFER" -> {
                        Map<String, Object> vr = vipService.apply(clusterId);
                        boolean ok = Boolean.TRUE.equals(vr.get("applied"));
                        result.put("ok",     ok);
                        result.put("output", ok ? "VIP 인수 성공: " + vr.get("vip") : "VIP 인수 실패");
                    }
                    case "WAIT" -> {
                        Thread.sleep(waitSec * 1000L);
                        result.put("ok",     true);
                        result.put("output", waitSec + "초 대기 완료");
                    }
                    default -> {
                        // START / STOP / CHECK — 에이전트 명령
                        String control = switch (action) {
                            case "START"  -> "control.sh svc-start " + serviceName;
                            case "STOP"   -> "control.sh svc-stop "  + serviceName;
                            case "CHECK"  -> "control.sh svc-status " + serviceName;
                            default       -> "control.sh svc-status " + serviceName;
                        };

                        List<Node> targets = resolveNodes(clusterNodes, nodeRole);
                        if (targets.isEmpty()) {
                            result.put("ok",     false);
                            result.put("output", "대상 노드(" + nodeRole + ")를 찾을 수 없습니다.");
                        } else {
                            List<Map<String, Object>> nodeResults = new ArrayList<>();
                            boolean stepOk = true;
                            for (Node node : targets) {
                                AgentCommandClient.Result r = commandClient.execute(node, control);
                                Map<String, Object> nr = new LinkedHashMap<>();
                                nr.put("node",     node.getHostname());
                                nr.put("ok",       r.ok());
                                nr.put("stdout",   r.stdout());
                                nr.put("stderr",   r.stderr());
                                if (r.error() != null) nr.put("error", r.error());
                                nodeResults.add(nr);
                                if (!r.ok()) stepOk = false;
                            }
                            result.put("ok",         stepOk);
                            result.put("nodeResults", nodeResults);
                            result.put("output",     stepOk ? "성공" : "일부 노드 실패");
                        }
                    }
                }
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                result.put("ok",     false);
                result.put("output", "대기 중단: " + ie.getMessage());
            } catch (Exception e) {
                log.warn("Step {} 실행 중 오류: {}", i, e.getMessage());
                result.put("ok",     false);
                result.put("output", e.getMessage());
            }

            results.add(result);

            // 단계 실패 시 즉시 중단
            if (!Boolean.TRUE.equals(result.get("ok"))) {
                allOk = false;
                break;
            }

            // 단계 완료 후 대기 (WAIT action 제외 — 이미 대기함)
            if (!"WAIT".equals(action) && waitSec > 0) {
                try { Thread.sleep(waitSec * 1000L); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type",      type);
        out.put("clusterId", clusterId);
        out.put("ok",        allOk);
        out.put("executed",  results.size());
        out.put("total",     steps.size());
        out.put("steps",     results);
        return out;
    }

    private List<Node> resolveNodes(List<Node> nodes, String role) {
        if (role == null || role.isBlank() || "ALL".equalsIgnoreCase(role)) return nodes;
        return nodes.stream()
                .filter(n -> role.equalsIgnoreCase(n.getRole().uiToken()))
                .toList();
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v != null ? v.toString() : "";
    }

    private static int num(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v instanceof Number n) return n.intValue();
        try { return Integer.parseInt(String.valueOf(v)); } catch (Exception e) { return 0; }
    }
}
