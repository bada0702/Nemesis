package com.nemesis.domain.ha;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;

import java.util.List;

/**
 * 클러스터 메타(VIP·역할·피어)의 최신 변경 시각을 에이전트가 비교 가능한
 * 버전(epoch초)으로 환산한다. /api/agent/meta와 /api/ha/metadata-sync가
 * 동일한 계산을 공유해, 에이전트가 보고한 appliedMetaVersion과 직접 비교할 수 있게 한다.
 */
public final class MetaVersion {
    private MetaVersion() {}

    public static long of(Cluster cluster, List<Node> nodes) {
        long v = cluster.getUpdatedAt() != null ? cluster.getUpdatedAt().toEpochSecond() : 0;
        for (Node n : nodes) {
            if (n.getUpdatedAt() != null) v = Math.max(v, n.getUpdatedAt().toEpochSecond());
        }
        return v;
    }
}
