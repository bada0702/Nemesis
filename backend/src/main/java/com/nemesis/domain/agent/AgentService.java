package com.nemesis.domain.agent;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.AgentRegisterRequest;
import com.nemesis.dto.AgentRegisterResponse;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class AgentService {

    private final AgentKeyRepository agentKeyRepository;
    private final NodeRepository     nodeRepository;
    private final MetricsCacheService metricsCache;

    @Transactional
    public AgentRegisterResponse register(AgentRegisterRequest req) {
        AgentKey key = agentKeyRepository.findByApiKey(req.getApiKey())
                .filter(AgentKey::isValid)
                .orElseThrow(() -> new IllegalArgumentException("Invalid or revoked API key"));

        Node node = nodeRepository
                .findByClusterIdAndHostname(key.getCluster().getId(), req.getHostname())
                .orElseGet(() -> Node.builder()
                        .cluster(key.getCluster())
                        .hostname(req.getHostname())
                        .osType(Node.OsType.valueOf(req.getOs().toUpperCase()))
                        .build());

        node.setAgentVersion(req.getVersion());
        // 에이전트 보고 IP로 service_ip/heartbeat_ip를 채우되, 도달 불가능한 값
        // (loopback·0.0.0.0·blank)으로는 관리자가 설정한 라우팅 가능한 값을 덮어쓰지 않는다.
        // 덮어쓰면 관리 서버가 control 포트(17001)로 노드에 접속할 수 없어 VIP 명령/상태점검이 실패한다.
        if (isReachableIp(req.getServiceIp())) {
            node.setServiceIp(req.getServiceIp());
        } else {
            log.warn("에이전트 보고 serviceIp 무시(도달 불가): node={} reported={} (기존값 유지={})",
                    req.getHostname(), req.getServiceIp(), node.getServiceIp());
        }
        if (isReachableIp(req.getHeartbeatIp())) {
            node.setHeartbeatIp(req.getHeartbeatIp());
        }
        node.setLastSeenAt(OffsetDateTime.now());
        node = nodeRepository.save(node);

        key.setNode(node);
        agentKeyRepository.save(key);

        return new AgentRegisterResponse(
                node.getId(),
                key.getCluster().getId(),
                key.getCluster().getName(),
                node.getRole().name(),
                600
        );
    }

    @Transactional
    public void pushMetrics(String apiKey, MetricsPushRequest req) {
        AgentKey key = agentKeyRepository.findByApiKey(apiKey)
                .filter(AgentKey::isValid)
                .orElseThrow(() -> new IllegalArgumentException("Invalid API key"));

        Node node = key.getNode();
        if (node == null) {
            throw new IllegalStateException("Agent not registered yet. Call /api/agent/register first.");
        }

        node.setLastSeenAt(OffsetDateTime.now());
        nodeRepository.save(node);
        metricsCache.put(node.getId(), req);
    }

    /**
     * 관리 서버가 control 포트로 실제 접속 가능한 IP인지 검사한다.
     * loopback(127.x, ::1, localhost), 와일드카드(0.0.0.0), blank는 도달 불가로 본다.
     */
    private boolean isReachableIp(String ip) {
        if (ip == null || ip.isBlank()) return false;
        String s = ip.trim().toLowerCase();
        return !(s.equals("localhost")
                || s.equals("0.0.0.0")
                || s.equals("::1")
                || s.startsWith("127."));
    }

    public UUID resolveNodeId(String apiKey) {
        return agentKeyRepository.findByApiKey(apiKey)
                .filter(AgentKey::isValid)
                .map(k -> k.getNode() != null ? k.getNode().getId() : null)
                .orElseThrow(() -> new IllegalArgumentException("Invalid API key"));
    }
}
