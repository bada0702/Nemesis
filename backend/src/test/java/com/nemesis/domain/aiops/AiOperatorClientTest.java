package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class AiOperatorClientTest {

    private AiOperatorProperties props() {
        AiOperatorProperties p = new AiOperatorProperties();
        p.setBaseUrl("http://localhost:18900");
        p.setToken("t"); p.setTimeoutSeconds(5);
        return p;
    }

    @Test
    void investigate_parses_plan() {
        RestTemplate rt = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.createServer(rt);
        server.expect(requestTo("http://localhost:18900/ai/investigate"))
              .andRespond(withSuccess("""
                {"diagnosis":"d","rootCause":"r",
                 "proposedActions":[{"description":"x","command":"c","target":"n","riskLevel":"LOW"}],
                 "confidence":0.9}""", MediaType.APPLICATION_JSON));
        AiOperatorClient client = new AiOperatorClient(rt, props());
        AiOpsDtos.InvestigateResponse resp = client.investigate(Map.of(), Map.of());
        assertThat(resp.confidence()).isEqualTo(0.9);
        assertThat(resp.proposedActions().get(0).command()).isEqualTo("c");
    }

    @Test
    void investigate_returns_null_on_error() {
        RestTemplate rt = new RestTemplate();
        MockRestServiceServer server = MockRestServiceServer.createServer(rt);
        server.expect(requestTo("http://localhost:18900/ai/investigate"))
              .andRespond(req -> { throw new RuntimeException("aibot down"); });
        AiOperatorClient client = new AiOperatorClient(rt, props());
        assertThat(client.investigate(Map.of(), Map.of())).isNull();   // 폴백 신호
    }
}
