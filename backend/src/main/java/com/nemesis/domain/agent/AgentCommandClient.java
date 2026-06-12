package com.nemesis.domain.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.node.Node;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.UUID;

/**
 * 관리 서버 → 에이전트 명령 채널(17001) 호출 클라이언트.
 * 컨트롤러(수동 실행)와 FailoverOrchestrator(자동 VIP 이동/복구)가 공유한다.
 * 노드의 유효 API 키를 Bearer로 실어 화이트리스트 명령을 전송하고 결과를 반환한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AgentCommandClient {

    private final AgentKeyRepository agentKeyRepository;
    private final RestTemplate       restTemplate;
    private final ObjectMapper       objectMapper;

    @Value("${nemesis.control-port:17001}")
    private int controlPort;

    public record Result(boolean ok, int exitCode, String stdout, String stderr, String error) {
        public static Result transportError(String msg) { return new Result(false, -1, "", "", msg); }
    }

    /** 지정 노드에 명령을 보내고 결과를 반환한다(예외를 던지지 않음). */
    @SuppressWarnings("unchecked")
    public Result execute(Node node, String command) {
        UUID nodeId = node.getId();
        String apiKey = agentKeyRepository.findByNodeId(nodeId)
                .filter(AgentKey::isValid)
                .map(AgentKey::getApiKey)
                .orElse(null);
        if (apiKey == null) {
            return Result.transportError("노드에 유효한 에이전트 키가 없습니다");
        }
        if (node.getServiceIp() == null || node.getServiceIp().isBlank()) {
            return Result.transportError("노드 service_ip 미설정");
        }

        String url = "http://" + node.getServiceIp() + ":" + controlPort + "/api/command";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        try {
            // 주의: Map을 그대로 보내면 Spring 6.1 SimpleClientHttpRequestFactory가
            // chunked 스트리밍으로 전송하는데, 에이전트(BaseHTTPRequestHandler)는
            // chunked 바디를 읽지 못해 빈 body(400)가 된다. String으로 직렬화하면
            // Content-Length가 설정돼 fixed-length로 전송된다.
            String requestJson = objectMapper.writeValueAsString(Map.of("command", command));
            ResponseEntity<Map> resp = restTemplate.exchange(
                    url, HttpMethod.POST,
                    new HttpEntity<>(requestJson, headers),
                    Map.class);
            Map<String, Object> body = resp.getBody();
            if (body == null) return new Result(true, 0, "", "", null);
            int exit = body.get("exitCode") instanceof Number n ? n.intValue() : 0;
            return new Result(exit == 0, exit,
                    String.valueOf(body.getOrDefault("stdout", "")),
                    String.valueOf(body.getOrDefault("stderr", "")),
                    (String) body.get("error"));
        } catch (Exception e) {
            log.warn("에이전트 명령 전송 실패 node={} cmd='{}': {}", nodeId, command, e.getMessage());
            return Result.transportError("에이전트 통신 실패: " + e.getMessage());
        }
    }
}
