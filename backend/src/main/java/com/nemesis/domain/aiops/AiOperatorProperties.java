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

    /** SP3: 능동 모니터링 설정. nemesis.aiops.monitor.* */
    private final Monitor monitor = new Monitor();
    public Monitor getMonitor() { return monitor; }

    @Getter @Setter
    public static class Monitor {
        private boolean enabled = false;
        private long intervalMs = 300_000L;
        private int diskThreshold = 90;
        private int memThreshold = 90;
        private int cpuThreshold = 90;
        private int cpuSustainedCycles = 3;
        private int criticalBandOffset = 5;
        private int errorPatternCount = 3;
        private long eventSpikeWindowMs = 600_000L;
        private int eventSpikeCount = 5;

        /** SP5: 추세 기반 장애 예측 */
        private boolean predictEnabled = true;
        private int     predictWindowSize = 6;        // 노드별 롤링 샘플 보관 개수
        private int     predictMinSamples = 4;        // 예측에 필요한 최소 샘플 수
        private double  predictTargetPercent = 95.0;  // 도달 시 위험으로 보는 목표치(%)
        private long    predictHorizonMinutes = 360;  // 이 이내 도달 예상 시 신호(분)
        private long    predictHighEtaMinutes = 120;  // ETA 이하면 HIGH
        private long    predictCriticalEtaMinutes = 30; // ETA 이하면 CRITICAL
    }
}
