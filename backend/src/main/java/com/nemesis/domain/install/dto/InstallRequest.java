package com.nemesis.domain.install.dto;

import lombok.Data;
import java.util.UUID;

@Data
public class InstallRequest {
    private String jobId;
    private String host;
    private int    sshPort;
    private String sshUser;
    private String sshPassword;
    private String heartbeatIp;
    private UUID   clusterId;
    private String role;
    private String apiKey;
    private String managementUrl;
}
