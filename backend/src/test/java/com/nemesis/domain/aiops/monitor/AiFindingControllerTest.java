package com.nemesis.domain.aiops.monitor;

import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AiFindingControllerTest {
    @Test void listDefaultsToOpen() {
        AiFindingRepository repo = mock(AiFindingRepository.class);
        AiFinding f = AiFinding.builder().id(UUID.randomUUID()).status(AiFinding.OPEN)
                .signalType(AiFinding.DISK_FULL).build();
        when(repo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN)).thenReturn(List.of(f));
        AiFindingController c = new AiFindingController(repo);
        assertThat(c.list(null)).containsExactly(f);
        verify(repo).findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN);
    }
}
