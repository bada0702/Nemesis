package com.nemesis.domain.agent;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.ha.MetaVersion;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * Phase D-3/D-4: 에이전트가 클러스터 메타데이터(피어 목록·VIP)를 Pull 한다.
 * 에이전트는 이를 metadata.json에 원자적으로 반영하고, 관리 서버 단절 시
 * 이 정보를 근거로 노드 간 하트비트 기반 자율 페일오버를 수행한다.
 */
@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class AgentMetaController {

    private final AgentService   agentService;
    private final NodeRepository nodeRepository;

    @GetMapping("/meta")
    public ResponseEntity<Map<String, Object>> meta(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401).build();
        }
        UUID selfNodeId = agentService.resolveNodeId(authHeader.substring(7));
        Node self = nodeRepository.findById(selfNodeId)
                .orElseThrow(() -> new IllegalStateException("node not found: " + selfNodeId));
        Cluster cluster = self.getCluster();

        List<Node> clusterNodes = nodeRepository.findByClusterId(cluster.getId());

        List<Map<String, Object>> peers = new ArrayList<>();
        for (Node n : clusterNodes) {
            if (n.getId().equals(selfNodeId)) continue;
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("nodeId",      n.getId());
            p.put("hostname",    n.getHostname());
            p.put("heartbeatIp", n.getHeartbeatIp());
            p.put("serviceIp",   n.getServiceIp());
            p.put("role",        n.getRole().name());
            p.put("netIface",    n.getNetIface());
            peers.add(p);
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("nodeId",      self.getId());
        meta.put("hostname",    self.getHostname());
        meta.put("role",        self.getRole().name());
        meta.put("netIface",    self.getNetIface());
        meta.put("clusterId",   cluster.getId());
        meta.put("clusterName", cluster.getName());
        meta.put("vip",         cluster.getVip());
        meta.put("vipCidr",     cluster.getVipCidr());
        meta.put("peers",       peers);
        // 에이전트가 이 값을 그대로 하트비트에 실어 보내면, 서버는 이 시점의
        // MetaVersion과 비교해 "실제로 적용된" 메타데이터 동기화 상태를 판정할 수 있다.
        meta.put("version",     MetaVersion.of(cluster, clusterNodes));
        return ResponseEntity.ok(meta);
    }
}
