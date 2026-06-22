package com.nemesis.domain.aiops;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class AiOperatorPropertiesTest {
    @Test
    void monitorDefaults() {
        AiOperatorProperties.Monitor m = new AiOperatorProperties().getMonitor();
        assertThat(m.isEnabled()).isFalse();
        assertThat(m.getIntervalMs()).isEqualTo(300_000L);
        assertThat(m.getDiskThreshold()).isEqualTo(90);
        assertThat(m.getCpuSustainedCycles()).isEqualTo(3);
        assertThat(m.getCriticalBandOffset()).isEqualTo(5);
    }
}
