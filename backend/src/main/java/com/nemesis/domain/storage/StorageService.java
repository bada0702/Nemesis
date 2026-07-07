package com.nemesis.domain.storage;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.domain.storage.dto.StorageDtos.RegisterDeviceRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 공유 스토리지(FC LUN) 인벤토리: 스캔 조회(비영속) + 등록/삭제(영속). */
@Slf4j
@Service
@RequiredArgsConstructor
public class StorageService {

    private final StorageDeviceRepository deviceRepository;
    private final ClusterRepository       clusterRepository;
    private final NodeRepository          nodeRepository;
    private final AgentCommandClient      commandClient;

    private static final Pattern SIZE_PATTERN =
            Pattern.compile("([0-9.]+)\\s*([KMGTP]?)B?", Pattern.CASE_INSENSITIVE);
    private static final Pattern WWID_PATTERN = Pattern.compile("^[0-9a-fA-F]{8,64}$");

    public record DiscoveredDevice(String name, String wwid, Long sizeBytes,
                                    int pathCount, boolean alreadyRegistered) {}

    /** storage.sh disk-list의 TSV 출력(name\twwid\tsize\tpaths)을 파싱한다. */
    List<DiscoveredDevice> parseDiskList(String stdout) {
        List<DiscoveredDevice> out = new ArrayList<>();
        if (stdout == null) return out;
        for (String line : stdout.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            String[] cols = trimmed.split("\t", -1);
            if (cols.length < 4) continue;
            String wwid = cols[1].trim();
            if (wwid.isEmpty()) continue;
            out.add(new DiscoveredDevice(cols[0].trim(), wwid,
                    parseSize(cols[2].trim()), parseIntSafe(cols[3].trim()), false));
        }
        return out;
    }

    /** "10G"/"512M"/"2048" 같은 크기 표기를 바이트로 변환한다(이진 단위). */
    Long parseSize(String s) {
        if (s == null || s.isBlank()) return null;
        Matcher m = SIZE_PATTERN.matcher(s.trim());
        if (!m.matches()) return null;
        double num = Double.parseDouble(m.group(1));
        long mult = switch (m.group(2).toUpperCase()) {
            case "K" -> 1024L;
            case "M" -> 1024L * 1024;
            case "G" -> 1024L * 1024 * 1024;
            case "T" -> 1024L * 1024 * 1024 * 1024;
            case "P" -> 1024L * 1024 * 1024 * 1024 * 1024;
            default -> 1L;
        };
        return (long) (num * mult);
    }

    private int parseIntSafe(String s) {
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; }
    }

    public List<StorageDevice> listDevices(UUID clusterId) {
        return deviceRepository.findByClusterId(clusterId);
    }

    /** 지정 노드에서 FC 재스캔 후 디스크 목록을 조회한다(영속화하지 않음 — 등록 전 미리보기). */
    public List<DiscoveredDevice> scan(UUID clusterId, UUID nodeId) {
        clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("cluster not found: " + clusterId));
        Node node = nodeRepository.findByClusterId(clusterId).stream()
                .filter(n -> n.getId().equals(nodeId)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("노드가 클러스터에 없습니다: " + nodeId));

        AgentCommandClient.Result rescan = commandClient.execute(node, "storage.sh scan-fc");
        if (!rescan.ok()) {
            log.warn("FC 재스캔 실패(계속 진행, 기존 상태로 조회): {} - {}",
                    node.getHostname(), rescan.error() != null ? rescan.error() : rescan.stderr());
        }

        AgentCommandClient.Result list = commandClient.execute(node, "storage.sh disk-list");
        if (!list.ok()) {
            throw new IllegalStateException("디스크 목록 조회 실패: " +
                    (list.error() != null ? list.error() : list.stderr()));
        }

        List<String> registeredWwids = deviceRepository.findByClusterId(clusterId).stream()
                .map(StorageDevice::getWwid).toList();
        return parseDiskList(list.stdout()).stream()
                .map(d -> new DiscoveredDevice(d.name(), d.wwid(), d.sizeBytes(), d.pathCount(),
                        registeredWwids.contains(d.wwid())))
                .toList();
    }

    @Transactional
    public StorageDevice registerDevice(UUID clusterId, RegisterDeviceRequest req) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("cluster not found: " + clusterId));
        String wwid = req.wwid() == null ? "" : req.wwid().trim();
        if (!WWID_PATTERN.matcher(wwid).matches()) {
            throw new IllegalStateException("올바르지 않은 WWID 형식입니다: " + req.wwid());
        }
        if (deviceRepository.findByClusterIdAndWwid(clusterId, wwid).isPresent()) {
            throw new IllegalStateException("이미 등록된 WWID입니다: " + wwid);
        }
        StorageDevice device = StorageDevice.builder()
                .cluster(cluster)
                .wwid(wwid)
                .label(req.label())
                .sizeBytes(req.sizeBytes())
                .pathCount(req.pathCount() == null ? 0 : req.pathCount())
                .source(req.discoveredNodeId() != null ? StorageDevice.Source.SCAN : StorageDevice.Source.MANUAL)
                .discoveredNodeId(req.discoveredNodeId())
                .status(StorageDevice.Status.REGISTERED)
                .build();
        return deviceRepository.save(device);
    }

    @Transactional
    public void deleteDevice(UUID clusterId, UUID deviceId) {
        StorageDevice device = deviceRepository.findById(deviceId)
                .orElseThrow(() -> new IllegalArgumentException("디바이스 없음: " + deviceId));
        if (!device.getCluster().getId().equals(clusterId)) {
            throw new IllegalArgumentException("디바이스가 해당 클러스터에 속하지 않습니다: " + deviceId);
        }
        deviceRepository.deleteById(deviceId);
    }
}
