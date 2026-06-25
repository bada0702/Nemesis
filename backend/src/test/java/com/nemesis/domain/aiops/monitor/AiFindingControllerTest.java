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
        AiFindingController c = new AiFindingController(repo, mock(AiFindingService.class));
        assertThat(c.list(null, null)).containsExactly(f);
        verify(repo).findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN);
    }

    @Test void listFiltersByCategoryWhenProvided() {
        AiFindingRepository repo = mock(AiFindingRepository.class);
        AiFindingController c = new AiFindingController(repo, mock(AiFindingService.class));
        c.list("OPEN", "PREDICTIVE");
        verify(repo).findByStatusAndCategoryOrderByLastSeenAtDesc("OPEN", "PREDICTIVE");
    }

    @Test void listIgnoresBlankCategory() {
        AiFindingRepository repo = mock(AiFindingRepository.class);
        AiFindingController c = new AiFindingController(repo, mock(AiFindingService.class));
        c.list("OPEN", null);
        verify(repo).findByStatusOrderByLastSeenAtDesc("OPEN");
    }
}
