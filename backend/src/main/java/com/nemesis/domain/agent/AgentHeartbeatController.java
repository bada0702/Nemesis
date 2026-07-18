package com.nemesis.domain.agent;

import com.nemesis.domain.ha.HeartbeatCache;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * 에이전트가 노드 간(피어) 하트비트 결과를 보고하는 채널.
 * 에이전트는 17000 포트로 서로 핑한 결과를 주기적으로 이 엔드포인트에 올리고,
 * 관리 UI의 하트비트 매트릭스가 이 데이터를 사용한다.
 */
@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class AgentHeartbeatController {

    private final AgentService   agentService;
    private final HeartbeatCache heartbeatCache;

    @PostMapping("/heartbeat")
    public ResponseEntity<Void> report(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @RequestBody Map<String, Object> body) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401).build();
        }
        UUID fromNodeId = agentService.resolveNodeId(authHeader.substring(7));

        Map<UUID, HeartbeatCache.Entry> peers = new HashMap<>();
        Object raw = body.get("peers");
        if (raw instanceof List<?> list) {
            long now = System.currentTimeMillis();
            for (Object o : list) {
                if (!(o instanceof Map<?, ?> p)) continue;
                Object toId = p.get("toNodeId");
                if (toId == null) continue;
                try {
                    UUID toNodeId = UUID.fromString(toId.toString());
                    Object statusObj = p.get("status");
                    String status = statusObj != null ? statusObj.toString() : "DEAD";
                    Integer latency = p.get("latencyMs") instanceof Number n ? n.intValue() : null;
                    peers.put(toNodeId, new HeartbeatCache.Entry(status, latency, now));
                } catch (IllegalArgumentException ignore) {
                    // 잘못된 UUID는 건너뛴다
                }
            }
        }
        heartbeatCache.report(fromNodeId, peers);

        // 에이전트가 실제로 적용 완료한 메타데이터 버전(있으면) — 메타데이터 동기화 판정용.
        if (body.get("appliedMetaVersion") instanceof Number av) {
            heartbeatCache.reportVersion(fromNodeId, av.longValue());
        }
        return ResponseEntity.ok().build();
    }
}
