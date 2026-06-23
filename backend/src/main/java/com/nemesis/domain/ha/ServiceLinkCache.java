package com.nemesis.domain.ha;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 관리서버 → 노드 serviceIp(real IP) 제어포트 도달성 측정 결과의 인메모리 캐시.
 * ServiceLinkProber가 주기적으로 갱신하고, HaStatusController가 읽는다.
 */
@Component
public class ServiceLinkCache {

    public record Entry(String status, Integer latencyMs, long receivedAt) {}

    private final Map<UUID, Entry> store = new ConcurrentHashMap<>();

    public void put(UUID nodeId, Entry e) {
        store.put(nodeId, e);
    }

    /** 노드의 real IP 링크 상태. 없거나 오래되면 null. */
    public Entry get(UUID nodeId, long maxAgeMillis) {
        Entry e = store.get(nodeId);
        if (e == null) return null;
        if (System.currentTimeMillis() - e.receivedAt() > maxAgeMillis) return null;
        return e;
    }
}
