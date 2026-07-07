package com.nemesis.domain.storage;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.domain.storage.dto.StorageDtos.RegisterDeviceRequest;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class StorageServiceTest {

    private final StorageDeviceRepository deviceRepo  = mock(StorageDeviceRepository.class);
    private final ClusterRepository       clusterRepo = mock(ClusterRepository.class);
    private final NodeRepository          nodeRepo    = mock(NodeRepository.class);
    private final AgentCommandClient      cmd         = mock(AgentCommandClient.class);
    private final StorageService svc = new StorageService(deviceRepo, clusterRepo, nodeRepo, cmd);

    @Test
    void parseDiskList_parsesTsvLines() {
        var result = svc.parseDiskList("mpatha\t360014056b1a3fbe\t10G\t2\nmpathb\t360014056b1a3fbf\t5G\t1\n");

        assertThat(result).hasSize(2);
        assertThat(result.get(0).name()).isEqualTo("mpatha");
        assertThat(result.get(0).wwid()).isEqualTo("360014056b1a3fbe");
        assertThat(result.get(0).sizeBytes()).isEqualTo(10L * 1024 * 1024 * 1024);
        assertThat(result.get(0).pathCount()).isEqualTo(2);
    }

    @Test
    void parseDiskList_skipsBlankLinesAndRowsWithoutWwid() {
        var result = svc.parseDiskList("\nmpatha\t\t10G\t2\nmpathb\t360014056b1a3fbf\t5G\t1\n");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).wwid()).isEqualTo("360014056b1a3fbf");
    }

    @Test
    void parseDiskList_nullStdout_returnsEmptyList() {
        assertThat(svc.parseDiskList(null)).isEmpty();
    }

    @Test
    void parseSize_handlesUnitsAndPlainBytes() {
        assertThat(svc.parseSize("10G")).isEqualTo(10L * 1024 * 1024 * 1024);
        assertThat(svc.parseSize("512M")).isEqualTo(512L * 1024 * 1024);
        assertThat(svc.parseSize("2048")).isEqualTo(2048L);
        assertThat(svc.parseSize(null)).isNull();
        assertThat(svc.parseSize("garbage")).isNull();
    }

    private Cluster cluster(UUID id) {
        Cluster c = new Cluster(); c.setId(id); c.setName("c"); return c;
    }

    private Node node(UUID clusterId, UUID nodeId, String host) {
        Node n = new Node(); n.setId(nodeId); n.setHostname(host);
        n.setServiceIp("10.0.0.1"); n.setNetIface("eth0");
        return n;
    }

    @Test
    void registerDevice_rejectsInvalidWwid() {
        UUID clusterId = UUID.randomUUID();
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));

        assertThatThrownBy(() -> svc.registerDevice(clusterId,
                new RegisterDeviceRequest("not a wwid!", null, null, null, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("WWID");
    }

    @Test
    void registerDevice_rejectsDuplicateWwidInSameCluster() {
        UUID clusterId = UUID.randomUUID();
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(deviceRepo.findByClusterIdAndWwid(clusterId, "0123abcd")).thenReturn(Optional.of(mock(StorageDevice.class)));

        assertThatThrownBy(() -> svc.registerDevice(clusterId,
                new RegisterDeviceRequest("0123abcd", null, null, null, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("이미 등록");
    }

    @Test
    void registerDevice_savesManualSource_whenNoDiscoveredNodeId() {
        UUID clusterId = UUID.randomUUID();
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(deviceRepo.findByClusterIdAndWwid(clusterId, "0123abcd")).thenReturn(Optional.empty());
        when(deviceRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        StorageDevice saved = svc.registerDevice(clusterId,
                new RegisterDeviceRequest("0123abcd", "라벨", 100L, 2, null));

        assertThat(saved.getSource()).isEqualTo(StorageDevice.Source.MANUAL);
        assertThat(saved.getWwid()).isEqualTo("0123abcd");
    }

    @Test
    void scan_marksAlreadyRegisteredDevices() {
        UUID clusterId = UUID.randomUUID();
        UUID nodeId = UUID.randomUUID();
        Node n = node(clusterId, nodeId, "bot");
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(nodeRepo.findByClusterId(clusterId)).thenReturn(List.of(n));
        when(cmd.execute(eq(n), eq("storage.sh scan-fc")))
                .thenReturn(new AgentCommandClient.Result(true, 0, "", "", null));
        when(cmd.execute(eq(n), eq("storage.sh disk-list")))
                .thenReturn(new AgentCommandClient.Result(true, 0, "mpatha\tabc123\t10G\t2\n", "", null));
        StorageDevice existing = StorageDevice.builder().wwid("abc123").build();
        when(deviceRepo.findByClusterId(clusterId)).thenReturn(List.of(existing));

        var result = svc.scan(clusterId, nodeId);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).alreadyRegistered()).isTrue();
    }

    @Test
    void scan_throwsIllegalState_whenDiskListFails() {
        UUID clusterId = UUID.randomUUID();
        UUID nodeId = UUID.randomUUID();
        Node n = node(clusterId, nodeId, "bot");
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(nodeRepo.findByClusterId(clusterId)).thenReturn(List.of(n));
        when(cmd.execute(eq(n), eq("storage.sh scan-fc")))
                .thenReturn(new AgentCommandClient.Result(true, 0, "", "", null));
        when(cmd.execute(eq(n), eq("storage.sh disk-list")))
                .thenReturn(AgentCommandClient.Result.transportError("에이전트 통신 실패"));

        assertThatThrownBy(() -> svc.scan(clusterId, nodeId))
                .isInstanceOf(IllegalStateException.class);
    }
}
