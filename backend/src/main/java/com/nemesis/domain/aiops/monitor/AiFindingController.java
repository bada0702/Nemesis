package com.nemesis.domain.aiops.monitor;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/ai/findings")
@RequiredArgsConstructor
public class AiFindingController {
    private final AiFindingRepository repo;
    private final AiFindingService service;

    @GetMapping
    public List<AiFinding> list(@RequestParam(required = false) String status,
                               @RequestParam(required = false) String category) {
        String st = (status == null || status.isBlank()) ? AiFinding.OPEN : status;
        return (category == null || category.isBlank())
                ? repo.findByStatusOrderByLastSeenAtDesc(st)
                : repo.findByStatusAndCategoryOrderByLastSeenAtDesc(st, category);
    }

    /** 재분석: 캐시된 에러 텍스트로 LLM 재호출(모델 복구 후 즉시 재시도용). */
    @PostMapping("/{id}/reanalyze")
    public ResponseEntity<AiFinding> reanalyze(@PathVariable UUID id) {
        return ResponseEntity.ok(service.reanalyze(id));
    }

    /** 무시: 목록에서 제외하고 동일 신호 재발 시에도 다시 띄우지 않음. */
    @PostMapping("/{id}/ignore")
    public ResponseEntity<AiFinding> ignore(@PathVariable UUID id) {
        return ResponseEntity.ok(service.ignore(id));
    }

    /** 삭제: 완전 제거. */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
