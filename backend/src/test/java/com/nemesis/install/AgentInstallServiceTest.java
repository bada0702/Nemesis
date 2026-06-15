package com.nemesis.install;

import com.nemesis.domain.install.AgentInstallService;
import com.nemesis.domain.install.dto.TestConnResult;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(MockitoExtension.class)
class AgentInstallServiceTest {

    @Mock NodeRepository nodeRepository;
    @InjectMocks AgentInstallService service;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "agentFilesDir", "/tmp");
        ReflectionTestUtils.setField(service, "managementUrl", "https://localhost:18080");
    }

    @Test
    void heartbeatIp_defaults_to_host_when_blank() {
        assertThat(service.resolveHeartbeatIp("10.0.1.10", "")).isEqualTo("10.0.1.10");
    }

    @Test
    void heartbeatIp_defaults_to_host_when_null() {
        assertThat(service.resolveHeartbeatIp("10.0.1.10", null)).isEqualTo("10.0.1.10");
    }

    @Test
    void heartbeatIp_uses_provided_value_when_not_blank() {
        assertThat(service.resolveHeartbeatIp("10.0.1.10", "192.168.10.5")).isEqualTo("192.168.10.5");
    }

    @Test
    void peerCheck_builder_sets_fields_correctly() {
        TestConnResult.PeerCheck check = TestConnResult.PeerCheck.builder()
                .nodeHostname("node-02")
                .heartbeatIp("10.0.1.11")
                .reachable(false)
                .error("Connection refused")
                .build();
        assertThat(check.getError()).contains("Connection refused");
        assertThat(check.isReachable()).isFalse();
        assertThat(check.getNodeHostname()).isEqualTo("node-02");
    }

    @Test
    void emit_buffers_log_lines_without_emitter() {
        String jobId = "test-job-1";
        service.emit(jobId, "[INFO] 테스트 로그");
        service.emit(jobId, "[INFO] 두 번째 줄");
        // emitter 미등록 → 버퍼에만 쌓임, 예외 없이 완료돼야 함
        // registerEmitter 호출 시 버퍼가 전송된다 (SSE send는 실제 연결 없이는 검증 불가)
    }
}
