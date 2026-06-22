package com.nemesis.domain.aiops.monitor;

import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

class AiFindingTest {
    @Test
    void prePersistSetsDefaults() {
        AiFinding f = AiFinding.builder()
                .nodeId(UUID.randomUUID()).signalType(AiFinding.DISK_FULL)
                .severity(AiFinding.WARN).summary("디스크 91%").build();
        f.prePersist();
        assertThat(f.getId()).isNotNull();
        assertThat(f.getStatus()).isEqualTo(AiFinding.OPEN);
        assertThat(f.getCreatedAt()).isNotNull();
        assertThat(f.getFirstSeenAt()).isNotNull();
        assertThat(f.getLastSeenAt()).isNotNull();
    }
    @Test
    void fingerprintIsNodeAndSignal() {
        UUID n = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
        assertThat(AiFinding.fingerprint(n, AiFinding.MEM_HIGH)).isEqualTo(n + ":MEM_HIGH");
    }
}
