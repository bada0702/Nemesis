package com.nemesis.detection;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Phase A 감지 엔진 임계값/주기 설정. application.yml의 nemesis.detection.* 로 조정.
 */
@Component
@ConfigurationProperties(prefix = "nemesis.detection")
@Getter
@Setter
public class DetectionProperties {

    /** 에이전트 메트릭 Push 기대 주기(초). 노드 staleness 계산 기준. */
    private int pushIntervalSeconds = 3;

    /** Fault 판정 시 추가 유예(초). 일시적 지연으로 인한 오탐 방지. */
    private int staleGraceSeconds = 2;

    /** 메트릭이 "신선"하다고 볼 수 있는 최대 경과 시간(초). RUNNING/STOPPED 표시 기준. */
    private int metricsFreshSeconds = 10;

    /** CPU 사용률 경고 임계(%) */
    private double cpuThreshold = 85.0;

    /** 메모리 사용률 경고 임계(%) */
    private double memThreshold = 85.0;

    /** 디스크 사용률 경고 임계(%) */
    private double diskThreshold = 90.0;

    /** active 노드의 haManaged 서비스 프로세스 다운 시 자동 페일오버 여부 */
    private boolean processFailoverEnabled = true;

    /** 프로세스 소실이 이 시간(초) 이상 지속돼야 페일오버 트리거(일시 재시작 오탐 방지) */
    private int processFailoverGraceSeconds = 10;

    /**
     * 클러스터의 heartbeat_fail_threshold(연속 미응답 횟수)와 push 주기로
     * Fault 판정까지의 staleness 임계(ms)를 계산한다.
     */
    public long faultTimeoutMillis(int heartbeatFailThreshold) {
        int misses = heartbeatFailThreshold > 0 ? heartbeatFailThreshold : 3;
        return ((long) pushIntervalSeconds * misses + staleGraceSeconds) * 1000L;
    }

    public long metricsFreshMillis() {
        return (long) metricsFreshSeconds * 1000L;
    }
}
