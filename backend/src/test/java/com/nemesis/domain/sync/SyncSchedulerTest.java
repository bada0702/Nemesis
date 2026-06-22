package com.nemesis.domain.sync;

import org.junit.jupiter.api.Test;
import java.time.OffsetDateTime;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class SyncSchedulerTest {

    private final SyncScheduler s = new SyncScheduler(mock(SyncJobRepository.class), mock(SyncService.class));

    private SyncJob job(int sec, OffsetDateTime lastRun) {
        return SyncJob.builder().scheduleSec(sec).lastRunAt(lastRun).enabled(true).build();
    }

    @Test
    void due_whenNeverRun() {
        assertThat(s.isDue(job(60, null), OffsetDateTime.now())).isTrue();
    }

    @Test
    void due_whenIntervalElapsed() {
        OffsetDateTime now = OffsetDateTime.now();
        assertThat(s.isDue(job(60, now.minusSeconds(61)), now)).isTrue();
    }

    @Test
    void notDue_withinInterval() {
        OffsetDateTime now = OffsetDateTime.now();
        assertThat(s.isDue(job(60, now.minusSeconds(10)), now)).isFalse();
    }
}
