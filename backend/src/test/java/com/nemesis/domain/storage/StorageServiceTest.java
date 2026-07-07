package com.nemesis.domain.storage;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

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
}
