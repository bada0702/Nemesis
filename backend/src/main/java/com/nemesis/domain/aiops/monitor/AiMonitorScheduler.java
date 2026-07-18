package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** SP3: 주기적 능동 스캔 트리거. enabled=false면 즉시 return(점진 활성). */
@Slf4j
@Component
public class AiMonitorScheduler {
    private final AiMonitorService svc;
    private final AiOperatorProperties props;

    public AiMonitorScheduler(AiMonitorService svc, AiOperatorProperties props) {
        this.svc = svc; this.props = props;
    }

    @Scheduled(fixedDelayString = "${nemesis.aiops.monitor.interval-ms:300000}")
    public void tick() {
        if (!props.getMonitor().isEnabled() && !props.getMonitor().isPredictEnabled()) return;
        try { svc.runScan(); }
        catch (Exception e) { log.warn("능동 스캔 실패: {}", e.getMessage()); }
    }
}
