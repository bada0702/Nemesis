package com.nemesis.domain.ha;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 에이전트가 보고한 노드 간(피어) 하트비트 결과의 인메모리 저장소.
 * 하트비트는 휘발성이라 DB에 적재하지 않고 최신값만 유지한다.
 * 보고가 없으면 HaStatusController가 서버의 메트릭 신선도로 폴백한다.
 */
@Component
public class HeartbeatCache {

    public record Entry(String status, Integer latencyMs, long receivedAt) {}

    // fromNodeId → (toNodeId → Entry)
    private final Map<UUID, Map<UUID, Entry>> store = new ConcurrentHashMap<>();

    /** 한 노드가 보고한 피어 하트비트 결과로 교체한다. */
    public void report(UUID fromNodeId, Map<UUID, Entry> peers) {
        store.put(fromNodeId, new ConcurrentHashMap<>(peers));
    }

    /** from→to 하트비트. 보고가 없거나 오래되면 null. */
    public Entry get(UUID fromNodeId, UUID toNodeId, long maxAgeMillis) {
        Map<UUID, Entry> peers = store.get(fromNodeId);
        if (peers == null) return null;
        Entry e = peers.get(toNodeId);
        if (e == null) return null;
        if (System.currentTimeMillis() - e.receivedAt() > maxAgeMillis) return null;
        return e;
    }
}
