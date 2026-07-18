package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
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

    public String chat(String message) { return chat(message, null); }

    /** userToken: 채팅 요청자(operator)의 토큰. 페일오버 등 제어 도구가 RBAC를 지키며 호출하도록 전달. */
    public String chat(String message, String userToken) {
        try {
            Map<String, Object> bodyMap = new java.util.HashMap<>();
            bodyMap.put("message", message);
            if (userToken != null && !userToken.isBlank()) bodyMap.put("userToken", userToken);
            HttpEntity<Map<String, Object>> req = new HttpEntity<>(bodyMap, headers());
            Map<?, ?> r = rt.postForObject(props.getBaseUrl() + "/ai/chat", req, Map.class);
            return r != null ? String.valueOf(r.get("reply")) : null;
        } catch (Exception e) {
            log.warn("aibot chat 실패(폴백): {}", e.getMessage());
            return null;
        }
    }

    public ScanResponse scan(Map<String, Object> ctx, Map<String, Object> sshTarget) {
        try {
            HttpEntity<Map<String, Object>> req =
                    new HttpEntity<>(Map.of("context", ctx, "sshTarget", sshTarget), headers());
            return rt.postForObject(props.getBaseUrl() + "/ai/scan", req, ScanResponse.class);
        } catch (Exception e) {
            log.warn("aibot scan 실패(폴백): {}", e.getMessage());
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

    // ── 지식 파일 편집 프록시(시스템 설정 UI 용) ─────────────────────────────
    // 폴백 없이 예외를 전파한다: 사이드카의 4xx(경로/검증 오류) 메시지를 컨트롤러가
    // 그대로 사용자에게 돌려줘야 하므로 여기서 null 로 삼키지 않는다.
    //
    // path 쿼리 파라미터는 반드시 URI 객체로 만들어 '한 번만' 인코딩한다. 문자열 URL 을
    // rt.exchange 에 넘기면 RestTemplate 이 템플릿으로 보고 재인코딩해 '/'→%2F→%252F 로
    // 이중 인코딩되어 사이드카가 400 을 낸다(경로 형식 위반). UriComponentsBuilder.encode()
    // 로 슬래시를 %2F 로 한 번만 인코딩한 URI 를 넘긴다.

    private URI fileUri(String path) {
        return UriComponentsBuilder.fromHttpUrl(props.getBaseUrl() + "/ai/knowledge/file")
                .queryParam("path", path).build().encode().toUri();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> knowledgeList() {
        return rt.exchange(props.getBaseUrl() + "/ai/knowledge/files",
                HttpMethod.GET, new HttpEntity<>(headers()), Map.class).getBody();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> knowledgeRead(String path) {
        return rt.exchange(fileUri(path), HttpMethod.GET,
                new HttpEntity<>(headers()), Map.class).getBody();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> knowledgeValidate(String content) {
        HttpEntity<Map<String, Object>> req = new HttpEntity<>(
                Map.of("content", content == null ? "" : content), headers());
        return rt.postForObject(props.getBaseUrl() + "/ai/knowledge/validate", req, Map.class);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> knowledgeSave(String path, String content) {
        HttpEntity<Map<String, Object>> req = new HttpEntity<>(
                Map.of("path", path, "content", content == null ? "" : content), headers());
        return rt.postForObject(props.getBaseUrl() + "/ai/knowledge/file", req, Map.class);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> knowledgeDelete(String path) {
        return rt.exchange(fileUri(path), HttpMethod.DELETE,
                new HttpEntity<>(headers()), Map.class).getBody();
    }
}
