package com.nemesis.domain.install.dto;

import lombok.Data;
import java.util.UUID;

@Data
public class TestConnRequest {
    private String host;
    private int    sshPort;
    private String sshUser;
    private String sshPassword;
    private String heartbeatIp;
    private UUID   clusterId;
}
