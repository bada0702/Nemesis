package com.nemesis.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AgentRegisterRequest {

    @NotBlank
    private String apiKey;

    @NotBlank
    private String hostname;

    @NotBlank
    private String os;        // AIX | LINUX

    @NotBlank
    private String version;

    private String serviceIp;
    private String heartbeatIp;
}
