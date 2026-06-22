package com.nemesis.domain.sync;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;

/** enabled && scheduleSec>0 작업을 주기 도래 시 실행한다. */
@Slf4j
@Component
@RequiredArgsConstructor
public class SyncScheduler {

    private final SyncJobRepository jobRepo;
    private final SyncService       syncService;

    @Scheduled(fixedDelayString = "${nemesis.sync.tick-ms:30000}")
    public void tick() {
        OffsetDateTime now = OffsetDateTime.now();
        for (SyncJob job : jobRepo.findByEnabledTrueAndScheduleSecGreaterThan(0)) {
            if (isDue(job, now)) {
                try {
                    syncService.runJob(job.getId(), SyncHistory.Trigger.SCHEDULED);
                } catch (Exception e) {
                    log.warn("스케줄 동기화 실패 job={}: {}", job.getId(), e.getMessage());
                }
            }
        }
    }

    boolean isDue(SyncJob job, OffsetDateTime now) {
        if (job.getLastRunAt() == null) return true;
        return job.getLastRunAt().plusSeconds(job.getScheduleSec()).isBefore(now);
    }
}
