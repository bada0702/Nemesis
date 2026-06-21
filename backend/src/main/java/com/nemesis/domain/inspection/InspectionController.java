package com.nemesis.domain.inspection;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 점검 관리 CRUD. */
@RestController
@RequestMapping("/api/inspection")
@RequiredArgsConstructor
public class InspectionController {

    private final InspectionRepository repository;

    @GetMapping
    public ResponseEntity<Map<String, Object>> list() {
        List<Map<String, Object>> items = repository.findAllByOrderByCreatedAtDesc()
                .stream().map(this::toMap).toList();
        return ResponseEntity.ok(Map.of("items", items));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        String error = validate(body);
        if (error != null) return ResponseEntity.badRequest().body(Map.of("error", error));
        Inspection saved = repository.save(fromBody(new Inspection(), body));
        return ResponseEntity.status(HttpStatus.CREATED).body(toMap(saved));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable UUID id,
                                                      @RequestBody Map<String, Object> body) {
        Inspection insp = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Inspection not found: " + id));
        String error = validate(body);
        if (error != null) return ResponseEntity.badRequest().body(Map.of("error", error));
        return ResponseEntity.ok(toMap(repository.save(fromBody(insp, body))));
    }

    /** 필수 입력 검증. 통과 시 null, 실패 시 problem+fix 메시지 반환(HTTP 400). */
    private String validate(Map<String, Object> body) {
        Object title = body.get("title");
        if (title == null || title.toString().isBlank()) {
            return "점검 제목(title)은 필수입니다. 요청 본문에 비어 있지 않은 title을 포함하세요.";
        }
        return null;
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    private Inspection fromBody(Inspection insp, Map<String, Object> body) {
        if (body.get("title")     != null) insp.setTitle((String) body.get("title"));
        if (body.get("target")    != null) insp.setTarget((String) body.get("target"));
        if (body.get("type")      != null) insp.setType((String) body.get("type"));
        if (body.get("status")    != null) insp.setStatus((String) body.get("status"));
        if (body.get("inspector") != null) insp.setInspector((String) body.get("inspector"));
        if (body.get("notes")     != null) insp.setNotes((String) body.get("notes"));
        String date = (String) body.get("date");
        insp.setDate(date != null && !date.isBlank() ? LocalDate.parse(date) : null);
        if (body.containsKey("startTime")) insp.setStartTime(parseTime((String) body.get("startTime")));
        if (body.containsKey("endTime"))   insp.setEndTime(parseTime((String) body.get("endTime")));
        return insp;
    }

    /** ISO 오프셋 또는 datetime-local(무오프셋) 문자열을 파싱한다. */
    private OffsetDateTime parseTime(String s) {
        if (s == null || s.isBlank()) return null;
        try { return OffsetDateTime.parse(s); }
        catch (Exception e) {
            return java.time.LocalDateTime.parse(s).atOffset(OffsetDateTime.now().getOffset());
        }
    }

    /** 시작~종료 시각 기준 경과 비율(%). 시각 미지정 시 상태 기반 폴백, COMPLETED는 100. */
    private int progress(Inspection i) {
        if ("COMPLETED".equals(i.getStatus())) return 100;
        OffsetDateTime s = i.getStartTime(), e = i.getEndTime();
        if (s == null || e == null) return "IN_PROGRESS".equals(i.getStatus()) ? 50 : 0;
        OffsetDateTime now = OffsetDateTime.now();
        if (now.isBefore(s)) return 0;
        if (!now.isBefore(e)) return 100;
        long total = java.time.Duration.between(s, e).toSeconds();
        if (total <= 0) return 100;
        long elapsed = java.time.Duration.between(s, now).toSeconds();
        return (int) Math.max(0, Math.min(100, (elapsed * 100) / total));
    }

    private Map<String, Object> toMap(Inspection i) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",        i.getId());
        m.put("title",     i.getTitle());
        m.put("target",    i.getTarget());
        m.put("type",      i.getType());
        m.put("status",    i.getStatus());
        m.put("date",      i.getDate() != null ? i.getDate().toString() : "");
        m.put("inspector", i.getInspector());
        m.put("notes",     i.getNotes());
        m.put("startTime", i.getStartTime());
        m.put("endTime",   i.getEndTime());
        m.put("progress",  progress(i));
        m.put("createdAt", i.getCreatedAt());
        return m;
    }
}
