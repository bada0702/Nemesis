package com.nemesis.domain.aiops;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpStatusCodeException;

import java.util.Map;

/**
 * 지식베이스 파일 편집(시스템 설정 UI 용) 프록시.
 * 파일은 사이드카(nemesis-bot) 호스트에 있으므로 사이드카 CRUD API 로 프록시한다.
 * 인증/권한: RbacFilter 가 /api/ai/knowledge 쓰기(POST/DELETE)를 OPERATOR 로,
 * 읽기(GET)를 로그인 사용자(AUTH)로 강제한다. 사이드카 호출은 aibot 공유 토큰 사용.
 *
 * 경로 탈출·YAML 검증 등 실제 방어는 사이드카(knowledge_base)에서 수행한다. 사이드카가
 * 400 을 주면 그 메시지를 그대로 사용자에게 전달한다.
 */
@Slf4j
@RestController
@RequestMapping("/api/ai/knowledge")
@RequiredArgsConstructor
public class AiKnowledgeController {

    private final AiOperatorClient client;

    @GetMapping("/files")
    public ResponseEntity<?> list() {
        return proxy(client::knowledgeList);
    }

    @GetMapping("/file")
    public ResponseEntity<?> read(@RequestParam String path) {
        return proxy(() -> client.knowledgeRead(path));
    }

    @PostMapping("/validate")
    public ResponseEntity<?> validate(@RequestBody Map<String, Object> body) {
        return proxy(() -> client.knowledgeValidate(str(body.get("content"))));
    }

    @PostMapping("/file")
    public ResponseEntity<?> save(@RequestBody Map<String, Object> body) {
        return proxy(() -> client.knowledgeSave(str(body.get("path")), str(body.get("content"))));
    }

    @DeleteMapping("/file")
    public ResponseEntity<?> delete(@RequestParam String path) {
        return proxy(() -> client.knowledgeDelete(path));
    }

    // 사이드카 호출을 감싸 4xx 메시지 전파 + 5xx/연결 실패를 502 로 통일.
    private ResponseEntity<?> proxy(java.util.function.Supplier<Map<String, Object>> call) {
        try {
            return ResponseEntity.ok(call.get());
        } catch (HttpStatusCodeException e) {
            // 사이드카가 준 상태코드/본문(경로·검증 오류 등)을 그대로 전달.
            return ResponseEntity.status(e.getStatusCode())
                    .body(Map.of("error", extractDetail(e.getResponseBodyAsString())));
        } catch (Exception e) {
            log.warn("사이드카 지식 API 프록시 실패: {}", e.getMessage());
            return ResponseEntity.status(502).body(Map.of("error", "사이드카(nemesis-bot) 연결 실패"));
        }
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    // FastAPI 오류 본문은 {"detail":"..."} 형태. 파싱 실패 시 원문 반환.
    private static String extractDetail(String body) {
        if (body == null || body.isBlank()) return "요청 거부됨";
        try {
            var m = new com.fasterxml.jackson.databind.ObjectMapper().readTree(body);
            if (m.has("detail")) return m.get("detail").asText();
        } catch (Exception ignore) { /* 원문 사용 */ }
        return body;
    }
}
