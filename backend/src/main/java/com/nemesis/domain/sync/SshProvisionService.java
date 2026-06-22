package com.nemesis.domain.sync;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/** 클러스터 노드 간 passwordless SSH 신뢰를 자동 구성한다(rsync용). */
@Slf4j
@Service
@RequiredArgsConstructor
public class SshProvisionService {

    private final NodeRepository     nodeRepo;
    private final AgentCommandClient commandClient;

    public Map<String, Object> provision(UUID clusterId) {
        List<Node> nodes = nodeRepo.findByClusterId(clusterId);
        List<String> provisioned = new ArrayList<>();
        List<String> failed = new ArrayList<>();

        // 1) 각 노드 keygen → pubkey 수집
        Map<Node, String> pubkeys = new LinkedHashMap<>();
        for (Node n : nodes) {
            AgentCommandClient.Result r = commandClient.execute(n, "control.sh ssh-keygen-nemesis");
            if (r.ok() && r.stdout() != null && !r.stdout().isBlank()) {
                pubkeys.put(n, r.stdout().trim());
                provisioned.add(n.getHostname());
            } else {
                failed.add(n.getHostname());
            }
        }
        // 2) 각 노드에 다른 모든 peer의 공개키를 authorize
        for (Node n : pubkeys.keySet()) {
            for (Map.Entry<Node, String> peer : pubkeys.entrySet()) {
                if (peer.getKey().equals(n)) continue;
                commandClient.execute(n, "control.sh ssh-authorize \"" + peer.getValue() + "\"");
            }
        }
        return Map.of("provisioned", provisioned, "failed", failed);
    }
}
