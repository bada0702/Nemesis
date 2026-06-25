package com.nemesis.domain.cluster;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 클러스터 VIP의 실제 플럼빙. 페일오버 시점에만 VIP가 이동하던 기존 구조를 보완해,
 * 클러스터 생성/노드 PRIMARY 지정 직후에도 primary 노드 OS에 VIP 별칭이 실제로
 * 생성되도록 한다(control.sh vip-up). 미적용 시 ifconfig에 VIP가 보이지 않아
 * 클라이언트가 VIP로 접속할 수 없다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VipService {

    private final ClusterRepository  clusterRepository;
    private final NodeRepository     nodeRepository;
    private final AgentCommandClient commandClient;

    /**
     * VIP 적용: primary 노드에 vip-up, 그 외 노드에는 vip-down(스플릿브레인 별칭 제거).
     * 각 노드 결과를 모아 반환한다(부분 실패 허용 — 노드별 보고).
     */
    @Transactional(readOnly = true)
    public Map<String, Object> apply(UUID clusterId) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        String vip = cluster.getVip();
        if (vip == null || vip.isBlank()) {
            throw new IllegalStateException("클러스터에 VIP가 설정되어 있지 않습니다.");
        }
        int cidr = cluster.getVipCidr();

        List<Map<String, Object>> results = new ArrayList<>();
        boolean primaryOk = false;
        for (Node node : nodeRepository.findByClusterId(clusterId)) {
            boolean isPrimary = node.getRole() == Node.Role.active;
            String action = isPrimary ? "vip-up" : "vip-down";
            AgentCommandClient.Result r = commandClient.execute(node,
                    "control.sh " + action + " " + iface(node) + " " + vip + " " + cidr);

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("nodeId",   node.getId());
            m.put("hostname", node.getHostname());
            m.put("role",     node.getRole().uiToken());
            m.put("action",   action);
            m.put("ok",       r.ok());
            if (!r.ok()) m.put("error", summarize(r));
            results.add(m);
            if (isPrimary && r.ok()) primaryOk = true;
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("vip",     vip);
        out.put("applied", primaryOk);
        out.put("nodes",   results);
        return out;
    }

    /** 노드별 VIP 존재 여부(vip-check). 읽기 전용 점검. */
    @Transactional(readOnly = true)
    public Map<String, Object> status(UUID clusterId) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        String vip = cluster.getVip();

        List<Map<String, Object>> results = new ArrayList<>();
        if (vip != null && !vip.isBlank()) {
            for (Node node : nodeRepository.findByClusterId(clusterId)) {
                AgentCommandClient.Result r = commandClient.execute(node, "control.sh vip-check " + vip);
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("nodeId",   node.getId());
                m.put("hostname", node.getHostname());
                m.put("role",     node.getRole().uiToken());
                // exitCode 0 = VIP 존재. 통신 실패(error)는 UNKNOWN.
                m.put("vipPresent", r.error() == null ? r.exitCode() == 0 : null);
                if (r.error() != null) m.put("error", r.error());
                results.add(m);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("vip",   vip);
        out.put("nodes", results);
        return out;
    }

    /**
     * VIP 전체 해제: 모든 노드에서 vip-down 실행 (이중화 중지).
     * primary 포함 전 노드의 VIP 별칭을 제거한다.
     */
    @Transactional(readOnly = true)
    public Map<String, Object> down(UUID clusterId) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));
        String vip = cluster.getVip();
        if (vip == null || vip.isBlank()) {
            throw new IllegalStateException("클러스터에 VIP가 설정되어 있지 않습니다.");
        }
        int cidr = cluster.getVipCidr();

        List<Map<String, Object>> results = new ArrayList<>();
        for (Node node : nodeRepository.findByClusterId(clusterId)) {
            AgentCommandClient.Result r = commandClient.execute(node,
                    "control.sh vip-down " + iface(node) + " " + vip + " " + cidr);

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("nodeId",   node.getId());
            m.put("hostname", node.getHostname());
            m.put("role",     node.getRole().uiToken());
            m.put("action",   "vip-down");
            m.put("ok",       r.ok());
            if (!r.ok()) m.put("error", summarize(r));
            results.add(m);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("vip",     vip);
        out.put("removed", results.stream().allMatch(m -> Boolean.TRUE.equals(m.get("ok"))));
        out.put("nodes",   results);
        return out;
    }

    /**
     * 비동기 best-effort 적용. 클러스터 생성/수정·노드 PRIMARY 지정 직후 호출된다.
     * 에이전트 미설치/미통신 노드가 있어도 API 응답을 막지 않는다.
     */
    @Async
    public void applyAsync(UUID clusterId) {
        try {
            Map<String, Object> r = apply(clusterId);
            log.info("VIP 자동 적용: cluster={} applied={}", clusterId, r.get("applied"));
        } catch (Exception e) {
            log.warn("VIP 자동 적용 실패(무시): cluster={} - {}", clusterId, e.getMessage());
        }
    }

    private String iface(Node node) {
        String ni = node.getNetIface();
        if (ni != null && !ni.isBlank()) return ni;
        return node.getOsType() == Node.OsType.AIX ? "en0" : "eth0";
    }

    private String summarize(AgentCommandClient.Result r) {
        if (r.error() != null && !r.error().isBlank()) return r.error();
        if (r.stderr() != null && !r.stderr().isBlank()) {
            String s = r.stderr().trim();
            return s.length() > 200 ? s.substring(0, 200) : s;
        }
        return "exit=" + r.exitCode();
    }
}
