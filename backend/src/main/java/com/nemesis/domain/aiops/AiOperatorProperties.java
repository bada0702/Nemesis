package com.nemesis.domain.aiops;

import lombok.Getter; import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** SP1: aibot 사이드카 연동 설정. application.yml nemesis.aiops.* */
@Component
@ConfigurationProperties(prefix = "nemesis.aiops")
@Getter @Setter
public class AiOperatorProperties {
    private boolean enabled = false;
    private String  baseUrl = "http://localhost:18900";
    private String  token = "";
    private String  sshUser = "root";
    private int     timeoutSeconds = 120;
    private int     proposalTtlMinutes = 30;
}
