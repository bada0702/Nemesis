package com.nemesis.domain.storage;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
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
 * 마운트 영속화: fstab 등록 금지 원칙(이중 마운트 파손 방지) 때문에 재부팅 시
 * 공유 스토리지 마운트가 소실된다. VipReconciler와 동일한 패턴으로 주기 점검해 드리프트를 복원한다.
 *
 * - active에 등록된 마운트 부재 → storage.sh fs-create로 재적용(멱등, vgchange -ay 포함).
 * - active는 정상 + standby에도 마운트 존재(스플릿브레인 잔재) → 해당 노드만 umount.
 * - 통신 실패(에이전트 다운 등)는 상태 불명이므로 아무 것도 하지 않는다(오동작 방지).
 * - recovering 노드가 있으면(페일오버 진행 중) 해당 클러스터는 이번 틱을 건너뛴다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "nemesis.storage.reconcile-enabled", havingValue = "true", matchIfMissing = true)
public class MountReconciler {

    private final ClusterRepository       clusterRepository;
    private final NodeRepository          nodeRepository;
    private final StorageDeviceRepository deviceRepository;
    private final AgentCommandClient      commandClient;

    @Scheduled(fixedDelayString = "${nemesis.storage.reconcile-interval-ms:60000}")
    @Transactional(readOnly = true)
    public void tick() {
        for (Cluster cluster : clusterRepository.findAll()) {
            try {
                reconcile(cluster);
            } catch (Exception e) {
                log.error("마운트 드리프트 점검 실패: cluster={}", cluster.getId(), e);
            }
        }
    }

    void reconcile(Cluster cluster) {
        List<StorageDevice> devices = deviceRepository.findByClusterId(cluster.getId()).stream()
                .filter(d -> d.getStatus() == StorageDevice.Status.REGISTERED)
                .toList();
        if (devices.isEmpty()) return;

        List<Node> nodes = nodeRepository.findByClusterId(cluster.getId());
        if (nodes.stream().anyMatch(n -> n.getRole() == Node.Role.recovering)) return;   // 페일오버 진행 중

        Node active = nodes.stream()
                .filter(n -> n.getRole() == Node.Role.active)
                .findFirst().orElse(null);
        if (active == null) return;   // primary 공백 상태는 페일오버/복구 로직의 영역

        for (StorageDevice device : devices) {
            reconcileDevice(cluster, device, active, nodes);
        }
    }

    private void reconcileDevice(Cluster cluster, StorageDevice device, Node active, List<Node> nodes) {
        AgentCommandClient.Result activeCheck = commandClient.execute(active, "storage.sh mount-status " + device.getMountPath());
        if (activeCheck.error() != null) return;   // 상태 불명 → 개입 금지

        if (activeCheck.exitCode() != 0) {
            // 재부팅 등으로 active에서 마운트 소실 — fs-create는 멱등이라 이미 끝난 단계는 건너뛰고 mount만 복원
            log.warn("마운트 드리프트 감지: {} active({})에 {} 마운트 부재 → 복원",
                    cluster.getName(), active.getHostname(), device.getMountPath());
            commandClient.execute(active,
                    "storage.sh fs-create " + device.getWwid() + " " + device.getFstype() + " " + device.getMountPath());
            return;
        }

        // active는 정상 보유 — standby에 잔재 마운트가 있으면(스플릿브레인 위험) 해제
        for (Node n : nodes) {
            if (n.getId().equals(active.getId()) || n.getRole() != Node.Role.standby) continue;
            AgentCommandClient.Result r = commandClient.execute(n, "storage.sh mount-status " + device.getMountPath());
            if (r.error() == null && r.exitCode() == 0) {
                log.warn("스플릿브레인 마운트 잔재 감지: {} standby({})에 {} 마운트 존재 → umount",
                        cluster.getName(), n.getHostname(), device.getMountPath());
                commandClient.execute(n, "storage.sh fs-umount " + device.getMountPath());
            }
        }
    }
}
