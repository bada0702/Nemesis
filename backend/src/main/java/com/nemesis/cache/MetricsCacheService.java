package com.nemesis.cache;

import com.nemesis.dto.MetricsPushRequest;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 노드 실시간 메트릭 In-Memory 캐시.
 * 각 항목에 수신 시각(receivedAt)을 함께 보관하여 신선도(staleness) 판정을 지원한다.
 * → 캐시 존재 여부가 아니라 "최근에 수신됐는지"로 노드 생존을 판단하도록 한다(C-2 대응).
 */
@Service
public class MetricsCacheService {

    /** 캐시 항목: 메트릭 + 수신 시각(epoch millis) */
    public record Entry(MetricsPushRequest metrics, long receivedAt) {}

    private final Map<UUID, Entry> cache = new ConcurrentHashMap<>();

    public void put(UUID nodeId, MetricsPushRequest metrics) {
        cache.put(nodeId, new Entry(metrics, System.currentTimeMillis()));
    }

    /** 신선도와 무관하게 마지막 메트릭을 반환(기존 호출부 호환). */
    public Optional<MetricsPushRequest> get(UUID nodeId) {
        Entry e = cache.get(nodeId);
        return e == null ? Optional.empty() : Optional.of(e.metrics());
    }

    /** maxAgeMillis 이내에 수신된 경우에만 메트릭을 반환. */
    public Optional<MetricsPushRequest> getFresh(UUID nodeId, long maxAgeMillis) {
        Entry e = cache.get(nodeId);
        if (e == null) return Optional.empty();
        return isFresh(e, maxAgeMillis) ? Optional.of(e.metrics()) : Optional.empty();
    }

    /** 노드가 maxAgeMillis 이내에 보고했는지 여부. */
    public boolean isFresh(UUID nodeId, long maxAgeMillis) {
        Entry e = cache.get(nodeId);
        return e != null && isFresh(e, maxAgeMillis);
    }

    /** 마지막 수신 시각(epoch millis). 없으면 empty. */
    public Optional<Long> getReceivedAt(UUID nodeId) {
        Entry e = cache.get(nodeId);
        return e == null ? Optional.empty() : Optional.of(e.receivedAt());
    }

    public void remove(UUID nodeId) {
        cache.remove(nodeId);
    }

    public Map<UUID, MetricsPushRequest> getAll() {
        Map<UUID, MetricsPushRequest> result = new LinkedHashMap<>();
        cache.forEach((id, e) -> result.put(id, e.metrics()));
        return result;
    }

    public Map<UUID, MetricsPushRequest> getForNodes(List<UUID> nodeIds) {
        Map<UUID, MetricsPushRequest> result = new LinkedHashMap<>();
        nodeIds.forEach(id -> {
            Entry e = cache.get(id);
            if (e != null) result.put(id, e.metrics());
        });
        return result;
    }

    private boolean isFresh(Entry e, long maxAgeMillis) {
        return System.currentTimeMillis() - e.receivedAt() <= maxAgeMillis;
    }
}
