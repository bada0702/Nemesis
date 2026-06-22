package com.nemesis.domain.sync;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class SyncServiceTest {

    private final NodeRepository nodeRepo = mock(NodeRepository.class);
    private final SyncJobRepository jobRepo = mock(SyncJobRepository.class);
    private final SyncHistoryRepository historyRepo = mock(SyncHistoryRepository.class);
    private final AgentCommandClient cmd = mock(AgentCommandClient.class);
    private final SyncService svc = new SyncService(nodeRepo, jobRepo, historyRepo, cmd);

    private Node node(String host, Node.Role role, String svcIp, String hbIp) {
        Node n = new Node();
        n.setId(UUID.randomUUID());
        n.setHostname(host); n.setRole(role);
        n.setServiceIp(svcIp); n.setHeartbeatIp(hbIp);
        return n;
    }

    private SyncJob job(boolean mirror) {
        return SyncJob.builder().id(UUID.randomUUID()).clusterId(UUID.randomUUID())
                .name("app").sourcePath("/data/app").destPath("/data/app")
                .mirrorDelete(mirror).scheduleSec(0).enabled(true).build();
    }

    @Test
    void buildSyncCommand_usesHeartbeatIp_andDeleteFlag() {
        SyncJob j = job(true);
        String c = svc.buildSyncCommand(j, "10.0.0.9");
        assertThat(c).isEqualTo("control.sh dir-sync 10.0.0.9 /data/app /data/app --delete");
    }

    @Test
    void buildSyncCommand_noDelete_whenMirrorOff() {
        String c = svc.buildSyncCommand(job(false), "10.0.0.9");
        assertThat(c).isEqualTo("control.sh dir-sync 10.0.0.9 /data/app /data/app");
    }

    @Test
    void parseStats_extractsFilesAndBytes() {
        long[] r = svc.parseStats("blah\nNEMESIS_SYNC {\"files\":12,\"bytes\":3456}\n");
        assertThat(r).containsExactly(12L, 3456L);
    }

    @Test
    void runJob_skips_whenStandbyHasNoHeartbeatIp() {
        SyncJob j = job(false);
        Node active = node("bot", Node.Role.active, "192.168.0.17", "192.168.0.17");
        Node sb     = node("bot-02", Node.Role.standby, "192.168.0.18", null); // hbIp 없음
        when(jobRepo.findById(j.getId())).thenReturn(java.util.Optional.of(j));
        when(nodeRepo.findByClusterId(j.getClusterId())).thenReturn(List.of(active, sb));

        svc.runJob(j.getId(), SyncHistory.Trigger.MANUAL);

        verify(cmd, never()).execute(any(), anyString());
        ArgumentCaptor<SyncHistory> cap = ArgumentCaptor.forClass(SyncHistory.class);
        verify(historyRepo).save(cap.capture());
        assertThat(cap.getValue().getStatus()).isEqualTo(SyncHistory.Status.SKIPPED);
        assertThat(cap.getValue().getMessage()).contains("heartbeat");
    }

    @Test
    void runJob_sendsDirSyncToActive_targetingStandbyHeartbeatIp_onSuccess() {
        SyncJob j = job(false);
        Node active = node("bot", Node.Role.active, "192.168.0.17", "192.168.0.17");
        Node sb     = node("bot-02", Node.Role.standby, "192.168.0.18", "10.0.0.18");
        when(jobRepo.findById(j.getId())).thenReturn(java.util.Optional.of(j));
        when(nodeRepo.findByClusterId(j.getClusterId())).thenReturn(List.of(active, sb));
        when(cmd.execute(eq(active), anyString()))
            .thenReturn(new AgentCommandClient.Result(true, 0,
                "NEMESIS_SYNC {\"files\":3,\"bytes\":100}", "", null));

        svc.runJob(j.getId(), SyncHistory.Trigger.MANUAL);

        ArgumentCaptor<String> cmdCap = ArgumentCaptor.forClass(String.class);
        verify(cmd).execute(eq(active), cmdCap.capture());
        assertThat(cmdCap.getValue()).isEqualTo("control.sh dir-sync 10.0.0.18 /data/app /data/app");
        ArgumentCaptor<SyncHistory> cap = ArgumentCaptor.forClass(SyncHistory.class);
        verify(historyRepo).save(cap.capture());
        assertThat(cap.getValue().getStatus()).isEqualTo(SyncHistory.Status.SUCCESS);
        assertThat(cap.getValue().getFilesCount()).isEqualTo(3);
        assertThat(cap.getValue().getBytesTransferred()).isEqualTo(100);
    }

    @Test
    void runJob_skips_whenNoActiveNode() {
        SyncJob j = job(false);
        Node sb = node("bot-02", Node.Role.standby, "192.168.0.18", "10.0.0.18");
        when(jobRepo.findById(j.getId())).thenReturn(java.util.Optional.of(j));
        when(nodeRepo.findByClusterId(j.getClusterId())).thenReturn(List.of(sb));

        svc.runJob(j.getId(), SyncHistory.Trigger.MANUAL);

        verify(cmd, never()).execute(any(), anyString());
        ArgumentCaptor<SyncHistory> cap = ArgumentCaptor.forClass(SyncHistory.class);
        verify(historyRepo).save(cap.capture());
        assertThat(cap.getValue().getStatus()).isEqualTo(SyncHistory.Status.SKIPPED);
        assertThat(cap.getValue().getMessage()).contains("active");
    }
}
