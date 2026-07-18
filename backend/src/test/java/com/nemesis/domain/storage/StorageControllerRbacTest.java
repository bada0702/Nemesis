package com.nemesis.domain.storage;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.user.User;
import com.nemesis.security.TokenService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.test.context.ActiveProfiles;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class StorageControllerRbacTest {

    @LocalServerPort int port;
    @Autowired TestRestTemplate http;
    @Autowired TokenService tokenService;
    @Autowired ClusterRepository clusterRepository;
    @Autowired StorageDeviceRepository storageDeviceRepository;

    private HttpEntity<Void> as(String username, User.Role role) {
        String token = tokenService.issue(User.builder().username(username).role(role).build());
        HttpHeaders h = new HttpHeaders(); h.setBearerAuth(token);
        return new HttpEntity<>(h);
    }

    @Test
    void viewer_cannot_triggerScan() {
        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/clusters/" + UUID.randomUUID()
                        + "/storage/scan?nodeId=" + UUID.randomUUID(),
                HttpMethod.POST, as("v", User.Role.viewer), String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void viewer_cannot_batchRegister() {
        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/clusters/" + UUID.randomUUID() + "/storage/devices/batch",
                HttpMethod.POST, as("v", User.Role.viewer), String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void viewer_can_listDevices() {
        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/clusters/" + UUID.randomUUID() + "/storage/devices",
                HttpMethod.GET, as("v", User.Role.viewer), String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void listDevices_withRegisteredDevice_serializesWithoutError() {
        Cluster cluster = clusterRepository.save(Cluster.builder().name("rbac-list-test").build());
        storageDeviceRepository.save(StorageDevice.builder()
                .cluster(cluster).wwid("0123456789abcdef0123456789abcdef").pathCount(1).build());

        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/clusters/" + cluster.getId() + "/storage/devices",
                HttpMethod.GET, as("v", User.Role.viewer), String.class);

        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(r.getBody()).contains("0123456789abcdef0123456789abcdef");
    }
}
