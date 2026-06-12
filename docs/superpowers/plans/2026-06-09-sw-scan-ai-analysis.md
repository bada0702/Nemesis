# SW 자동 스캔 및 AI 장애 분석 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에이전트가 push한 프로세스 목록에서 Known SW를 자동 감지해 등록하고, 에러 로그를 Ollama(gemma4:12b)로 분석해 수정 명령어를 원클릭 실행할 수 있게 한다.

**Architecture:** 기존 MetricsCacheService의 processes/errorLogPreview 데이터를 두 기능이 공유한다. SW 스캔은 동기 REST API, AI 분석은 비동기(@Async) + 수동 트리거 양쪽을 지원한다. 프론트엔드는 SW 관리 페이지에 스캔 모달을, /ai-analysis 신규 페이지에 분석 결과 + 실행 버튼을 추가한다.

**Tech Stack:** Spring Boot 3 / JPA / Flyway / RestTemplate / React 18 / Axios / Tailwind CSS (CDN)

---

## 파일 구조

### 백엔드 — 신규 생성
| 파일 | 역할 |
|------|------|
| `db/migration/V2__sw_ai_schema.sql` | sw_process, ai_fault_analysis 테이블 DDL |
| `domain/sw/SwProcess.java` | SW 등록 엔티티 |
| `domain/sw/SwProcessRepository.java` | JPA 레포지토리 |
| `domain/sw/SwScanService.java` | Known SW 매칭 + 등록 로직 |
| `domain/sw/SwScanController.java` | GET /api/sw/scan, POST /api/sw/register, GET /api/sw/list |
| `domain/ai/AiFaultAnalysis.java` | AI 분석 결과 엔티티 |
| `domain/ai/AiFaultAnalysisRepository.java` | JPA 레포지토리 |
| `domain/ai/OllamaService.java` | Ollama HTTP 클라이언트 |
| `domain/ai/AiFaultService.java` | 분석 오케스트레이션 + 5분 쿨다운 |
| `domain/ai/AiFaultController.java` | POST /api/ai/analyze/{nodeId}, GET /api/ai/analysis/{nodeId} |
| `domain/agent/AgentCommandController.java` | POST /api/agent/{nodeId}/execute |
| `dto/SwScanResponse.java` | 스캔 응답 DTO |
| `dto/AiFaultAnalysisDto.java` | 분석 결과 응답 DTO |

### 백엔드 — 수정
| 파일 | 변경 내용 |
|------|----------|
| `NemesisServerApplication.java` | `@EnableAsync` 추가 |
| `config/WebConfig.java` | `RestTemplate` @Bean 추가 |
| `domain/agent/MetricsPushController.java` | errorLogPreview 비었을 때 AiFaultService 비동기 트리거 |

### 프론트엔드 — 신규 생성
| 파일 | 역할 |
|------|------|
| `pages/AiAnalysis.jsx` | AI 장애 분석 전용 페이지 |

### 프론트엔드 — 수정
| 파일 | 변경 내용 |
|------|----------|
| `api/client.js` | sw/ai 관련 API 함수 6개 추가 |
| `pages/Sw.jsx` | "자동 스캔" 버튼 + SwScanModal 컴포넌트 추가 |
| `App.jsx` | `/ai-analysis` 라우트 추가 |
| `components/Navbar.jsx` | `/ai-analysis` 페이지 타이틀 추가 |
| `components/dashboard/AiPanel.jsx` | "더보기" → navigate('/ai-analysis') |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `backend/src/main/resources/db/migration/V3__sw_ai_schema.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- V3 (V2는 runbook_schema)
CREATE TABLE sw_process (
    id            BIGSERIAL PRIMARY KEY,
    node_id       UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    cluster_id    UUID REFERENCES cluster_groups(id) ON DELETE SET NULL,
    name          VARCHAR(200) NOT NULL,
    display_name  VARCHAR(200),
    type          VARCHAR(20)  NOT NULL DEFAULT 'KNOWN',
    status        VARCHAR(20)  DEFAULT 'unknown',
    pid           INTEGER,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (node_id, name)
);

CREATE TABLE ai_fault_analysis (
    id            BIGSERIAL PRIMARY KEY,
    node_id       UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    error_logs    TEXT,
    root_cause    TEXT,
    fix_commands  JSONB,
    trigger_type  VARCHAR(10)  DEFAULT 'AUTO',
    status        VARCHAR(20)  DEFAULT 'PENDING',
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sw_process_node     ON sw_process(node_id);
CREATE INDEX idx_ai_analysis_node    ON ai_fault_analysis(node_id);
CREATE INDEX idx_ai_analysis_created ON ai_fault_analysis(created_at);
```

- [ ] **Step 2: 백엔드 재시작해서 Flyway 마이그레이션 정상 실행 확인**

```bash
cd backend
./gradlew bootRun
```

Expected: `Successfully applied 1 migration to schema "public"` 로그 출력

---

## Task 2: SwProcess 엔티티 + 레포지토리

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/sw/SwProcess.java`
- Create: `backend/src/main/java/com/nemesis/domain/sw/SwProcessRepository.java`

- [ ] **Step 1: SwProcess 엔티티 작성**

```java
package com.nemesis.domain.sw;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "sw_process")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SwProcess {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id", nullable = false)
    private Node node;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_id")
    private Cluster cluster;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "display_name", length = 200)
    private String displayName;

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String type = "KNOWN";

    @Column(length = 20)
    @Builder.Default
    private String status = "unknown";

    private Integer pid;

    @Column(name = "registered_at", updatable = false)
    private OffsetDateTime registeredAt;

    @PrePersist
    void prePersist() { this.registeredAt = OffsetDateTime.now(); }
}
```

- [ ] **Step 2: SwProcessRepository 작성**

```java
package com.nemesis.domain.sw;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SwProcessRepository extends JpaRepository<SwProcess, Long> {
    List<SwProcess> findByNodeId(UUID nodeId);
    boolean existsByNodeIdAndName(UUID nodeId, String name);
}
```

- [ ] **Step 3: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL

---

## Task 3: SwScanService

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/sw/SwScanService.java`

- [ ] **Step 1: SwScanService 작성 (Known SW 매칭 + 등록 로직)**

```java
package com.nemesis.domain.sw;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class SwScanService {

    private static final Map<String, String> KNOWN_SW = new LinkedHashMap<>();

    static {
        KNOWN_SW.put("weblogic",  "WebLogic");
        KNOWN_SW.put("wlserver",  "WebLogic");
        KNOWN_SW.put("oracle",    "Oracle DB");
        KNOWN_SW.put("ora_pmon",  "Oracle DB");
        KNOWN_SW.put("ora_smon",  "Oracle DB");
        KNOWN_SW.put("tomcat",    "Tomcat");
        KNOWN_SW.put("catalina",  "Tomcat");
        KNOWN_SW.put("nginx",     "Nginx");
        KNOWN_SW.put("httpd",     "Apache HTTPD");
        KNOWN_SW.put("mysqld",    "MySQL");
        KNOWN_SW.put("postgres",  "PostgreSQL");
        KNOWN_SW.put("redis-server", "Redis");
        KNOWN_SW.put("kafka",     "Kafka");
        KNOWN_SW.put("zookeeper", "Zookeeper");
        KNOWN_SW.put("jboss",     "JBoss/WildFly");
        KNOWN_SW.put("wildfly",   "JBoss/WildFly");
        KNOWN_SW.put("amqbroker", "IBM MQ");
        KNOWN_SW.put("haproxy",   "HAProxy");
        KNOWN_SW.put("keepalived","Keepalived");
    }

    private final MetricsCacheService metricsCache;
    private final NodeRepository      nodeRepository;
    private final SwProcessRepository swProcessRepository;
    private final ClusterRepository   clusterRepository;

    public Map<String, List<Map<String, Object>>> scan(UUID nodeId) {
        MetricsPushRequest metrics = metricsCache.get(nodeId)
                .orElseThrow(() -> new IllegalStateException("No cached metrics for node: " + nodeId));

        List<Map<String, Object>> known   = new ArrayList<>();
        List<Map<String, Object>> unknown = new ArrayList<>();

        List<Map<String, String>> processes = metrics.getProcesses();
        if (processes == null) return Map.of("known", known, "unknown", unknown);

        for (Map<String, String> proc : processes) {
            String name = proc.getOrDefault("name", "").toLowerCase();
            String pid  = proc.getOrDefault("pid", "");

            String displayName = matchKnownSw(name);
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", proc.getOrDefault("name", ""));
            entry.put("pid",  pid.isEmpty() ? null : Integer.parseInt(pid));

            if (displayName != null) {
                entry.put("displayName", displayName);
                entry.put("type", "KNOWN");
                known.add(entry);
            } else {
                unknown.add(entry);
            }
        }
        return Map.of("known", known, "unknown", unknown);
    }

    private String matchKnownSw(String processNameLower) {
        for (Map.Entry<String, String> e : KNOWN_SW.entrySet()) {
            if (processNameLower.contains(e.getKey())) return e.getValue();
        }
        return null;
    }

    @Transactional
    public int register(UUID nodeId, List<Map<String, Object>> processes) {
        Node node = nodeRepository.findById(nodeId)
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));
        int count = 0;
        for (Map<String, Object> p : processes) {
            String name = (String) p.get("name");
            if (name == null || name.isBlank()) continue;
            if (swProcessRepository.existsByNodeIdAndName(nodeId, name)) continue;

            SwProcess sw = SwProcess.builder()
                    .node(node)
                    .cluster(node.getCluster())
                    .name(name)
                    .displayName((String) p.getOrDefault("displayName", name))
                    .type((String) p.getOrDefault("type", "CUSTOM"))
                    .status("unknown")
                    .pid(p.get("pid") != null ? ((Number) p.get("pid")).intValue() : null)
                    .build();
            swProcessRepository.save(sw);
            count++;
        }
        return count;
    }

    public List<SwProcess> list(UUID nodeId) {
        return swProcessRepository.findByNodeId(nodeId);
    }
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL

---

## Task 4: SwScanController

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/sw/SwScanController.java`
- Create: `backend/src/main/java/com/nemesis/dto/SwScanResponse.java`

- [ ] **Step 1: SwScanResponse DTO 작성**

```java
package com.nemesis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
@AllArgsConstructor
public class SwScanResponse {
    private List<Map<String, Object>> known;
    private List<Map<String, Object>> unknown;
}
```

- [ ] **Step 2: SwScanController 작성**

```java
package com.nemesis.domain.sw;

import com.nemesis.dto.SwScanResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sw")
@RequiredArgsConstructor
public class SwScanController {

    private final SwScanService swScanService;

    @GetMapping("/scan")
    public ResponseEntity<SwScanResponse> scan(@RequestParam UUID nodeId) {
        Map<String, List<Map<String, Object>>> result = swScanService.scan(nodeId);
        return ResponseEntity.ok(new SwScanResponse(
                result.get("known"),
                result.get("unknown")
        ));
    }

    @PostMapping("/register")
    public ResponseEntity<Map<String, Integer>> register(@RequestBody Map<String, Object> body) {
        UUID nodeId = UUID.fromString((String) body.get("nodeId"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> processes = (List<Map<String, Object>>) body.get("processes");
        int registered = swScanService.register(nodeId, processes);
        return ResponseEntity.ok(Map.of("registered", registered));
    }

    @GetMapping("/list")
    public ResponseEntity<Map<String, Object>> list(@RequestParam UUID nodeId) {
        List<SwProcess> items = swScanService.list(nodeId);
        List<Map<String, Object>> result = items.stream().map(s -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id",          s.getId());
            m.put("name",        s.getName());
            m.put("displayName", s.getDisplayName());
            m.put("type",        s.getType());
            m.put("status",      s.getStatus());
            m.put("pid",         s.getPid());
            m.put("registeredAt", s.getRegisteredAt());
            return m;
        }).toList();
        return ResponseEntity.ok(Map.of("items", result));
    }
}
```

- [ ] **Step 3: 컴파일 및 서버 재시작 후 엔드포인트 확인**

```bash
cd backend && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL

---

## Task 5: AiFaultAnalysis 엔티티 + 레포지토리

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/ai/AiFaultAnalysis.java`
- Create: `backend/src/main/java/com/nemesis/domain/ai/AiFaultAnalysisRepository.java`

- [ ] **Step 1: AiFaultAnalysis 엔티티 작성**

```java
package com.nemesis.domain.ai;

import com.nemesis.domain.node.Node;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "ai_fault_analysis")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiFaultAnalysis {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id", nullable = false)
    private Node node;

    @Column(name = "error_logs", columnDefinition = "TEXT")
    private String errorLogs;

    @Column(name = "root_cause", columnDefinition = "TEXT")
    private String rootCause;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fix_commands", columnDefinition = "jsonb")
    private List<Map<String, Object>> fixCommands;

    @Column(name = "trigger_type", length = 10)
    @Builder.Default
    private String triggerType = "AUTO";

    @Column(length = 20)
    @Builder.Default
    private String status = "PENDING";

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() { this.createdAt = OffsetDateTime.now(); }
}
```

- [ ] **Step 2: AiFaultAnalysisRepository 작성**

```java
package com.nemesis.domain.ai;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public interface AiFaultAnalysisRepository extends JpaRepository<AiFaultAnalysis, Long> {
    Optional<AiFaultAnalysis> findTopByNodeIdOrderByCreatedAtDesc(UUID nodeId);
    boolean existsByNodeIdAndCreatedAtAfter(UUID nodeId, OffsetDateTime after);
}
```

- [ ] **Step 3: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL

---

## Task 6: OllamaService

**Files:**
- Modify: `backend/src/main/java/com/nemesis/config/WebConfig.java`
- Create: `backend/src/main/java/com/nemesis/domain/ai/OllamaService.java`

- [ ] **Step 1: WebConfig에 RestTemplate Bean 추가**

`WebConfig.java`의 기존 내용에 다음을 추가:

```java
package com.nemesis.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .allowedHeaders("*");
    }

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
```

- [ ] **Step 2: OllamaService 작성**

```java
package com.nemesis.domain.ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class OllamaService {

    private final RestTemplate restTemplate;

    @Value("${ollama.base-url:http://localhost:11434}")
    private String ollamaBaseUrl;

    @Value("${ollama.model:gemma4:12b}")
    private String model;

    private static final String SYSTEM_PROMPT =
        "당신은 AIX/Linux 엔터프라이즈 시스템 장애 분석 전문가입니다. " +
        "에러 로그를 분석하여 근본 원인과 수정 명령어를 반드시 아래 JSON 형식으로만 반환하세요. " +
        "다른 설명 없이 JSON만 반환하세요. " +
        "형식: {\"rootCause\": \"...\", \"fixCommands\": [{\"order\": 1, \"command\": \"...\", \"description\": \"...\", \"risk\": \"LOW\"}]}";

    public Map<String, Object> analyze(String errorLogs) {
        Map<String, Object> requestBody = Map.of(
            "model", model,
            "messages", List.of(
                Map.of("role", "system", "content", SYSTEM_PROMPT),
                Map.of("role", "user",   "content", "다음 에러 로그를 분석하세요:\n" + errorLogs)
            ),
            "stream", false
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                ollamaBaseUrl + "/api/chat",
                HttpMethod.POST, entity, Map.class
            );
            @SuppressWarnings("unchecked")
            Map<String, Object> message = (Map<String, Object>)
                ((Map<String, Object>) response.getBody().get("message"));
            String content = (String) message.get("content");
            return parseJsonResponse(content);
        } catch (Exception e) {
            log.error("Ollama 분석 실패: {}", e.getMessage());
            return Map.of(
                "rootCause", "AI 분석 중 오류 발생: " + e.getMessage(),
                "fixCommands", List.of()
            );
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJsonResponse(String content) {
        try {
            String json = content.trim();
            if (json.startsWith("```")) {
                json = json.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
            }
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(json, Map.class);
        } catch (Exception e) {
            log.warn("Ollama 응답 파싱 실패, raw: {}", content);
            return Map.of("rootCause", content, "fixCommands", List.of());
        }
    }
}
```

- [ ] **Step 3: application.yml에 Ollama 설정 추가**

`application.yml`의 `nemesis:` 블록 위에 추가:

```yaml
ollama:
  base-url: ${OLLAMA_BASE_URL:http://localhost:11434}
  model: ${LLM_MODEL:gemma4:12b}
```

- [ ] **Step 4: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL

---

## Task 7: AiFaultService

**Files:**
- Modify: `backend/src/main/java/com/nemesis/NemesisServerApplication.java`
- Create: `backend/src/main/java/com/nemesis/domain/ai/AiFaultService.java`

- [ ] **Step 1: NemesisServerApplication에 @EnableAsync 추가**

```java
package com.nemesis;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableAsync
public class NemesisServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(NemesisServerApplication.class, args);
    }
}
```

- [ ] **Step 2: AiFaultService 작성**

```java
package com.nemesis.domain.ai;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class AiFaultService {

    private static final int COOLDOWN_MINUTES = 5;

    private final MetricsCacheService          metricsCache;
    private final NodeRepository               nodeRepository;
    private final AiFaultAnalysisRepository    analysisRepository;
    private final OllamaService                ollamaService;

    @Async
    public void analyzeAsync(UUID nodeId) {
        if (isCooldownActive(nodeId)) {
            log.debug("AI 분석 쿨다운 중, 노드: {}", nodeId);
            return;
        }
        doAnalyze(nodeId, "AUTO");
    }

    @Transactional
    public AiFaultAnalysis analyzeManual(UUID nodeId) {
        return doAnalyze(nodeId, "MANUAL");
    }

    private boolean isCooldownActive(UUID nodeId) {
        return analysisRepository.existsByNodeIdAndCreatedAtAfter(
            nodeId, OffsetDateTime.now().minusMinutes(COOLDOWN_MINUTES)
        );
    }

    @Transactional
    private AiFaultAnalysis doAnalyze(UUID nodeId, String triggerType) {
        Node node = nodeRepository.findById(nodeId)
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));

        MetricsPushRequest metrics = metricsCache.get(nodeId)
                .orElseThrow(() -> new IllegalStateException("No cached metrics for node: " + nodeId));

        List<String> errorLogs = metrics.getErrorLogPreview();
        if (errorLogs == null || errorLogs.isEmpty()) {
            throw new IllegalStateException("에러 로그가 없습니다.");
        }

        AiFaultAnalysis analysis = AiFaultAnalysis.builder()
                .node(node)
                .errorLogs(String.join("\n", errorLogs))
                .triggerType(triggerType)
                .status("ANALYZING")
                .build();
        analysis = analysisRepository.save(analysis);

        try {
            Map<String, Object> result = ollamaService.analyze(analysis.getErrorLogs());
            analysis.setRootCause((String) result.get("rootCause"));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> fixCmds = (List<Map<String, Object>>) result.get("fixCommands");
            analysis.setFixCommands(fixCmds != null ? fixCmds : List.of());
            analysis.setStatus("DONE");
        } catch (Exception e) {
            log.error("AI 분석 실패, 노드: {}", nodeId, e);
            analysis.setRootCause("분석 실패: " + e.getMessage());
            analysis.setFixCommands(List.of());
            analysis.setStatus("FAILED");
        }

        return analysisRepository.save(analysis);
    }

    public Optional<AiFaultAnalysis> getLatest(UUID nodeId) {
        return analysisRepository.findTopByNodeIdOrderByCreatedAtDesc(nodeId);
    }
}
```

- [ ] **Step 3: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL

---

## Task 8: AiFaultController + AgentCommandController

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/ai/AiFaultController.java`
- Create: `backend/src/main/java/com/nemesis/dto/AiFaultAnalysisDto.java`
- Create: `backend/src/main/java/com/nemesis/domain/agent/AgentCommandController.java`

- [ ] **Step 1: AiFaultAnalysisDto 작성**

```java
package com.nemesis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class AiFaultAnalysisDto {
    private Long   id;
    private String nodeId;
    private String rootCause;
    private List<Map<String, Object>> fixCommands;
    private String triggerType;
    private String status;
    private OffsetDateTime createdAt;
}
```

- [ ] **Step 2: AiFaultController 작성**

```java
package com.nemesis.domain.ai;

import com.nemesis.dto.AiFaultAnalysisDto;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiFaultController {

    private final AiFaultService aiFaultService;

    @PostMapping("/analyze/{nodeId}")
    public ResponseEntity<AiFaultAnalysisDto> analyze(@PathVariable UUID nodeId) {
        AiFaultAnalysis result = aiFaultService.analyzeManual(nodeId);
        return ResponseEntity.ok(toDto(result));
    }

    @GetMapping("/analysis/{nodeId}")
    public ResponseEntity<AiFaultAnalysisDto> getLatest(@PathVariable UUID nodeId) {
        return aiFaultService.getLatest(nodeId)
                .map(a -> ResponseEntity.ok(toDto(a)))
                .orElse(ResponseEntity.notFound().build());
    }

    private AiFaultAnalysisDto toDto(AiFaultAnalysis a) {
        return new AiFaultAnalysisDto(
            a.getId(),
            a.getNode().getId().toString(),
            a.getRootCause(),
            a.getFixCommands(),
            a.getTriggerType(),
            a.getStatus(),
            a.getCreatedAt()
        );
    }
}
```

- [ ] **Step 3: AgentCommandController 작성**

```java
package com.nemesis.domain.agent;

import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class AgentCommandController {

    private final NodeRepository nodeRepository;
    private final RestTemplate   restTemplate;

    @Value("${nemesis.control-port:17001}")
    private int controlPort;

    @PostMapping("/{nodeId}/execute")
    public ResponseEntity<Map<String, Object>> execute(
            @PathVariable UUID nodeId,
            @RequestBody Map<String, String> body) {

        String command = body.get("command");
        if (command == null || command.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "command is required"));
        }

        Node node = nodeRepository.findById(nodeId)
                .orElseThrow(() -> new IllegalArgumentException("Node not found: " + nodeId));

        String agentUrl = "http://" + node.getServiceIp() + ":" + controlPort + "/api/command";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, String>> entity = new HttpEntity<>(Map.of("command", command), headers);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                agentUrl, HttpMethod.POST, entity, Map.class
            );
            return ResponseEntity.ok(response.getBody() != null
                ? response.getBody()
                : Map.of("stdout", "", "stderr", "", "exitCode", 0));
        } catch (Exception e) {
            log.error("에이전트 명령 실행 실패, 노드: {}, 명령: {}", nodeId, command, e);
            return ResponseEntity.status(502).body(
                Map.of("error", "에이전트 통신 실패: " + e.getMessage())
            );
        }
    }
}
```

- [ ] **Step 4: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava
```

Expected: BUILD SUCCESSFUL

---

## Task 9: MetricsPushController 자동 트리거 연결

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/agent/MetricsPushController.java`

- [ ] **Step 1: MetricsPushController에 AI 자동 트리거 추가**

```java
package com.nemesis.domain.agent;

import com.nemesis.domain.ai.AiFaultService;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class MetricsPushController {

    private final AgentService   agentService;
    private final AiFaultService aiFaultService;

    @PostMapping("/metrics")
    public ResponseEntity<Void> pushMetrics(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @RequestBody MetricsPushRequest req) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401).build();
        }

        agentService.pushMetrics(authHeader.substring(7), req);

        if (req.getErrorLogPreview() != null && !req.getErrorLogPreview().isEmpty()) {
            UUID nodeId = agentService.resolveNodeId(authHeader.substring(7));
            aiFaultService.analyzeAsync(nodeId);
        }

        return ResponseEntity.ok().build();
    }
}
```

- [ ] **Step 2: 컴파일 및 전체 백엔드 서버 시작 확인**

```bash
cd backend && ./gradlew bootRun
```

Expected: Started NemesisServerApplication

---

## Task 10: .env 업데이트

**Files:**
- Modify: `.env` (프로젝트 루트)

- [ ] **Step 1: .env 파일에서 LLM 설정 변경**

기존 내용에서:
```
LLM_PROVIDER=openai
LLM_API_KEY=sk-placeholder
LLM_MODEL=gpt-4o
```

아래로 교체:
```
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
LLM_MODEL=gemma4:12b
```

`LLM_API_KEY` 줄은 삭제한다.

---

## Task 11: client.js API 함수 추가

**Files:**
- Modify: `frontend/src/api/client.js`

- [ ] **Step 1: client.js 하단에 SW/AI API 함수 6개 추가**

기존 파일 마지막 줄 다음에 추가:

```js
// SW 스캔 / 등록
export const scanSw             = (nodeId)       => client.get(`/sw/scan?nodeId=${nodeId}`)
export const registerSw         = (data)         => client.post('/sw/register', data)
export const listSw             = (nodeId)       => client.get(`/sw/list?nodeId=${nodeId}`)

// AI 장애 분석
export const triggerAiAnalysis  = (nodeId)       => client.post(`/ai/analyze/${nodeId}`)
export const getAiAnalysisResult= (nodeId)       => client.get(`/ai/analysis/${nodeId}`)
export const executeAgentCommand= (nodeId, data) => client.post(`/agent/${nodeId}/execute`, data)
```

---

## Task 12: Sw.jsx 스캔 버튼 + 모달

**Files:**
- Modify: `frontend/src/pages/Sw.jsx`

- [ ] **Step 1: Sw.jsx 전체를 스캔 기능이 포함된 버전으로 교체**

```jsx
import React, { useEffect, useState } from 'react'
import { Package, RefreshCw, Search, ScanLine, Plus, X, Check } from 'lucide-react'
import { getSw, scanSw, registerSw } from '../api/client'
import { statusBadge, dot } from '../lib/utils'

const TYPE_COLORS = { WAS: 'bg-blue-600', WEB: 'bg-yellow-600', DB: 'bg-green-600', SYS: 'bg-gray-600' }

function SwScanModal({ nodeId, onClose, onRegistered }) {
  const [scanning, setScanning]   = useState(false)
  const [known,    setKnown]      = useState([])
  const [unknown,  setUnknown]    = useState([])
  const [checked,  setChecked]    = useState({})
  const [custom,   setCustom]     = useState([])
  const [newName,  setNewName]    = useState('')
  const [newDisplay, setNewDisplay] = useState('')
  const [saving,   setSaving]     = useState(false)
  const [error,    setError]      = useState(null)

  useEffect(() => {
    async function doScan() {
      setScanning(true)
      try {
        const r = await scanSw(nodeId)
        setKnown(r.data.known ?? [])
        setUnknown(r.data.unknown ?? [])
        const init = {}
        ;(r.data.known ?? []).forEach((k, i) => { init[`k_${i}`] = true })
        setChecked(init)
      } catch (e) {
        setError('스캔 실패: ' + (e.response?.data?.message ?? e.message))
      } finally {
        setScanning(false)
      }
    }
    doScan()
  }, [nodeId])

  function toggleKnown(i) {
    setChecked(c => ({ ...c, [`k_${i}`]: !c[`k_${i}`] }))
  }

  function addCustom() {
    if (!newName.trim()) return
    setCustom(c => [...c, { name: newName.trim(), displayName: newDisplay.trim() || newName.trim(), type: 'CUSTOM' }])
    setNewName('')
    setNewDisplay('')
  }

  function removeCustom(i) {
    setCustom(c => c.filter((_, idx) => idx !== i))
  }

  async function handleRegister() {
    const toRegister = [
      ...known.filter((_, i) => checked[`k_${i}`]).map(k => ({ ...k, type: 'KNOWN' })),
      ...custom,
    ]
    if (toRegister.length === 0) { setError('등록할 항목을 선택하세요.'); return }
    setSaving(true)
    try {
      await registerSw({ nodeId, processes: toRegister })
      onRegistered()
    } catch (e) {
      setError('등록 실패: ' + (e.response?.data?.message ?? e.message))
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = known.filter((_, i) => checked[`k_${i}`]).length + custom.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-blue-400" /> SW 자동 스캔 결과
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {scanning && (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-400 text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            스캔 중...
          </div>
        )}

        {!scanning && error && <p className="text-xs text-red-400 mb-4">{error}</p>}

        {!scanning && (
          <>
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-bold">
                자동 감지된 SW ({known.length}개)
              </p>
              {known.length === 0 && <p className="text-xs text-gray-500 py-2">감지된 Known SW가 없습니다.</p>}
              <div className="space-y-1.5">
                {known.map((k, i) => (
                  <label key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/5 cursor-pointer">
                    <div onClick={() => toggleKnown(i)}
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 cursor-pointer
                        ${checked[`k_${i}`] ? 'bg-blue-600 border-blue-600' : 'border-gray-600'}`}>
                      {checked[`k_${i}`] && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-white">{k.displayName}</span>
                      <span className="text-[10px] text-gray-500 ml-2 font-mono">{k.name}</span>
                    </div>
                    {k.pid && <span className="text-[10px] text-gray-600 font-mono">PID {k.pid}</span>}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">알려진 SW</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-800 pt-4 mb-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-bold">
                알 수 없는 프로세스 — 수동 등록 ({unknown.length}개 감지)
              </p>
              <div className="flex gap-2 mb-2">
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="프로세스명 (예: proc_xyz)"
                  className="flex-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
                <input value={newDisplay} onChange={e => setNewDisplay(e.target.value)}
                  placeholder="표시명"
                  className="flex-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
                <button onClick={addCustom}
                  className="px-3 py-1.5 text-xs bg-blue-600/20 border border-blue-600/30 text-blue-400 rounded-lg hover:bg-blue-600/30 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> 추가
                </button>
              </div>
              {custom.map((c, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-white/5 mb-1">
                  <span className="text-xs text-white flex-1">{c.displayName}</span>
                  <span className="text-[10px] text-gray-500 font-mono">{c.name}</span>
                  <button onClick={() => removeCustom(i)} className="text-gray-500 hover:text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white">
                취소
              </button>
              <button onClick={handleRegister} disabled={saving || selectedCount === 0}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700">
                {saving ? '등록 중...' : `선택 항목 등록 (${selectedCount}개)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Sw() {
  const [items,      setItems]      = useState([])
  const [filter,     setFilter]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading,    setLoading]    = useState(true)
  const [scanModal,  setScanModal]  = useState(false)

  async function load() {
    setLoading(true)
    try { const r = await getSw(); setItems(r.data.items ?? []) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const types    = [...new Set(items.map(i => i.type))]
  const filtered = items.filter(i =>
    (typeFilter === 'all' || i.type === typeFilter) &&
    i.name.toLowerCase().includes(filter.toLowerCase())
  )
  const running = items.filter(i => i.state === 'running').length

  const DEMO_NODE_ID = items[0]?.nodeId ?? 'demo'

  return (
    <div className="p-8 pt-0 space-y-6">
      {scanModal && (
        <SwScanModal
          nodeId={DEMO_NODE_ID}
          onClose={() => setScanModal(false)}
          onRegistered={() => { setScanModal(false); load() }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">SW 관리</h2>
          <p className="text-xs text-gray-500 mt-1">미들웨어 및 시스템 소프트웨어 현황</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setScanModal(true)}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20">
            <ScanLine className="w-3.5 h-3.5" /> 자동 스캔
          </button>
          <button onClick={load}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '전체 SW', value: items.length,           color: 'text-white' },
          { label: '실행 중', value: running,                color: 'text-green-400' },
          { label: '중지',    value: items.length - running, color: items.length - running > 0 ? 'text-red-400' : 'text-gray-500' },
          { label: '타입',    value: types.length,           color: 'text-blue-400' },
        ].map(c => (
          <div key={c.label} className="card-bg rounded-xl p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="SW 이름 검색..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white outline-none focus:border-blue-500" />
        </div>
        <div className="flex gap-2">
          {['all', ...types].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${typeFilter === t ? 'bg-blue-600/20 border-blue-600/40 text-blue-400' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
              {t === 'all' ? '전체' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="card-bg rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-800">
            <tr className="text-gray-500 uppercase">
              {['타입','이름','버전','상태','노드','포트','PID','가동 시간',''].map(h => (
                <th key={h} className="text-left py-3 px-4 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && filtered.length === 0
              ? <tr><td colSpan="9" className="text-center py-12 text-gray-500">로딩 중...</td></tr>
              : filtered.length === 0
              ? <tr><td colSpan="9" className="text-center py-12 text-gray-500">
                  <div className="flex flex-col items-center gap-3">
                    <Package className="w-10 h-10 opacity-20" />
                    <p>등록된 SW가 없습니다.</p>
                    <button onClick={() => setScanModal(true)} className="text-xs text-blue-400 hover:text-blue-300 underline">
                      자동 스캔으로 등록해 보세요
                    </button>
                  </div>
                </td></tr>
              : filtered.map((item, i) => (
                <tr key={i} className="border-b border-gray-800/40 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold ${TYPE_COLORS[item.type] ?? 'bg-gray-600'}`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-medium text-white">{item.name}</td>
                  <td className="py-3 px-4 text-gray-400">{item.version}</td>
                  <td className="py-3 px-4"><span className={`${dot(item.state)} font-medium`}>● {item.state}</span></td>
                  <td className="py-3 px-4 text-gray-400">{item.node}</td>
                  <td className="py-3 px-4 text-gray-400">{item.port ?? '—'}</td>
                  <td className="py-3 px-4 text-gray-500 font-mono">{item.pid ?? '—'}</td>
                  <td className="py-3 px-4 text-gray-400">{item.uptime ?? '—'}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1">
                      {item.state !== 'running'
                        ? <button className="text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20">기동</button>
                        : <button className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">중지</button>}
                      <button className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white">재시작</button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

---

## Task 13: AiAnalysis.jsx 페이지

**Files:**
- Create: `frontend/src/pages/AiAnalysis.jsx`

- [ ] **Step 1: AiAnalysis.jsx 작성**

```jsx
import React, { useEffect, useState, useCallback } from 'react'
import { Bot, RefreshCw, Play, AlertTriangle, CheckCircle, Clock, ChevronDown } from 'lucide-react'
import { getClusters, getClusterStatus, triggerAiAnalysis, getAiAnalysisResult, executeAgentCommand } from '../api/client'

const RISK_COLORS = {
  LOW:    'text-green-400 bg-green-500/10 border-green-500/20',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  HIGH:   'text-red-400 bg-red-500/10 border-red-500/20',
}
const RISK_LABELS = { LOW: '낮음', MEDIUM: '중간', HIGH: '높음' }

function ExecuteConfirmModal({ nodeId, command, onConfirm, onClose }) {
  const [running, setRunning]   = useState(false)
  const [result,  setResult]    = useState(null)

  async function run() {
    setRunning(true)
    try {
      const r = await executeAgentCommand(nodeId, { command })
      setResult(r.data)
    } catch (e) {
      setResult({ error: e.response?.data?.error ?? e.message })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => !result && e.target === e.currentTarget && onClose()}>
      <div className="card-bg w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <h3 className="text-sm font-bold text-white mb-4">명령어 실행 확인</h3>
        <p className="text-xs text-gray-400 mb-3">다음 명령어를 실행합니다:</p>
        <code className="block bg-black/40 rounded-lg px-4 py-3 text-xs text-green-400 font-mono mb-4 break-all">
          {command}
        </code>

        {result ? (
          <div className="space-y-2 mb-4">
            {result.error && <p className="text-xs text-red-400">오류: {result.error}</p>}
            {result.stdout && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase mb-1">stdout</p>
                <pre className="bg-black/40 rounded px-3 py-2 text-xs text-gray-300 font-mono overflow-x-auto max-h-32">{result.stdout}</pre>
              </div>
            )}
            {result.stderr && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase mb-1">stderr</p>
                <pre className="bg-black/40 rounded px-3 py-2 text-xs text-red-300 font-mono overflow-x-auto max-h-32">{result.stderr}</pre>
              </div>
            )}
            {result.exitCode !== undefined && (
              <p className="text-xs text-gray-500">종료 코드: <span className={result.exitCode === 0 ? 'text-green-400' : 'text-red-400'}>{result.exitCode}</span></p>
            )}
          </div>
        ) : (
          <p className="text-xs text-yellow-400 mb-4">⚠ 실제 노드에서 즉시 실행됩니다. 계속하시겠습니까?</p>
        )}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white">
            {result ? '닫기' : '취소'}
          </button>
          {!result && (
            <button onClick={run} disabled={running}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700 flex items-center justify-center gap-2">
              {running ? <><div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />실행 중...</> : <><Play className="w-3 h-3" />실행</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AiAnalysis() {
  const [nodes,      setNodes]      = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [analysis,   setAnalysis]   = useState(null)
  const [analyzing,  setAnalyzing]  = useState(false)
  const [loadingNodes, setLoadingNodes] = useState(true)
  const [execModal,  setExecModal]  = useState(null)

  useEffect(() => {
    async function loadNodes() {
      try {
        const listRes = await getClusters()
        const statuses = await Promise.all(
          listRes.data.map(c => getClusterStatus(c.id).catch(() => null))
        )
        const allNodes = statuses.flatMap(s => s?.data?.nodes ?? [])
        setNodes(allNodes)
        if (allNodes.length > 0) setSelectedId(allNodes[0].id)
      } catch { /* ignore */ }
      finally { setLoadingNodes(false) }
    }
    loadNodes()
  }, [])

  const loadAnalysis = useCallback(async (nodeId) => {
    if (!nodeId) return
    try {
      const r = await getAiAnalysisResult(nodeId)
      setAnalysis(r.data)
    } catch (e) {
      if (e.response?.status === 404) setAnalysis(null)
    }
  }, [])

  useEffect(() => { loadAnalysis(selectedId) }, [selectedId, loadAnalysis])

  async function handleAnalyze() {
    if (!selectedId) return
    setAnalyzing(true)
    try {
      await triggerAiAnalysis(selectedId)
      await loadAnalysis(selectedId)
    } catch (e) {
      alert('분석 실패: ' + (e.response?.data?.message ?? e.message))
    } finally {
      setAnalyzing(false)
    }
  }

  const selectedNode = nodes.find(n => n.id === selectedId)

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" /> AI 장애 분석
          </h2>
          <p className="text-xs text-gray-500 mt-1">에러 로그를 AI가 분석하고 수정 명령어를 제안합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          {!loadingNodes && nodes.length > 0 && (
            <select value={selectedId ?? ''} onChange={e => setSelectedId(e.target.value)}
              className="text-xs bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500">
              {nodes.map(n => <option key={n.id} value={n.id}>{n.hostname ?? n.id}</option>)}
            </select>
          )}
          <button onClick={handleAnalyze} disabled={analyzing || !selectedId}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {analyzing
              ? <><div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />분석 중...</>
              : <><RefreshCw className="w-3.5 h-3.5" />다시 분석</>}
          </button>
        </div>
      </div>

      {!analysis && !analyzing && (
        <div className="card-bg rounded-xl p-12 flex flex-col items-center gap-4 text-gray-500">
          <Bot className="w-12 h-12 opacity-20" />
          <p className="text-sm">분석 결과가 없습니다.</p>
          <p className="text-xs">에이전트가 에러 로그를 push하거나 "다시 분석" 버튼을 누르면 자동 분석됩니다.</p>
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          <div className="card-bg rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {analysis.status === 'DONE'
                ? <CheckCircle className="w-4 h-4 text-green-400" />
                : analysis.status === 'ANALYZING'
                ? <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                : <AlertTriangle className="w-4 h-4 text-yellow-400" />}
              <span className="text-xs text-gray-300">
                노드: <span className="text-white font-medium">{selectedNode?.hostname ?? selectedId}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <Clock className="w-3 h-3" />
              {analysis.createdAt ? new Date(analysis.createdAt).toLocaleString('ko-KR') : '—'}
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${analysis.triggerType === 'AUTO' ? 'bg-gray-700 text-gray-400' : 'bg-blue-500/20 text-blue-400'}`}>
                {analysis.triggerType === 'AUTO' ? '자동' : '수동'}
              </span>
            </div>
          </div>

          <div className="card-bg rounded-xl p-6">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">근본 원인</p>
            <p className="text-sm text-gray-200 leading-relaxed">{analysis.rootCause ?? '분석 중...'}</p>
          </div>

          {analysis.fixCommands && analysis.fixCommands.length > 0 && (
            <div className="card-bg rounded-xl p-6">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-4">수정 명령어</p>
              <div className="space-y-3">
                {analysis.fixCommands.map((cmd, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-black/20">
                    <span className="text-[10px] text-gray-600 font-mono mt-0.5 shrink-0">{cmd.order ?? i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <code className="block text-xs text-green-400 font-mono mb-1 break-all">{cmd.command}</code>
                      {cmd.description && <p className="text-[10px] text-gray-500">{cmd.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded border ${RISK_COLORS[cmd.risk] ?? RISK_COLORS.LOW}`}>
                        {RISK_LABELS[cmd.risk] ?? '낮음'}
                      </span>
                      <button
                        onClick={() => setExecModal({ nodeId: selectedId, command: cmd.command })}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-blue-600/20 border border-blue-600/30 text-blue-400 hover:bg-blue-600/30">
                        <Play className="w-3 h-3" /> 실행
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {execModal && (
        <ExecuteConfirmModal
          nodeId={execModal.nodeId}
          command={execModal.command}
          onConfirm={() => setExecModal(null)}
          onClose={() => setExecModal(null)}
        />
      )}
    </div>
  )
}
```

---

## Task 14: 라우팅 + Navbar + AiPanel 배선

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Navbar.jsx`
- Modify: `frontend/src/components/dashboard/AiPanel.jsx`

- [ ] **Step 1: App.jsx에 /ai-analysis 라우트 추가**

`App.jsx`에서 `import AuditLog from './pages/AuditLog'` 다음 줄에 추가:
```jsx
import AiAnalysis from './pages/AiAnalysis'
```

`<Routes>` 안 마지막 라우트 다음에 추가:
```jsx
<Route path="/ai-analysis" element={<AiAnalysis />} />
```

- [ ] **Step 2: Navbar.jsx에 /ai-analysis 타이틀 추가**

`PAGE_TITLES` 객체에 다음 항목 추가:
```js
'/ai-analysis': { title: 'AI 장애 분석', sub: 'AI가 에러 로그를 분석하고 수정 명령어를 제안합니다.' },
```

- [ ] **Step 3: AiPanel.jsx "더보기" 버튼을 navigate로 연결**

`AiPanel.jsx` 상단에 import 추가:
```jsx
import { useNavigate } from 'react-router-dom'
```

`AiPanel` 컴포넌트 내부 첫 줄에 추가:
```jsx
const navigate = useNavigate()
```

"더보기" 버튼의 `onClick`에 연결:
```jsx
<button
  onClick={() => navigate('/ai-analysis')}
  className="text-[10px] text-gray-500 hover:text-white py-2.5 px-2 min-h-[44px] flex items-center">
  더보기 →
</button>
```

- [ ] **Step 4: 프론트엔드 개발 서버 재시작 후 전체 동작 확인**

```bash
cd frontend && npm run dev
```

확인 항목:
- `/sw` 페이지에 "자동 스캔" 버튼 표시
- `/ai-analysis` 라우트 접근 가능 (빈 상태 화면)
- 대시보드 AI 패널 "더보기" 클릭 시 `/ai-analysis`로 이동
- 빌드 에러 없음

---

## 완료 기준

- [ ] Flyway V2 마이그레이션 성공 (`sw_process`, `ai_fault_analysis` 테이블 생성)
- [ ] `GET /api/sw/scan?nodeId=` — 캐시된 프로세스에서 Known SW 분류 반환
- [ ] `POST /api/sw/register` — 선택한 프로세스 DB 저장
- [ ] `POST /api/ai/analyze/{nodeId}` — Ollama 호출 → 결과 저장
- [ ] `GET /api/ai/analysis/{nodeId}` — 최신 분석 결과 반환
- [ ] `POST /api/agent/{nodeId}/execute` — 에이전트 포트 17001로 명령 전달
- [ ] 에이전트 메트릭 push 시 errorLogPreview 있으면 자동 AI 분석 비동기 실행
- [ ] `/sw` 페이지 스캔 모달 — Known/Unknown 분류, 수동 추가, 일괄 등록
- [ ] `/ai-analysis` 페이지 — 분석 결과 + 실행 버튼 + 확인 모달
- [ ] 대시보드 AI 패널 더보기 → `/ai-analysis` 이동
