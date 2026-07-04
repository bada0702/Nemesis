package com.nemesis.domain.cluster;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * VIP 영속화: VIP는 ip addr 별칭이라 노드 재부팅·인터페이스 재기동 시 소실된다.
 * 주기적으로 primary(active)의 VIP 존재를 점검(vip-check)해 드리프트를 복원한다.
 *
 * - active에 VIP 부재 → VipService.apply()로 재적용(primary vip-up + 그 외 vip-down).
 * - active에 VIP 존재 + standby에도 VIP 존재(스플릿브레인 잔재) → 해당 노드만 vip-down.
 * - 통신 실패(에이전트 다운 등)는 상태 불명이므로 아무 것도 하지 않는다(오동작 방지).
 * - recovering 노드가 있으면(페일오버 진행 중) 해당 클러스터는 이번 틱을 건너뛴다.
 *
 * vip-up은 control.sh에서 멱등이므로 이중 백엔드(server/server-02)가 동시에 돌아도 안전하다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "nemesis.vip.reconcile-enabled", havingValue = "true", matchIfMissing = true)
public class VipReconciler {

    private final ClusterRepository  clusterRepository;
    private final NodeRepository     nodeRepository;
    private final AgentCommandClient commandClient;
    private final VipService         vipService;

    @Scheduled(fixedDelayString = "${nemesis.vip.reconcile-interval-ms:60000}")
    @Transactional(readOnly = true)
    public void tick() {
        for (Cluster cluster : clusterRepository.findAll()) {
            try {
                reconcile(cluster);
            } catch (Exception e) {
                log.error("VIP 드리프트 점검 실패: cluster={}", cluster.getId(), e);
            }
        }
    }

    void reconcile(Cluster cluster) {
        String vip = cluster.getVip();
        if (vip == null || vip.isBlank()) return;

        List<Node> nodes = nodeRepository.findByClusterId(cluster.getId());
        if (nodes.stream().anyMatch(n -> n.getRole() == Node.Role.recovering)) return;   // 페일오버 진행 중

        Node active = nodes.stream()
                .filter(n -> n.getRole() == Node.Role.active)
                .findFirst().orElse(null);
        if (active == null) return;   // primary 공백 상태는 페일오버/복구 로직의 영역

        AgentCommandClient.Result check = commandClient.execute(active, "control.sh vip-check " + vip);
        if (check.error() != null) return;   // 상태 불명 → 개입 금지

        if (check.exitCode() != 0) {
            // 재부팅 등으로 primary에서 VIP 소실 → 재적용(primary vip-up + 그 외 vip-down)
            log.warn("VIP 드리프트 감지: {} primary({})에 VIP {} 부재 → 재적용",
                    cluster.getName(), active.getHostname(), vip);
            vipService.apply(cluster.getId());
            return;
        }

        // primary는 정상 보유 — standby에 잔재 VIP가 있으면(스플릿브레인) 제거
        for (Node n : nodes) {
            if (n.getId().equals(active.getId()) || n.getRole() != Node.Role.standby) continue;
            AgentCommandClient.Result r = commandClient.execute(n, "control.sh vip-check " + vip);
            if (r.error() == null && r.exitCode() == 0) {
                log.warn("스플릿브레인 VIP 잔재 감지: {} standby({})에 VIP {} 존재 → vip-down",
                        cluster.getName(), n.getHostname(), vip);
                commandClient.execute(n, "control.sh vip-down " + iface(n) + " " + vip + " " + cluster.getVipCidr());
            }
        }
    }

    private String iface(Node node) {
        String ni = node.getNetIface();
        if (ni != null && !ni.isBlank()) return ni;
        return node.getOsType() == Node.OsType.AIX ? "en0" : "eth0";
    }
}
