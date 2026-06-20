package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** aibot 사이드카 호출. 실패는 null 반환(상위에서 폴백). */
@Slf4j
@Component
public class AiOperatorClient {

    private final RestTemplate rt;
    private final AiOperatorProperties props;

    public AiOperatorClient(RestTemplate restTemplate, AiOperatorProperties props) {
        this.rt = restTemplate; this.props = props;
    }

    private HttpHeaders headers() {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.setBearerAuth(props.getToken());
        return h;
    }

    public boolean health() {
        try {
            ResponseEntity<Map> r = rt.getForEntity(props.getBaseUrl() + "/health", Map.class);
            return r.getStatusCode().is2xxSuccessful();
        } catch (Exception e) { return false; }
    }

    public InvestigateResponse investigate(Map<String, Object> ctx, Map<String, Object> sshTarget) {
        try {
            HttpEntity<Map<String, Object>> req =
                    new HttpEntity<>(Map.of("context", ctx, "sshTarget", sshTarget), headers());
            return rt.postForObject(props.getBaseUrl() + "/ai/investigate", req, InvestigateResponse.class);
        } catch (Exception e) {
            log.warn("aibot investigate 실패(폴백): {}", e.getMessage());
            return null;
        }
    }

    public String chat(String message) {
        try {
            HttpEntity<Map<String, Object>> req =
                    new HttpEntity<>(Map.of("message", message), headers());
            Map<?, ?> r = rt.postForObject(props.getBaseUrl() + "/ai/chat", req, Map.class);
            return r != null ? String.valueOf(r.get("reply")) : null;
        } catch (Exception e) {
            log.warn("aibot chat 실패(폴백): {}", e.getMessage());
            return null;
        }
    }

    public ExecuteResponse execute(UUID proposalId, List<Action> actions, Map<String, Object> sshTarget) {
        try {
            HttpEntity<Map<String, Object>> req = new HttpEntity<>(Map.of(
                    "proposalId", proposalId.toString(), "actions", actions, "sshTarget", sshTarget), headers());
            return rt.postForObject(props.getBaseUrl() + "/ai/execute", req, ExecuteResponse.class);
        } catch (Exception e) {
            log.warn("aibot execute 실패: {}", e.getMessage());
            return null;
        }
    }
}
