package com.nemesis.domain.runbook;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class RunbookService {

    private final RunbookRepository runbookRepository;

    private static final List<String> DEFAULT_STEPS = List.of(
        "사전 준비", "대상 확인", "작업 실행", "결과 검증", "완료"
    );

    public List<Map<String, Object>> list() {
        return runbookRepository.findAllByOrderByCreatedAtDesc()
                .stream().map(this::toMap).toList();
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> body) {
        String title  = (String) body.getOrDefault("title", "새 Runbook");
        String type   = (String) body.getOrDefault("type", "MAINTENANCE");
        String target = (String) body.getOrDefault("target", "");

        List<Map<String, Object>> steps = buildSteps(DEFAULT_STEPS);

        Runbook rb = Runbook.builder()
                .title(title)
                .type(type)
                .target(target)
                .status("SCHEDULED")
                .currentStep(0)
                .steps(steps)
                .progress(0)
                .scheduledAt(OffsetDateTime.now().plusHours(1))
                .build();

        return toMap(runbookRepository.save(rb));
    }

    @Transactional
    public Map<String, Object> advanceStep(Long id, int targetStep) {
        Runbook rb = runbookRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Runbook not found: " + id));

        List<Map<String, Object>> steps = new ArrayList<>(rb.getSteps());
        int total = steps.size();
        if (targetStep < 0 || targetStep >= total) {
            throw new IllegalArgumentException("Invalid step index: " + targetStep);
        }

        for (int i = 0; i < total; i++) {
            Map<String, Object> s = new LinkedHashMap<>(steps.get(i));
            s.put("done",   i < targetStep);
            s.put("active", i == targetStep);
            steps.set(i, s);
        }

        rb.setSteps(steps);
        rb.setCurrentStep(targetStep);
        rb.setProgress((int) Math.round((double) targetStep / total * 100));

        if (rb.getStatus().equals("SCHEDULED")) {
            rb.setStatus("IN_PROGRESS");
            rb.setStartedAt(OffsetDateTime.now());
        }

        if (targetStep == total - 1) {
            // 마지막 스텝 완료 처리
            steps = new ArrayList<>(steps);
            Map<String, Object> last = new LinkedHashMap<>(steps.get(total - 1));
            last.put("done", true);
            last.put("active", false);
            steps.set(total - 1, last);
            rb.setSteps(steps);
            rb.setProgress(100);
            rb.setStatus("COMPLETED");
            rb.setCompletedAt(OffsetDateTime.now());
        }

        return toMap(runbookRepository.save(rb));
    }

    private List<Map<String, Object>> buildSteps(List<String> labels) {
        List<Map<String, Object>> steps = new ArrayList<>();
        for (int i = 0; i < labels.size(); i++) {
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("label",  labels.get(i));
            s.put("done",   false);
            s.put("active", i == 0);
            steps.add(s);
        }
        return steps;
    }

    private Map<String, Object> toMap(Runbook rb) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",          rb.getId());
        m.put("title",       rb.getTitle());
        m.put("type",        rb.getType());
        m.put("target",      rb.getTarget());
        m.put("status",      rb.getStatus());
        m.put("currentStep", rb.getCurrentStep());
        m.put("steps",       rb.getSteps());
        m.put("progress",    rb.getProgress());
        m.put("createdBy",   rb.getCreatedBy());
        m.put("startedAt",   rb.getStartedAt());
        m.put("scheduledAt", rb.getScheduledAt());
        m.put("completedAt", rb.getCompletedAt());
        return m;
    }
}
