package com.nemesis.domain.sync;

import com.nemesis.domain.sync.dto.SyncDtos.DirListResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** 노드 파일시스템 탐색(읽기전용, 폴더 브라우저용). */
@RestController
@RequestMapping("/api/clusters/{clusterId}/nodes/{nodeId}")
@RequiredArgsConstructor
public class DirBrowseController {

    private final SyncService syncService;

    @GetMapping("/dirs")
    public ResponseEntity<DirListResponse> dirs(@PathVariable UUID clusterId, @PathVariable UUID nodeId,
                                                @RequestParam(defaultValue = "/") String path) {
        return ResponseEntity.ok(new DirListResponse(path, syncService.listDirs(nodeId, path)));
    }
}
