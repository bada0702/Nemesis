package com.nemesis.domain.install.dto;

import lombok.Builder;
import lombok.Data;
import java.util.List;

@Data
@Builder
public class TestConnResult {
    private boolean sshOk;
    private String  sshError;

    private boolean port17001Ok;
    private String  port17001Error;

    private List<PeerCheck> peerChecks;

    @Data
    @Builder
    public static class PeerCheck {
        private String  nodeHostname;
        private String  heartbeatIp;
        private boolean reachable;
        private String  error;
    }
}
