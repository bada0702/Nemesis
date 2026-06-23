package com.nemesis.domain.aiops.monitor;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/ai/findings")
@RequiredArgsConstructor
public class AiFindingController {
    private final AiFindingRepository repo;

    @GetMapping
    public List<AiFinding> list(@RequestParam(required = false) String status,
                               @RequestParam(required = false) String category) {
        String st = (status == null || status.isBlank()) ? AiFinding.OPEN : status;
        return (category == null || category.isBlank())
                ? repo.findByStatusOrderByLastSeenAtDesc(st)
                : repo.findByStatusAndCategoryOrderByLastSeenAtDesc(st, category);
    }
}
