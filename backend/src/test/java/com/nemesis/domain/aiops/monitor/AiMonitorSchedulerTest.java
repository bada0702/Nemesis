package com.nemesis.domain.aiops.monitor;

import com.nemesis.domain.aiops.AiOperatorProperties;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;

class AiMonitorSchedulerTest {
    @Test void skipsWhenDisabled() {
        AiMonitorService svc = mock(AiMonitorService.class);
        AiOperatorProperties props = new AiOperatorProperties();   // monitor.enabled=false 기본
        new AiMonitorScheduler(svc, props).tick();
        verifyNoInteractions(svc);
    }
    @Test void runsWhenEnabled() {
        AiMonitorService svc = mock(AiMonitorService.class);
        AiOperatorProperties props = new AiOperatorProperties();
        props.getMonitor().setEnabled(true);
        new AiMonitorScheduler(svc, props).tick();
        verify(svc).runScan();
    }
}
