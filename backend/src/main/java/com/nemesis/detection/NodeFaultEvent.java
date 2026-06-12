package com.nemesis.detection;

import java.util.UUID;

/**
 * 감지 엔진이 active 노드를 fault로 판정했을 때 발행하는 이벤트.
 * 트랜잭션 커밋 후 비동기로 FailoverOrchestrator를 트리거한다(감지와 페일오버 분리).
 */
public record NodeFaultEvent(UUID clusterId, UUID nodeId, String hostname, String reason) {}
