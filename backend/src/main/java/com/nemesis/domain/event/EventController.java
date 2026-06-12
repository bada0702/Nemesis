package com.nemesis.domain.event;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 감지 엔진이 생성한 이벤트 조회 API. 대시보드 알람/타임라인이 소비한다.
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class EventController {

    private final DetectionEventRepository eventRepository;

    @GetMapping("/events")
    public List<DetectionEvent> recent(@RequestParam(defaultValue = "50") int limit) {
        return eventRepository.findAllByOrderByCreatedAtDesc(PageRequest.of(0, clamp(limit)));
    }

    @GetMapping("/clusters/{id}/events")
    public List<DetectionEvent> byCluster(@PathVariable UUID id,
                                          @RequestParam(defaultValue = "50") int limit) {
        return eventRepository.findByClusterGroupIdOrderByCreatedAtDesc(id, PageRequest.of(0, clamp(limit)));
    }

    @GetMapping("/nodes/{nodeId}/events")
    public List<DetectionEvent> byNode(@PathVariable UUID nodeId,
                                       @RequestParam(defaultValue = "50") int limit) {
        return eventRepository.findByNodeIdOrderByCreatedAtDesc(nodeId, PageRequest.of(0, clamp(limit)));
    }

    private int clamp(int limit) {
        return Math.max(1, Math.min(limit, 500));
    }
}
