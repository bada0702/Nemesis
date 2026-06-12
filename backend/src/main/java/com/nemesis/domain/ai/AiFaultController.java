package com.nemesis.domain.ai;

import com.nemesis.dto.AiFaultAnalysisDto;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiFaultController {

    private final AiFaultService     aiFaultService;
    private final AiDecisionRepository aiDecisionRepository;

    @GetMapping("/decisions/{clusterId}")
    public ResponseEntity<List<AiDecision>> decisions(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(aiDecisionRepository.findByClusterGroupIdOrderByCreatedAtDesc(clusterId));
    }

    @PostMapping("/analyze/{nodeId}")
    public ResponseEntity<AiFaultAnalysisDto> analyze(@PathVariable UUID nodeId) {
        AiFaultAnalysis result = aiFaultService.analyzeManual(nodeId);
        return ResponseEntity.ok(toDto(result));
    }

    @GetMapping("/analysis/{nodeId}")
    public ResponseEntity<AiFaultAnalysisDto> getLatest(@PathVariable UUID nodeId) {
        return aiFaultService.getLatest(nodeId)
                .map(a -> ResponseEntity.ok(toDto(a)))
                .orElse(ResponseEntity.notFound().build());
    }

    private AiFaultAnalysisDto toDto(AiFaultAnalysis a) {
        return new AiFaultAnalysisDto(
            a.getId(),
            a.getNode().getId().toString(),
            a.getRootCause(),
            a.getFixCommands(),
            a.getTriggerType(),
            a.getStatus(),
            a.getCreatedAt()
        );
    }
}
