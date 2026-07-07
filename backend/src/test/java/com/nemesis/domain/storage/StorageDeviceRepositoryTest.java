package com.nemesis.domain.storage;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("test")
class StorageDeviceRepositoryTest {

    @Autowired StorageDeviceRepository repo;
    @Autowired ClusterRepository       clusterRepo;

    private Cluster cluster(String name) {
        return clusterRepo.save(Cluster.builder().name(name).build());
    }

    @Test
    void saves_and_finds_byClusterId() {
        Cluster c = cluster("storage-test-1");
        repo.save(StorageDevice.builder().cluster(c).wwid("360014056b1a3fbe4c1b4f0b9a5e2d1c").build());

        assertThat(repo.findByClusterId(c.getId())).hasSize(1);
    }

    @Test
    void findByClusterIdAndWwid_matchesExactWwid_onlyWithinCluster() {
        Cluster c1 = cluster("storage-test-2");
        Cluster c2 = cluster("storage-test-3");
        repo.save(StorageDevice.builder().cluster(c1).wwid("abc123").build());

        assertThat(repo.findByClusterIdAndWwid(c1.getId(), "abc123")).isPresent();
        assertThat(repo.findByClusterIdAndWwid(c2.getId(), "abc123")).isEmpty();
        assertThat(repo.findByClusterIdAndWwid(c1.getId(), "zzz")).isEmpty();
    }
}
