package com.nemesis.domain.failover;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 자동 페일백 설정. application.yml의 nemesis.failback.* 로 조정.
 * 체크 주기는 FailbackService의 @Scheduled placeholder(nemesis.failback.check-interval-ms)로 조정.
 */
@Component
@ConfigurationProperties(prefix = "nemesis.failback")
@Getter
@Setter
public class FailbackProperties {

    /** 자동 페일백 사용 여부 */
    private boolean enabled = true;

    /** 원 노드가 이 시간(초) 동안 연속으로 건강해야 페일백을 실행한다 */
    private int stabilizationSeconds = 120;

    public long stabilizationMillis() {
        return stabilizationSeconds * 1000L;
    }
}
