package com.nemesis.domain.agent;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.AgentRegisterRequest;
import com.nemesis.dto.AgentRegisterResponse;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

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
        node.setServiceIp(req.getServiceIp());
        node.setHeartbeatIp(req.getHeartbeatIp());
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

    public UUID resolveNodeId(String apiKey) {
        return agentKeyRepository.findByApiKey(apiKey)
                .filter(AgentKey::isValid)
                .map(k -> k.getNode() != null ? k.getNode().getId() : null)
                .orElseThrow(() -> new IllegalArgumentException("Invalid API key"));
    }
}
