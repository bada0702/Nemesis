package com.nemesis.domain.cluster;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ClusterService {

    private final ClusterRepository clusterRepository;

    @Value("${nemesis.max-cluster-groups:10}")
    private int maxClusterGroups;

    @Transactional
    public Cluster create(Map<String, Object> body) {
        if (clusterRepository.countBy() >= maxClusterGroups) {
            throw new IllegalStateException(
                    "최대 클러스터 그룹 수(" + maxClusterGroups + "개)를 초과했습니다.");
        }

        Cluster cluster = Cluster.builder()
                .name((String) body.get("name"))
                .vip((String) body.get("vip"))
                .description((String) body.get("description"))
                .build();
        return clusterRepository.save(cluster);
    }

    @Transactional(readOnly = true)
    public List<Cluster> findAll() {
        return clusterRepository.findAll();
    }

    @Transactional(readOnly = true)
    public Cluster findById(UUID id) {
        return clusterRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + id));
    }

    @Transactional
    public Cluster update(UUID id, Map<String, Object> body) {
        Cluster c = findById(id);
        if (body.get("name")        != null) c.setName((String) body.get("name"));
        if (body.get("vip")         != null) c.setVip((String) body.get("vip"));
        if (body.get("description") != null) c.setDescription((String) body.get("description"));
        return clusterRepository.save(c);
    }

    @Transactional
    public void delete(UUID id) {
        if (!clusterRepository.existsById(id))
            throw new IllegalArgumentException("Cluster not found: " + id);
        clusterRepository.deleteById(id);
    }
}
