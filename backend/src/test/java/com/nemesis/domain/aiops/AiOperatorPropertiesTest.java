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

    @Test void monitorPredictDefaults() {
        AiOperatorProperties.Monitor m = new AiOperatorProperties().getMonitor();
        assertThat(m.isPredictEnabled()).isTrue();
        assertThat(m.getPredictWindowSize()).isEqualTo(6);
        assertThat(m.getPredictMinSamples()).isEqualTo(4);
        assertThat(m.getPredictTargetPercent()).isEqualTo(95.0);
        assertThat(m.getPredictHorizonMinutes()).isEqualTo(360L);
        assertThat(m.getPredictHighEtaMinutes()).isEqualTo(120L);
        assertThat(m.getPredictCriticalEtaMinutes()).isEqualTo(30L);
    }
}
