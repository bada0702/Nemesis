package com.nemesis.domain.sync;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class SshProvisionServiceTest {

    private final NodeRepository nodeRepo = mock(NodeRepository.class);
    private final AgentCommandClient cmd = mock(AgentCommandClient.class);
    private final SshProvisionService svc = new SshProvisionService(nodeRepo, cmd);

    private Node node(String host) {
        Node n = new Node(); n.setId(UUID.randomUUID()); n.setHostname(host);
        n.setRole(Node.Role.active); n.setServiceIp("1.2.3." + host.length());
        return n;
    }

    @Test
    void provision_keygensEachNode_andAuthorizesPeers() {
        UUID cid = UUID.randomUUID();
        Node a = node("aa"), b = node("bbb");
        when(nodeRepo.findByClusterId(cid)).thenReturn(List.of(a, b));
        // keygen 호출은 stdout에 pubkey 반환
        when(cmd.execute(eq(a), eq("control.sh ssh-keygen-nemesis")))
            .thenReturn(new AgentCommandClient.Result(true, 0, "ssh-ed25519 KEYA host-aa", "", null));
        when(cmd.execute(eq(b), eq("control.sh ssh-keygen-nemesis")))
            .thenReturn(new AgentCommandClient.Result(true, 0, "ssh-ed25519 KEYB host-bbb", "", null));
        when(cmd.execute(any(), startsWith("control.sh ssh-authorize")))
            .thenReturn(new AgentCommandClient.Result(true, 0, "authorized", "", null));

        Map<String,Object> r = svc.provision(cid);

        // a는 b의 키를 authorize, b는 a의 키를 authorize
        verify(cmd).execute(eq(a), eq("control.sh ssh-authorize \"ssh-ed25519 KEYB host-bbb\""));
        verify(cmd).execute(eq(b), eq("control.sh ssh-authorize \"ssh-ed25519 KEYA host-aa\""));
        @SuppressWarnings("unchecked")
        List<String> prov = (List<String>) r.get("provisioned");
        assertThat(prov).containsExactlyInAnyOrder("aa", "bbb");
    }
}
