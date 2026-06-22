package com.nemesis.domain.sync.dto;

import java.util.List;

public class SyncDtos {
    public record DirListResponse(String path, List<String> dirs) {}
}
