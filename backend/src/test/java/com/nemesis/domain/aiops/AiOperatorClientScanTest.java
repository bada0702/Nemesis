package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanResponse;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AiOperatorClientScanTest {
    @Test void scanReturnsNullOnError() {
        RestTemplate rt = mock(RestTemplate.class);
        AiOperatorProperties props = new AiOperatorProperties();
        when(rt.postForObject(anyString(), any(), eq(ScanResponse.class)))
                .thenThrow(new RuntimeException("down"));
        AiOperatorClient client = new AiOperatorClient(rt, props);
        assertThat(client.scan(Map.of(), Map.of())).isNull();   // 폴백
    }
    @Test void scanPostsToScanEndpoint() {
        RestTemplate rt = mock(RestTemplate.class);
        AiOperatorProperties props = new AiOperatorProperties();
        ScanResponse resp = new ScanResponse(java.util.List.of());
        when(rt.postForObject(contains("/ai/scan"), any(), eq(ScanResponse.class))).thenReturn(resp);
        AiOperatorClient client = new AiOperatorClient(rt, props);
        assertThat(client.scan(Map.of(), Map.of())).isSameAs(resp);
    }
}
