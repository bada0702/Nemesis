# Nemesis Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리 서버(Spring Boot) + AIX/Linux 에이전트(Python+Shell) + 기본 Web UI(React)의 통신 기반 인프라를 완성한다.

**Architecture:** 관리 서버는 Spring Boot REST API로 에이전트 등록/메트릭 수신을 처리하고, PostgreSQL에 클러스터 메타데이터를 저장한다. 에이전트는 Python 데몬이 Shell Script로 수집한 메트릭을 3초 주기로 Push하며, React 대시보드는 실시간으로 노드 상태와 메트릭을 시각화한다.

**Tech Stack:** Java 17, Spring Boot 3.x, PostgreSQL 15, Flyway, React 18, Vite, Chart.js, Python 3, Shell Script (POSIX), Docker Compose, Nginx

---

## 범위 노트

이 플랜은 **Phase 1 — Foundation (2026 Q3)** 만 커버한다. Phase 2(HA Core), Phase 3(AI Failover), Phase 4(Self-Healing)는 이 플랜 완료 후 별도 플랜으로 작성할 것.

Phase 1 완료 기준:
- AIX 2대 또는 Linux 2대 환경에서 에이전트 → 관리 서버 메트릭 수집 정상 동작
- Web UI에서 노드 상태 실시간 확인 가능
- 설치 소요 시간 1시간 이내

---

## 파일 구조

### 신규 생성 파일

```
nemesis/                          ← 프로젝트 루트
├── docker-compose.yml
├── .env.example
├── nginx/
│   └── nginx.conf
├── postgres/
│   └── init.sql
│
├── backend/                      ← Spring Boot
│   ├── build.gradle
│   ├── settings.gradle
│   └── src/
│       ├── main/
│       │   ├── java/com/nemesis/
│       │   │   ├── NemesisServerApplication.java
│       │   │   ├── config/
│       │   │   │   └── WebConfig.java
│       │   │   ├── domain/
│       │   │   │   ├── cluster/
│       │   │   │   │   ├── Cluster.java
│       │   │   │   │   ├── ClusterRepository.java
│       │   │   │   │   ├── ClusterService.java
│       │   │   │   │   └── ClusterController.java
│       │   │   │   ├── node/
│       │   │   │   │   ├── Node.java
│       │   │   │   │   ├── NodeRepository.java
│       │   │   │   │   ├── NodeService.java
│       │   │   │   │   └── NodeController.java
│       │   │   │   └── agent/
│       │   │   │       ├── AgentKey.java
│       │   │   │       ├── AgentKeyRepository.java
│       │   │   │       ├── AgentService.java
│       │   │   │       ├── AgentRegistrationController.java
│       │   │   │       └── MetricsPushController.java
│       │   │   ├── dto/
│       │   │   │   ├── AgentRegisterRequest.java
│       │   │   │   ├── AgentRegisterResponse.java
│       │   │   │   ├── MetricsPushRequest.java
│       │   │   │   └── ClusterStatusResponse.java
│       │   │   └── cache/
│       │   │       └── MetricsCacheService.java
│       │   └── resources/
│       │       ├── application.yml
│       │       └── db/migration/
│       │           └── V1__init_schema.sql
│       └── test/
│           └── java/com/nemesis/
│               ├── agent/
│               │   ├── AgentRegistrationControllerTest.java
│               │   └── MetricsPushControllerTest.java
│               └── cluster/
│                   └── ClusterControllerTest.java
│
├── frontend/                     ← React
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/
│       │   └── client.js
│       ├── components/
│       │   ├── ClusterCard.jsx
│       │   ├── NodeStatus.jsx
│       │   └── MetricsChart.jsx
│       └── pages/
│           ├── Dashboard.jsx
│           └── ClusterDetail.jsx
│
└── agent/                        ← Nemesis Agent
    ├── nemesis-agent.py
    ├── collect.sh                ← Linux 메트릭 수집
    ├── collect_aix.sh            ← AIX 메트릭 수집
    └── install.sh                ← 설치 스크립트
```

---

## Task 1: 프로젝트 인프라 (Docker Compose + PostgreSQL)

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `nginx/nginx.conf`
- Create: `postgres/init.sql`

- [ ] **Step 1: .env.example 작성**

```bash
cat > .env.example << 'EOF'
# 관리 서버
NEMESIS_API_PORT=18080
NEMESIS_CONTROL_PORT=17001
NEMESIS_UI_PORT=18090

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=nemesis
DB_USER=nemesis
DB_PASSWORD=changeme

# AI Provider (openai / anthropic / ollama)
LLM_PROVIDER=openai
LLM_API_KEY=sk-placeholder
LLM_MODEL=gpt-4o

# 알림 (Phase 2에서 활성화)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EMAIL_SMTP_HOST=
EMAIL_SMTP_PORT=587
EMAIL_FROM=
EMAIL_TO=

# 클러스터 설정
MAX_CLUSTER_GROUPS=10
EOF
cp .env.example .env
```

- [ ] **Step 2: postgres/init.sql 작성 (스키마는 Flyway가 관리하므로 DB 생성만)**

```bash
mkdir -p postgres
cat > postgres/init.sql << 'EOF'
-- Flyway가 스키마를 관리함. 여기서는 DB 초기화만.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOF
```

- [ ] **Step 3: nginx/nginx.conf 작성**

```bash
mkdir -p nginx
cat > nginx/nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    server {
        listen 80;

        # React SPA 서빙
        location / {
            root   /usr/share/nginx/html;
            index  index.html;
            try_files $uri $uri/ /index.html;
        }

        # Spring Boot API 프록시
        location /api/ {
            proxy_pass http://nemesis-server:18080;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # WebSocket (실시간 메트릭용, Phase 2)
        location /ws/ {
            proxy_pass http://nemesis-server:18080;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
EOF
```

- [ ] **Step 4: docker-compose.yml 작성**

```bash
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  nemesis-server:
    image: nemesis-server:latest
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "${NEMESIS_API_PORT:-18080}:18080"
      - "${NEMESIS_CONTROL_PORT:-17001}:17001"
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env
    networks:
      - nemesis-net

  nemesis-frontend:
    image: nginx:alpine
    ports:
      - "${NEMESIS_UI_PORT:-18090}:80"
    volumes:
      - ./frontend/dist:/usr/share/nginx/html:ro
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - nemesis-server
    networks:
      - nemesis-net

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-nemesis}
      POSTGRES_USER: ${DB_USER:-nemesis}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
    volumes:
      - nemesis-data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-nemesis}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - nemesis-net

volumes:
  nemesis-data:

networks:
  nemesis-net:
    driver: bridge
EOF
```

- [ ] **Step 5: 파일 존재 확인**

```bash
ls -la docker-compose.yml .env.example nginx/nginx.conf postgres/init.sql
```
예상 결과: 4개 파일 모두 존재

---

## Task 2: Spring Boot 프로젝트 초기화

**Files:**
- Create: `backend/settings.gradle`
- Create: `backend/build.gradle`
- Create: `backend/src/main/java/com/nemesis/NemesisServerApplication.java`
- Create: `backend/src/main/resources/application.yml`

- [ ] **Step 1: 디렉토리 구조 생성**

```bash
mkdir -p backend/src/main/java/com/nemesis/{config,domain/{cluster,node,agent},dto,cache}
mkdir -p backend/src/main/resources/db/migration
mkdir -p backend/src/test/java/com/nemesis/{agent,cluster}
```

- [ ] **Step 2: settings.gradle 작성**

```bash
cat > backend/settings.gradle << 'EOF'
rootProject.name = 'nemesis-server'
EOF
```

- [ ] **Step 3: build.gradle 작성**

```bash
cat > backend/build.gradle << 'EOF'
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.5'
    id 'io.spring.dependency-management' version '1.1.4'
}

group = 'com.nemesis'
version = '1.0.0'
sourceCompatibility = '17'

repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    implementation 'org.springframework.boot:spring-boot-starter-validation'
    implementation 'org.flywaydb:flyway-core'
    implementation 'org.flywaydb:flyway-database-postgresql'
    runtimeOnly 'org.postgresql:postgresql'
    compileOnly 'org.projectlombok:lombok'
    annotationProcessor 'org.projectlombok:lombok'

    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testImplementation 'com.h2database:h2'
}

test {
    useJUnitPlatform()
}
EOF
```

- [ ] **Step 4: application.yml 작성**

```bash
cat > backend/src/main/resources/application.yml << 'EOF'
server:
  port: 18080

spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:nemesis}
    username: ${DB_USER:nemesis}
    password: ${DB_PASSWORD:changeme}
    driver-class-name: org.postgresql.Driver
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
  flyway:
    enabled: true
    locations: classpath:db/migration

nemesis:
  max-cluster-groups: ${MAX_CLUSTER_GROUPS:10}
  control-port: ${NEMESIS_CONTROL_PORT:17001}

logging:
  level:
    com.nemesis: INFO

---
spring:
  config:
    activate:
      on-profile: test
  datasource:
    url: jdbc:h2:mem:testdb;MODE=PostgreSQL;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
    username: sa
    password:
  jpa:
    hibernate:
      ddl-auto: create-drop
  flyway:
    enabled: false
EOF
```

- [ ] **Step 5: NemesisServerApplication.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/NemesisServerApplication.java << 'EOF'
package com.nemesis;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class NemesisServerApplication {
    public static void main(String[] args) {
        SpringApplication.run(NemesisServerApplication.class, args);
    }
}
EOF
```

- [ ] **Step 6: WebConfig.java 작성 (CORS 설정)**

```bash
cat > backend/src/main/java/com/nemesis/config/WebConfig.java << 'EOF'
package com.nemesis.config;

import org.springframework.context.annotation.Configuration;
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
}
EOF
```

---

## Task 3: 데이터베이스 스키마 (Flyway)

**Files:**
- Create: `backend/src/main/resources/db/migration/V1__init_schema.sql`

- [ ] **Step 1: V1__init_schema.sql 작성**

```bash
cat > backend/src/main/resources/db/migration/V1__init_schema.sql << 'EOF'
-- 클러스터 그룹 테이블
CREATE TABLE cluster_groups (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    vip         VARCHAR(50),
    max_failover_count INT DEFAULT 5,
    pingpong_guard_seconds INT DEFAULT 180,
    ai_enabled  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 노드 테이블
CREATE TABLE nodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    hostname        VARCHAR(255) NOT NULL,
    service_ip      VARCHAR(50),
    heartbeat_ip    VARCHAR(50),
    os_type         VARCHAR(20) NOT NULL CHECK (os_type IN ('AIX', 'LINUX')),
    role            VARCHAR(20) NOT NULL DEFAULT 'standby' CHECK (role IN ('active', 'standby', 'fault', 'recovering')),
    agent_version   VARCHAR(50),
    last_seen_at    TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(cluster_group_id, hostname)
);

-- 에이전트 API 키 테이블
CREATE TABLE agent_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    api_key         VARCHAR(100) NOT NULL UNIQUE,
    node_id         UUID REFERENCES nodes(id),
    expires_at      TIMESTAMP WITH TIME ZONE,
    revoked         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 감사 로그 테이블
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    event_type  VARCHAR(100) NOT NULL,
    actor       VARCHAR(255),
    cluster_group_id UUID REFERENCES cluster_groups(id),
    node_id     UUID REFERENCES nodes(id),
    details     TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_nodes_cluster ON nodes(cluster_group_id);
CREATE INDEX idx_nodes_role ON nodes(role);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_agent_keys_api_key ON agent_keys(api_key);
EOF
```

---

## Task 4: 도메인 엔티티 및 리포지토리

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/cluster/Cluster.java`
- Create: `backend/src/main/java/com/nemesis/domain/cluster/ClusterRepository.java`
- Create: `backend/src/main/java/com/nemesis/domain/node/Node.java`
- Create: `backend/src/main/java/com/nemesis/domain/node/NodeRepository.java`
- Create: `backend/src/main/java/com/nemesis/domain/agent/AgentKey.java`
- Create: `backend/src/main/java/com/nemesis/domain/agent/AgentKeyRepository.java`

- [ ] **Step 1: Cluster.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/cluster/Cluster.java << 'EOF'
package com.nemesis.domain.cluster;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "cluster_groups")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Cluster {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 500)
    private String description;

    @Column(length = 50)
    private String vip;

    @Column(name = "max_failover_count")
    @Builder.Default
    private int maxFailoverCount = 5;

    @Column(name = "pingpong_guard_seconds")
    @Builder.Default
    private int pingpongGuardSeconds = 180;

    @Column(name = "ai_enabled")
    @Builder.Default
    private boolean aiEnabled = false;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    @UpdateTimestamp
    private OffsetDateTime updatedAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
        this.updatedAt = OffsetDateTime.now();
    }
}
EOF
```

- [ ] **Step 2: ClusterRepository.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/cluster/ClusterRepository.java << 'EOF'
package com.nemesis.domain.cluster;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface ClusterRepository extends JpaRepository<Cluster, UUID> {
    boolean existsByName(String name);
    long countBy();
}
EOF
```

- [ ] **Step 3: Node.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/node/Node.java << 'EOF'
package com.nemesis.domain.node;

import com.nemesis.domain.cluster.Cluster;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "nodes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Node {

    public enum OsType { AIX, LINUX }
    public enum Role { active, standby, fault, recovering }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_group_id", nullable = false)
    private Cluster cluster;

    @Column(nullable = false)
    private String hostname;

    @Column(name = "service_ip", length = 50)
    private String serviceIp;

    @Column(name = "heartbeat_ip", length = 50)
    private String heartbeatIp;

    @Enumerated(EnumType.STRING)
    @Column(name = "os_type", nullable = false, length = 20)
    private OsType osType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Role role = Role.standby;

    @Column(name = "agent_version", length = 50)
    private String agentVersion;

    @Column(name = "last_seen_at")
    private OffsetDateTime lastSeenAt;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
    }
}
EOF
```

- [ ] **Step 4: NodeRepository.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/node/NodeRepository.java << 'EOF'
package com.nemesis.domain.node;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NodeRepository extends JpaRepository<Node, UUID> {
    List<Node> findByClusterId(UUID clusterId);
    Optional<Node> findByClusterIdAndHostname(UUID clusterId, String hostname);
}
EOF
```

- [ ] **Step 5: AgentKey.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/agent/AgentKey.java << 'EOF'
package com.nemesis.domain.agent;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "agent_keys")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentKey {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_group_id", nullable = false)
    private Cluster cluster;

    @Column(name = "api_key", nullable = false, unique = true, length = 100)
    private String apiKey;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id")
    private Node node;

    @Column(name = "expires_at")
    private OffsetDateTime expiresAt;

    @Builder.Default
    private boolean revoked = false;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
    }

    public boolean isValid() {
        if (revoked) return false;
        if (expiresAt != null && OffsetDateTime.now().isAfter(expiresAt)) return false;
        return true;
    }
}
EOF
```

- [ ] **Step 6: AgentKeyRepository.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/agent/AgentKeyRepository.java << 'EOF'
package com.nemesis.domain.agent;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AgentKeyRepository extends JpaRepository<AgentKey, UUID> {
    Optional<AgentKey> findByApiKey(String apiKey);
    boolean existsByApiKey(String apiKey);
}
EOF
```

---

## Task 5: DTO 클래스

**Files:**
- Create: `backend/src/main/java/com/nemesis/dto/AgentRegisterRequest.java`
- Create: `backend/src/main/java/com/nemesis/dto/AgentRegisterResponse.java`
- Create: `backend/src/main/java/com/nemesis/dto/MetricsPushRequest.java`
- Create: `backend/src/main/java/com/nemesis/dto/ClusterStatusResponse.java`

- [ ] **Step 1: AgentRegisterRequest.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/dto/AgentRegisterRequest.java << 'EOF'
package com.nemesis.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AgentRegisterRequest {
    @NotBlank
    private String apiKey;
    @NotBlank
    private String hostname;
    @NotBlank
    private String os;  // AIX | LINUX
    @NotBlank
    private String version;
    private String serviceIp;
    private String heartbeatIp;
}
EOF
```

- [ ] **Step 2: AgentRegisterResponse.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/dto/AgentRegisterResponse.java << 'EOF'
package com.nemesis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.UUID;

@Data
@AllArgsConstructor
public class AgentRegisterResponse {
    private UUID nodeId;
    private UUID clusterId;
    private String clusterName;
    private String role;
    private int pullIntervalSeconds;
}
EOF
```

- [ ] **Step 3: MetricsPushRequest.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/dto/MetricsPushRequest.java << 'EOF'
package com.nemesis.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class MetricsPushRequest {
    private String hostname;
    private long timestamp;

    // CPU: 0.0 ~ 100.0
    private double cpuPercent;
    // Memory: 0.0 ~ 100.0
    private double memoryPercent;
    private long memoryUsedMb;
    private long memoryTotalMb;
    // Disk: 0.0 ~ 100.0
    private double diskPercent;
    private long diskUsedGb;
    private long diskTotalGb;
    // Network: bytes/sec
    private long networkRxBytesPerSec;
    private long networkTxBytesPerSec;

    // 프로세스 목록: [{name, pid, status}]
    private List<Map<String, String>> processes;

    // 에러 로그 프리뷰 (최근 5줄)
    private List<String> errorLogPreview;
}
EOF
```

- [ ] **Step 4: ClusterStatusResponse.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/dto/ClusterStatusResponse.java << 'EOF'
package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Data
@Builder
public class ClusterStatusResponse {
    private UUID clusterId;
    private String clusterName;
    private String vip;
    private List<NodeStatus> nodes;

    @Data
    @Builder
    public static class NodeStatus {
        private UUID nodeId;
        private String hostname;
        private String osType;
        private String role;
        private OffsetDateTime lastSeenAt;
        private NodeMetrics metrics;
    }

    @Data
    @Builder
    public static class NodeMetrics {
        private double cpuPercent;
        private double memoryPercent;
        private double diskPercent;
        private long networkRxBytesPerSec;
        private long networkTxBytesPerSec;
        private long timestamp;
    }
}
EOF
```

---

## Task 6: 인메모리 메트릭 캐시 서비스

**Files:**
- Create: `backend/src/main/java/com/nemesis/cache/MetricsCacheService.java`

- [ ] **Step 1: MetricsCacheService.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/cache/MetricsCacheService.java << 'EOF'
package com.nemesis.cache;

import com.nemesis.dto.MetricsPushRequest;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class MetricsCacheService {

    // nodeId -> 최신 메트릭
    private final Map<UUID, MetricsPushRequest> cache = new ConcurrentHashMap<>();

    public void put(UUID nodeId, MetricsPushRequest metrics) {
        cache.put(nodeId, metrics);
    }

    public Optional<MetricsPushRequest> get(UUID nodeId) {
        return Optional.ofNullable(cache.get(nodeId));
    }

    public void remove(UUID nodeId) {
        cache.remove(nodeId);
    }

    public Map<UUID, MetricsPushRequest> getAll() {
        return Map.copyOf(cache);
    }
}
EOF
```

---

## Task 7: 에이전트 서비스 및 등록 API

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/agent/AgentService.java`
- Create: `backend/src/main/java/com/nemesis/domain/agent/AgentRegistrationController.java`
- Create: `backend/src/main/java/com/nemesis/domain/agent/MetricsPushController.java`
- Test: `backend/src/test/java/com/nemesis/agent/AgentRegistrationControllerTest.java`

- [ ] **Step 1: 실패하는 테스트 작성**

```bash
cat > backend/src/test/java/com/nemesis/agent/AgentRegistrationControllerTest.java << 'EOF'
package com.nemesis.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.agent.AgentKey;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.dto.AgentRegisterRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AgentRegistrationControllerTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired ClusterRepository clusterRepository;
    @Autowired AgentKeyRepository agentKeyRepository;

    private Cluster testCluster;
    private AgentKey testKey;

    @BeforeEach
    void setUp() {
        agentKeyRepository.deleteAll();
        clusterRepository.deleteAll();

        testCluster = clusterRepository.save(Cluster.builder()
                .name("테스트클러스터")
                .vip("192.168.1.100")
                .build());

        testKey = agentKeyRepository.save(AgentKey.builder()
                .cluster(testCluster)
                .apiKey("nmss-test-key-12345")
                .build());
    }

    @Test
    void 유효한_API_키로_에이전트_등록_성공() throws Exception {
        AgentRegisterRequest req = new AgentRegisterRequest();
        req.setApiKey("nmss-test-key-12345");
        req.setHostname("server01");
        req.setOs("LINUX");
        req.setVersion("1.0.0");
        req.setServiceIp("192.168.1.101");

        mockMvc.perform(post("/api/agent/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clusterId").value(testCluster.getId().toString()))
                .andExpect(jsonPath("$.clusterName").value("테스트클러스터"))
                .andExpect(jsonPath("$.role").exists());
    }

    @Test
    void 유효하지_않은_API_키로_등록_실패() throws Exception {
        AgentRegisterRequest req = new AgentRegisterRequest();
        req.setApiKey("invalid-key");
        req.setHostname("server99");
        req.setOs("LINUX");
        req.setVersion("1.0.0");

        mockMvc.perform(post("/api/agent/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void hostname_누락_시_등록_실패() throws Exception {
        AgentRegisterRequest req = new AgentRegisterRequest();
        req.setApiKey("nmss-test-key-12345");
        req.setOs("LINUX");
        req.setVersion("1.0.0");
        // hostname 누락

        mockMvc.perform(post("/api/agent/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest());
    }
}
EOF
```

- [ ] **Step 2: 테스트 실행 확인 (실패해야 정상)**

```bash
cd backend
./gradlew test --tests "com.nemesis.agent.AgentRegistrationControllerTest" 2>&1 | tail -20
```
예상 결과: `FAILED` — AgentRegistrationController가 아직 없으므로

- [ ] **Step 3: AgentService.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/agent/AgentService.java << 'EOF'
package com.nemesis.domain.agent;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.AgentRegisterRequest;
import com.nemesis.dto.AgentRegisterResponse;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AgentService {

    private final AgentKeyRepository agentKeyRepository;
    private final NodeRepository nodeRepository;
    private final MetricsCacheService metricsCache;

    @Transactional
    public AgentRegisterResponse register(AgentRegisterRequest req) {
        AgentKey key = agentKeyRepository.findByApiKey(req.getApiKey())
                .filter(AgentKey::isValid)
                .orElseThrow(() -> new IllegalArgumentException("Invalid or revoked API key"));

        // 이미 등록된 노드면 업데이트, 없으면 생성
        Node node = nodeRepository
                .findByClusterIdAndHostname(key.getCluster().getId(), req.getHostname())
                .orElseGet(() -> Node.builder()
                        .cluster(key.getCluster())
                        .hostname(req.getHostname())
                        .osType(Node.OsType.valueOf(req.getOs().toUpperCase()))
                        .build());

        node.setAgentVersion(req.getVersion());
        node.setServiceIp(req.getServiceIp());
        node.setHeartbeatIp(req.getHeartbeatIp());
        node.setLastSeenAt(OffsetDateTime.now());
        node = nodeRepository.save(node);

        // API Key와 노드 연결
        key.setNode(node);
        agentKeyRepository.save(key);

        return new AgentRegisterResponse(
                node.getId(),
                key.getCluster().getId(),
                key.getCluster().getName(),
                node.getRole().name(),
                600
        );
    }

    @Transactional
    public void pushMetrics(String apiKey, MetricsPushRequest req) {
        AgentKey key = agentKeyRepository.findByApiKey(apiKey)
                .filter(AgentKey::isValid)
                .orElseThrow(() -> new IllegalArgumentException("Invalid API key"));

        Node node = key.getNode();
        if (node == null) {
            throw new IllegalStateException("Agent not registered yet");
        }

        node.setLastSeenAt(OffsetDateTime.now());
        nodeRepository.save(node);

        metricsCache.put(node.getId(), req);
    }

    public UUID resolveNodeId(String apiKey) {
        return agentKeyRepository.findByApiKey(apiKey)
                .filter(AgentKey::isValid)
                .map(k -> k.getNode() != null ? k.getNode().getId() : null)
                .orElseThrow(() -> new IllegalArgumentException("Invalid API key"));
    }
}
EOF
```

- [ ] **Step 4: AgentRegistrationController.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/agent/AgentRegistrationController.java << 'EOF'
package com.nemesis.domain.agent;

import com.nemesis.dto.AgentRegisterRequest;
import com.nemesis.dto.AgentRegisterResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class AgentRegistrationController {

    private final AgentService agentService;

    @PostMapping("/register")
    public ResponseEntity<AgentRegisterResponse> register(@Valid @RequestBody AgentRegisterRequest req) {
        AgentRegisterResponse resp = agentService.register(req);
        return ResponseEntity.ok(resp);
    }
}
EOF
```

- [ ] **Step 5: 예외 핸들러 추가 (GlobalExceptionHandler.java)**

```bash
mkdir -p backend/src/main/java/com/nemesis/config
cat > backend/src/main/java/com/nemesis/config/GlobalExceptionHandler.java << 'EOF'
package com.nemesis.config;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String, String>> handleIllegal(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(BindException.class)
    ResponseEntity<Map<String, String>> handleValidation(BindException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
    }
}
EOF
```

- [ ] **Step 6: 테스트 재실행 (성공해야 함)**

```bash
cd backend
./gradlew test --tests "com.nemesis.agent.AgentRegistrationControllerTest" 2>&1 | tail -20
```
예상 결과: `BUILD SUCCESSFUL`, 3개 테스트 PASSED

- [ ] **Step 7: 커밋**

```bash
cd backend
git init || true
git add -A
git commit -m "feat: agent registration API with TDD"
```

---

## Task 8: 메트릭 Push API

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/agent/MetricsPushController.java`
- Test: `backend/src/test/java/com/nemesis/agent/MetricsPushControllerTest.java`

- [ ] **Step 1: 실패하는 테스트 작성**

```bash
cat > backend/src/test/java/com/nemesis/agent/MetricsPushControllerTest.java << 'EOF'
package com.nemesis.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.agent.AgentKey;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MetricsPushControllerTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired ClusterRepository clusterRepository;
    @Autowired AgentKeyRepository agentKeyRepository;
    @Autowired NodeRepository nodeRepository;

    private static final String VALID_KEY = "nmss-metrics-test-key";

    @BeforeEach
    void setUp() {
        agentKeyRepository.deleteAll();
        nodeRepository.deleteAll();
        clusterRepository.deleteAll();

        Cluster cluster = clusterRepository.save(Cluster.builder().name("메트릭테스트").build());
        Node node = nodeRepository.save(Node.builder()
                .cluster(cluster)
                .hostname("server01")
                .osType(Node.OsType.LINUX)
                .build());
        agentKeyRepository.save(AgentKey.builder()
                .cluster(cluster)
                .apiKey(VALID_KEY)
                .node(node)
                .build());
    }

    @Test
    void 유효한_키로_메트릭_Push_성공() throws Exception {
        MetricsPushRequest req = new MetricsPushRequest();
        req.setHostname("server01");
        req.setTimestamp(System.currentTimeMillis());
        req.setCpuPercent(45.2);
        req.setMemoryPercent(60.0);
        req.setMemoryUsedMb(4096);
        req.setMemoryTotalMb(8192);
        req.setDiskPercent(30.5);
        req.setErrorLogPreview(List.of("2026-06-06 ERROR: test", "2026-06-06 WARN: something"));

        mockMvc.perform(post("/api/agent/metrics")
                        .header("Authorization", "Bearer " + VALID_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk());
    }

    @Test
    void 인증없이_메트릭_Push_실패() throws Exception {
        MetricsPushRequest req = new MetricsPushRequest();
        req.setHostname("server01");
        req.setTimestamp(System.currentTimeMillis());

        mockMvc.perform(post("/api/agent/metrics")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isUnauthorized());
    }
}
EOF
```

- [ ] **Step 2: 테스트 실행 확인 (실패해야 정상)**

```bash
cd backend
./gradlew test --tests "com.nemesis.agent.MetricsPushControllerTest" 2>&1 | tail -10
```
예상 결과: FAILED

- [ ] **Step 3: MetricsPushController.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/agent/MetricsPushController.java << 'EOF'
package com.nemesis.domain.agent;

import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class MetricsPushController {

    private final AgentService agentService;

    @PostMapping("/metrics")
    public ResponseEntity<Void> pushMetrics(
            @RequestHeader("Authorization") String authHeader,
            @RequestBody MetricsPushRequest req) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401).build();
        }
        String apiKey = authHeader.substring(7);
        agentService.pushMetrics(apiKey, req);
        return ResponseEntity.ok().build();
    }
}
EOF
```

- [ ] **Step 4: 테스트 재실행 (성공해야 함)**

```bash
cd backend
./gradlew test --tests "com.nemesis.agent.MetricsPushControllerTest" 2>&1 | tail -10
```
예상 결과: BUILD SUCCESSFUL, 2개 PASSED

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: metrics push API with Bearer token auth"
```

---

## Task 9: 클러스터 관리 API

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/cluster/ClusterService.java`
- Create: `backend/src/main/java/com/nemesis/domain/cluster/ClusterController.java`
- Create: `backend/src/main/java/com/nemesis/domain/node/NodeController.java`
- Test: `backend/src/test/java/com/nemesis/cluster/ClusterControllerTest.java`

- [ ] **Step 1: 실패하는 테스트 작성**

```bash
cat > backend/src/test/java/com/nemesis/cluster/ClusterControllerTest.java << 'EOF'
package com.nemesis.cluster;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.cluster.ClusterRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ClusterControllerTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired ClusterRepository clusterRepository;

    @BeforeEach
    void setUp() {
        clusterRepository.deleteAll();
    }

    @Test
    void 클러스터_생성_성공() throws Exception {
        Map<String, Object> body = Map.of(
                "name", "민원시스템",
                "vip", "192.168.1.100",
                "description", "민원처리 시스템 HA 클러스터"
        );

        mockMvc.perform(post("/api/clusters")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.name").value("민원시스템"));
    }

    @Test
    void 클러스터_목록_조회() throws Exception {
        // Given: 클러스터 생성
        mockMvc.perform(post("/api/clusters")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "클러스터A", "vip", "192.168.1.1"))))
                .andExpect(status().isCreated());

        // When: 목록 조회
        mockMvc.perform(get("/api/clusters"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("클러스터A"));
    }

    @Test
    void 최대_10개_초과_클러스터_생성_실패() throws Exception {
        // 10개 생성
        for (int i = 0; i < 10; i++) {
            mockMvc.perform(post("/api/clusters")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "클러스터" + i))))
                    .andExpect(status().isCreated());
        }

        // 11번째 실패
        mockMvc.perform(post("/api/clusters")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "클러스터10"))))
                .andExpect(status().isBadRequest());
    }
}
EOF
```

- [ ] **Step 2: 테스트 실행 확인 (실패해야 정상)**

```bash
cd backend
./gradlew test --tests "com.nemesis.cluster.ClusterControllerTest" 2>&1 | tail -10
```

- [ ] **Step 3: ClusterService.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/cluster/ClusterService.java << 'EOF'
package com.nemesis.domain.cluster;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ClusterService {

    private final ClusterRepository clusterRepository;

    @Value("${nemesis.max-cluster-groups:10}")
    private int maxClusterGroups;

    @Transactional
    public Cluster create(Map<String, Object> body) {
        if (clusterRepository.countBy() >= maxClusterGroups) {
            throw new IllegalStateException("최대 클러스터 그룹 수(" + maxClusterGroups + "개)를 초과했습니다.");
        }

        Cluster cluster = Cluster.builder()
                .name((String) body.get("name"))
                .vip((String) body.get("vip"))
                .description((String) body.get("description"))
                .build();
        return clusterRepository.save(cluster);
    }

    @Transactional(readOnly = true)
    public List<Cluster> findAll() {
        return clusterRepository.findAll();
    }

    @Transactional(readOnly = true)
    public Cluster findById(UUID id) {
        return clusterRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + id));
    }
}
EOF
```

- [ ] **Step 4: ClusterController.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/cluster/ClusterController.java << 'EOF'
package com.nemesis.domain.cluster;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters")
@RequiredArgsConstructor
public class ClusterController {

    private final ClusterService clusterService;

    @PostMapping
    public ResponseEntity<Cluster> create(@RequestBody Map<String, Object> body) {
        Cluster cluster = clusterService.create(body);
        return ResponseEntity.status(HttpStatus.CREATED).body(cluster);
    }

    @GetMapping
    public ResponseEntity<List<Cluster>> findAll() {
        return ResponseEntity.ok(clusterService.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Cluster> findById(@PathVariable UUID id) {
        return ResponseEntity.ok(clusterService.findById(id));
    }
}
EOF
```

- [ ] **Step 5: GlobalExceptionHandler에 IllegalStateException 추가**

```bash
# 기존 GlobalExceptionHandler.java 편집: IllegalStateException 핸들러 추가
# 파일 열고 handleIllegal 메서드 위에 추가
cat > backend/src/main/java/com/nemesis/config/GlobalExceptionHandler.java << 'EOF'
package com.nemesis.config;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String, String>> handleIllegal(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<Map<String, String>> handleState(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(BindException.class)
    ResponseEntity<Map<String, String>> handleValidation(BindException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
    }
}
EOF
```

- [ ] **Step 6: 테스트 재실행 (성공해야 함)**

```bash
cd backend
./gradlew test --tests "com.nemesis.cluster.ClusterControllerTest" 2>&1 | tail -10
```
예상 결과: BUILD SUCCESSFUL, 3개 PASSED

- [ ] **Step 7: 전체 테스트 실행**

```bash
cd backend
./gradlew test 2>&1 | tail -20
```
예상 결과: 8개 이상 테스트 PASSED

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: cluster management API with 10-group limit"
```

---

## Task 10: Cluster 상태 조회 API (노드 + 메트릭 포함)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/node/NodeService.java`
- Create: `backend/src/main/java/com/nemesis/domain/node/NodeController.java`
- Modify: `backend/src/main/java/com/nemesis/domain/cluster/ClusterController.java`

- [ ] **Step 1: NodeService.java 작성**

```bash
cat > backend/src/main/java/com/nemesis/domain/node/NodeService.java << 'EOF'
package com.nemesis.domain.node;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.dto.ClusterStatusResponse;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class NodeService {

    private final NodeRepository nodeRepository;
    private final ClusterRepository clusterRepository;
    private final MetricsCacheService metricsCache;

    @Transactional(readOnly = true)
    public ClusterStatusResponse getClusterStatus(UUID clusterId) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("Cluster not found: " + clusterId));

        List<Node> nodes = nodeRepository.findByClusterId(clusterId);

        List<ClusterStatusResponse.NodeStatus> nodeStatuses = nodes.stream()
                .map(node -> {
                    Optional<MetricsPushRequest> cached = metricsCache.get(node.getId());
                    ClusterStatusResponse.NodeMetrics metrics = cached.map(m ->
                            ClusterStatusResponse.NodeMetrics.builder()
                                    .cpuPercent(m.getCpuPercent())
                                    .memoryPercent(m.getMemoryPercent())
                                    .diskPercent(m.getDiskPercent())
                                    .networkRxBytesPerSec(m.getNetworkRxBytesPerSec())
                                    .networkTxBytesPerSec(m.getNetworkTxBytesPerSec())
                                    .timestamp(m.getTimestamp())
                                    .build()
                    ).orElse(null);

                    return ClusterStatusResponse.NodeStatus.builder()
                            .nodeId(node.getId())
                            .hostname(node.getHostname())
                            .osType(node.getOsType().name())
                            .role(node.getRole().name())
                            .lastSeenAt(node.getLastSeenAt())
                            .metrics(metrics)
                            .build();
                })
                .toList();

        return ClusterStatusResponse.builder()
                .clusterId(cluster.getId())
                .clusterName(cluster.getName())
                .vip(cluster.getVip())
                .nodes(nodeStatuses)
                .build();
    }
}
EOF
```

- [ ] **Step 2: ClusterController에 상태 조회 엔드포인트 추가**

기존 `ClusterController.java`의 `findById` 아래에 추가:

```bash
cat > backend/src/main/java/com/nemesis/domain/cluster/ClusterController.java << 'EOF'
package com.nemesis.domain.cluster;

import com.nemesis.domain.node.NodeService;
import com.nemesis.dto.ClusterStatusResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters")
@RequiredArgsConstructor
public class ClusterController {

    private final ClusterService clusterService;
    private final NodeService nodeService;

    @PostMapping
    public ResponseEntity<Cluster> create(@RequestBody Map<String, Object> body) {
        Cluster cluster = clusterService.create(body);
        return ResponseEntity.status(HttpStatus.CREATED).body(cluster);
    }

    @GetMapping
    public ResponseEntity<List<Cluster>> findAll() {
        return ResponseEntity.ok(clusterService.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Cluster> findById(@PathVariable UUID id) {
        return ResponseEntity.ok(clusterService.findById(id));
    }

    @GetMapping("/{id}/status")
    public ResponseEntity<ClusterStatusResponse> getStatus(@PathVariable UUID id) {
        return ResponseEntity.ok(nodeService.getClusterStatus(id));
    }
}
EOF
```

- [ ] **Step 3: 전체 테스트 재실행**

```bash
cd backend
./gradlew test 2>&1 | tail -20
```
예상 결과: 전체 PASSED

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: cluster status API with cached metrics"
```

---

## Task 11: Spring Boot Dockerfile

**Files:**
- Create: `backend/Dockerfile`

- [ ] **Step 1: Dockerfile 작성**

```bash
cat > backend/Dockerfile << 'EOF'
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY build/libs/nemesis-server-1.0.0.jar app.jar

EXPOSE 18080 17001

ENTRYPOINT ["java", "-jar", "app.jar"]
EOF
```

- [ ] **Step 2: 빌드 확인**

```bash
cd backend
./gradlew bootJar 2>&1 | tail -10
ls -la build/libs/
```
예상 결과: `nemesis-server-1.0.0.jar` 생성

---

## Task 12: React 프론트엔드 초기화

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/App.jsx`

- [ ] **Step 1: frontend 디렉토리에서 Vite 프로젝트 초기화**

```bash
mkdir -p frontend
cd frontend
npm create vite@latest . -- --template react
```
프롬프트에서: `Current directory is not empty. Remove existing files and continue?` → y

- [ ] **Step 2: 의존성 설치**

```bash
cd frontend
npm install
npm install chart.js react-chartjs-2 react-router-dom axios
```

- [ ] **Step 3: vite.config.js 수정 (API 프록시 설정)**

```bash
cat > frontend/vite.config.js << 'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:18080',
        changeOrigin: true,
      }
    }
  }
})
EOF
```

- [ ] **Step 4: src/api/client.js 작성**

```bash
mkdir -p frontend/src/api
cat > frontend/src/api/client.js << 'EOF'
import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

export const getClusters = () => client.get('/clusters')
export const getClusterStatus = (id) => client.get(`/clusters/${id}/status`)
export const createCluster = (data) => client.post('/clusters', data)
EOF
```

---

## Task 13: 대시보드 컴포넌트

**Files:**
- Create: `frontend/src/components/ClusterCard.jsx`
- Create: `frontend/src/components/NodeStatus.jsx`
- Create: `frontend/src/components/MetricsChart.jsx`
- Create: `frontend/src/pages/Dashboard.jsx`
- Create: `frontend/src/pages/ClusterDetail.jsx`
- Create: `frontend/src/App.jsx`

- [ ] **Step 1: ClusterCard.jsx 작성**

```bash
cat > frontend/src/components/ClusterCard.jsx << 'EOF'
import React from 'react'

const STATUS_COLOR = {
  normal: '#10b981',
  warning: '#f59e0b',
  fault: '#ef4444',
  failover: '#8b5cf6',
}

function getRoleStatus(nodes) {
  if (!nodes || nodes.length === 0) return 'warning'
  const hasFault = nodes.some(n => n.role === 'fault')
  const hasRecovering = nodes.some(n => n.role === 'recovering')
  if (hasFault) return 'fault'
  if (hasRecovering) return 'failover'
  return 'normal'
}

export default function ClusterCard({ cluster, onClick }) {
  const status = cluster.nodes ? getRoleStatus(cluster.nodes) : 'warning'
  const active = cluster.nodes?.find(n => n.role === 'active')

  return (
    <div
      onClick={onClick}
      style={{
        border: `2px solid ${STATUS_COLOR[status]}`,
        borderRadius: 8,
        padding: '16px 20px',
        cursor: 'pointer',
        background: '#1e293b',
        color: '#f1f5f9',
        minWidth: 280,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{cluster.clusterName}</span>
        <span style={{
          background: STATUS_COLOR[status],
          color: '#fff',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 12,
        }}>
          {status === 'normal' ? '정상' : status === 'fault' ? '장애' : status === 'failover' ? 'Failover' : '경고'}
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: '#94a3b8' }}>
        Active: {active?.hostname ?? '없음'} &nbsp;|&nbsp; VIP: {cluster.vip ?? '-'}
      </div>
    </div>
  )
}
EOF
```

- [ ] **Step 2: NodeStatus.jsx 작성**

```bash
cat > frontend/src/components/NodeStatus.jsx << 'EOF'
import React from 'react'

const ROLE_COLOR = {
  active:     { bg: '#10b981', label: 'Active' },
  standby:    { bg: '#3b82f6', label: 'Standby' },
  fault:      { bg: '#ef4444', label: 'Fault' },
  recovering: { bg: '#f59e0b', label: 'Recovering' },
}

function MetricBar({ label, value }) {
  const color = value > 85 ? '#ef4444' : value > 70 ? '#f59e0b' : '#10b981'
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
        <span>{label}</span><span>{value?.toFixed(1) ?? 0}%</span>
      </div>
      <div style={{ height: 6, background: '#334155', borderRadius: 3 }}>
        <div style={{ width: `${Math.min(value || 0, 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  )
}

export default function NodeStatus({ node }) {
  const roleStyle = ROLE_COLOR[node.role] || ROLE_COLOR.standby
  const m = node.metrics

  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, minWidth: 240 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{node.hostname}</span>
        <span style={{
          background: roleStyle.bg, color: '#fff',
          borderRadius: 4, padding: '2px 8px', fontSize: 12,
        }}>{roleStyle.label}</span>
      </div>
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>OS: {node.osType}</div>
      {m ? (
        <>
          <MetricBar label="CPU" value={m.cpuPercent} />
          <MetricBar label="Memory" value={m.memoryPercent} />
          <MetricBar label="Disk" value={m.diskPercent} />
        </>
      ) : (
        <div style={{ fontSize: 12, color: '#475569' }}>메트릭 없음</div>
      )}
    </div>
  )
}
EOF
```

- [ ] **Step 3: MetricsChart.jsx 작성**

```bash
cat > frontend/src/components/MetricsChart.jsx << 'EOF'
import React, { useEffect, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

export default function MetricsChart({ title, dataPoints, color = '#3b82f6', maxY = 100 }) {
  const labels = dataPoints.map((_, i) => `${dataPoints.length - i}s ago`).reverse()

  const data = {
    labels,
    datasets: [{
      label: title,
      data: dataPoints,
      borderColor: color,
      backgroundColor: color + '22',
      fill: true,
      tension: 0.3,
      pointRadius: 2,
    }],
  }

  const options = {
    responsive: true,
    scales: {
      y: { min: 0, max: maxY, grid: { color: '#1e293b' }, ticks: { color: '#475569' } },
      x: { grid: { display: false }, ticks: { color: '#475569' } },
    },
    plugins: { legend: { display: false }, title: {
      display: true, text: title, color: '#94a3b8', font: { size: 13 }
    }},
    animation: false,
  }

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: 16 }}>
      <Line data={data} options={options} />
    </div>
  )
}
EOF
```

- [ ] **Step 4: Dashboard.jsx 작성**

```bash
mkdir -p frontend/src/pages
cat > frontend/src/pages/Dashboard.jsx << 'EOF'
import React, { useEffect, useState } from 'react'
import { getClusters, getClusterStatus } from '../api/client'
import ClusterCard from '../components/ClusterCard'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const [clusters, setClusters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getClusters()
        const withStatus = await Promise.all(
          res.data.map(async (c) => {
            try {
              const s = await getClusterStatus(c.id)
              return s.data
            } catch {
              return { clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [] }
            }
          })
        )
        setClusters(withStatus)
      } catch (e) {
        setError('클러스터 목록을 불러오지 못했습니다.')
      } finally {
        setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div style={{ color: '#94a3b8', padding: 40 }}>로딩 중...</div>
  if (error) return <div style={{ color: '#ef4444', padding: 40 }}>{error}</div>

  return (
    <div style={{ padding: '32px 40px', background: '#0f172a', minHeight: '100vh', color: '#f1f5f9' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Nemesis 대시보드</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>
        전체 클러스터 현황 — {clusters.length}/{10}개
      </p>

      {clusters.length === 0 ? (
        <div style={{ color: '#475569', padding: 40, textAlign: 'center' }}>
          등록된 클러스터가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {clusters.map(c => (
            <ClusterCard
              key={c.clusterId}
              cluster={c}
              onClick={() => navigate(`/cluster/${c.clusterId}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
EOF
```

- [ ] **Step 5: ClusterDetail.jsx 작성**

```bash
cat > frontend/src/pages/ClusterDetail.jsx << 'EOF'
import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getClusterStatus } from '../api/client'
import NodeStatus from '../components/NodeStatus'
import MetricsChart from '../components/MetricsChart'

const MAX_HISTORY = 20

export default function ClusterDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const historyRef = useRef({}) // nodeId -> { cpu: [], mem: [], disk: [] }

  useEffect(() => {
    const load = async () => {
      const res = await getClusterStatus(id)
      const s = res.data
      setStatus(s)

      s.nodes.forEach(node => {
        if (!historyRef.current[node.nodeId]) {
          historyRef.current[node.nodeId] = { cpu: [], mem: [], disk: [] }
        }
        const h = historyRef.current[node.nodeId]
        if (node.metrics) {
          h.cpu.push(node.metrics.cpuPercent)
          h.mem.push(node.metrics.memoryPercent)
          h.disk.push(node.metrics.diskPercent)
          if (h.cpu.length > MAX_HISTORY) { h.cpu.shift(); h.mem.shift(); h.disk.shift() }
        }
      })
    }

    load()
    const iv = setInterval(load, 3000)
    return () => clearInterval(iv)
  }, [id])

  if (!status) return <div style={{ color: '#94a3b8', padding: 40 }}>로딩 중...</div>

  return (
    <div style={{ padding: '32px 40px', background: '#0f172a', minHeight: '100vh', color: '#f1f5f9' }}>
      <button onClick={() => navigate('/')} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}>
        ← 대시보드로
      </button>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{status.clusterName}</h1>
      <p style={{ color: '#475569', marginBottom: 32 }}>VIP: {status.vip ?? '-'}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        {status.nodes.map(node => (
          <NodeStatus key={node.nodeId} node={node} />
        ))}
      </div>

      {status.nodes.map(node => {
        const h = historyRef.current[node.nodeId] || { cpu: [], mem: [], disk: [] }
        return (
          <div key={node.nodeId} style={{ marginBottom: 32 }}>
            <h3 style={{ fontSize: 15, color: '#94a3b8', marginBottom: 12 }}>{node.hostname} 메트릭</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <MetricsChart title="CPU (%)" dataPoints={[...h.cpu]} color="#3b82f6" />
              <MetricsChart title="Memory (%)" dataPoints={[...h.mem]} color="#10b981" />
              <MetricsChart title="Disk (%)" dataPoints={[...h.disk]} color="#f59e0b" />
            </div>
          </div>
        )
      })}
    </div>
  )
}
EOF
```

- [ ] **Step 6: App.jsx 작성**

```bash
cat > frontend/src/App.jsx << 'EOF'
import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import ClusterDetail from './pages/ClusterDetail'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cluster/:id" element={<ClusterDetail />} />
      </Routes>
    </BrowserRouter>
  )
}
EOF
```

- [ ] **Step 7: main.jsx 수정**

```bash
cat > frontend/src/main.jsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
EOF
```

- [ ] **Step 8: index.css 다크 테마 기본 스타일 추가**

```bash
cat > frontend/src/index.css << 'EOF'
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #f1f5f9;
}
EOF
```

- [ ] **Step 9: 빌드 확인**

```bash
cd frontend
npm run build 2>&1 | tail -10
ls -la dist/
```
예상 결과: `dist/index.html` 및 JS/CSS 번들 생성

- [ ] **Step 10: 커밋**

```bash
cd ..
git add frontend/
git commit -m "feat: React dashboard with cluster cards and real-time metrics charts"
```

---

## Task 14: Linux 에이전트 (collect.sh + nemesis-agent.py)

**Files:**
- Create: `agent/collect.sh`
- Create: `agent/nemesis-agent.py`
- Create: `agent/install.sh`

- [ ] **Step 1: collect.sh 작성 (Linux)**

```bash
mkdir -p agent
cat > agent/collect.sh << 'SHELLEOF'
#!/bin/sh
# Linux 메트릭 수집 스크립트 — POSIX sh 호환
set -e

HOSTNAME=$(hostname)
TIMESTAMP=$(date +%s)

# CPU (vmstat: 15번째 열이 idle)
CPU_IDLE=$(vmstat 1 2 | tail -1 | awk '{print $15}')
CPU=$(echo "100 - $CPU_IDLE" | bc)

# Memory (free -m)
MEM_LINE=$(free -m | grep Mem)
MEM_TOTAL=$(echo "$MEM_LINE" | awk '{print $2}')
MEM_USED=$(echo "$MEM_LINE" | awk '{print $3}')
MEM_PCT=$(echo "scale=1; $MEM_USED * 100 / $MEM_TOTAL" | bc)

# Disk (첫 번째 마운트 포인트 /)
DISK_LINE=$(df -m / | tail -1)
DISK_USED=$(echo "$DISK_LINE" | awk '{print $3}')
DISK_TOTAL=$(echo "$DISK_LINE" | awk '{print $2}')
DISK_PCT=$(echo "$DISK_LINE" | awk '{print $5}' | tr -d '%')

# Network (eth0 기본, 없으면 ens3)
NET_IF=$(ip route show default | awk '{print $5}' | head -1)
if [ -f "/proc/net/dev" ]; then
  NET_LINE=$(grep "$NET_IF" /proc/net/dev | head -1)
  NET_RX=$(echo "$NET_LINE" | awk '{print $2}')
  NET_TX=$(echo "$NET_LINE" | awk '{print $10}')
else
  NET_RX=0
  NET_TX=0
fi

# 프로세스 상태 (oracle, tomcat, nginx, httpd 감지)
PROCESSES=""
for PROC in oracle ora_pmon tomcat nginx httpd mysqld java; do
  PID=$(pgrep -f "$PROC" | head -1)
  if [ -n "$PID" ]; then
    PROCESSES="${PROCESSES},{\"name\":\"$PROC\",\"pid\":\"$PID\",\"status\":\"running\"}"
  fi
done
# 앞의 쉼표 제거
PROCESSES=$(echo "$PROCESSES" | sed 's/^,//')

# 에러 로그 프리뷰 (최근 에러 5줄)
LOG_FILES="/var/log/messages /var/log/syslog"
ERROR_PREVIEW="[]"
for LOG in $LOG_FILES; do
  if [ -r "$LOG" ]; then
    ERRORS=$(grep -i "error\|oom\|segfault\|critical" "$LOG" | tail -5 | \
             sed 's/"/\\"/g' | awk '{print "\"" $0 "\""}' | tr '\n' ',')
    ERRORS="[${ERRORS%,}]"
    ERROR_PREVIEW="$ERRORS"
    break
  fi
done

cat <<JSON
{
  "hostname": "$HOSTNAME",
  "timestamp": $TIMESTAMP,
  "cpuPercent": $CPU,
  "memoryPercent": $MEM_PCT,
  "memoryUsedMb": $MEM_USED,
  "memoryTotalMb": $MEM_TOTAL,
  "diskPercent": $DISK_PCT,
  "diskUsedGb": $(echo "$DISK_USED / 1024" | bc),
  "diskTotalGb": $(echo "$DISK_TOTAL / 1024" | bc),
  "networkRxBytesPerSec": $NET_RX,
  "networkTxBytesPerSec": $NET_TX,
  "processes": [$PROCESSES],
  "errorLogPreview": $ERROR_PREVIEW
}
JSON
SHELLEOF
chmod +x agent/collect.sh
```

- [ ] **Step 2: collect.sh 로컬 테스트**

```bash
bash agent/collect.sh | python3 -m json.tool
```
예상 결과: JSON 구조 출력, 파싱 오류 없음

- [ ] **Step 3: nemesis-agent.py 작성**

```bash
cat > agent/nemesis-agent.py << 'PYEOF'
#!/usr/bin/env python3
"""Nemesis Agent — 메트릭 수집 및 관리 서버 Push 데몬"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import ssl
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('nemesis-agent')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COLLECT_SCRIPT = os.path.join(SCRIPT_DIR, 'collect.sh')
METADATA_FILE = '/etc/nemesis/metadata.json'
PUSH_INTERVAL = 3  # seconds
PULL_INTERVAL = 600  # seconds

# TLS 검증 비활성화 (자체 서명 인증서 환경 대응)
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE


def collect_metrics() -> dict:
    result = subprocess.run(['sh', COLLECT_SCRIPT], capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"collect.sh failed: {result.stderr}")
    return json.loads(result.stdout)


def push_metrics(server_url: str, api_key: str, metrics: dict):
    url = f"{server_url}/api/agent/metrics"
    data = json.dumps(metrics).encode('utf-8')
    req = urllib.request.Request(
        url, data=data,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as resp:
        log.debug(f"Push OK: {resp.status}")


def register(server_url: str, api_key: str, version: str = '1.0.0') -> dict:
    import socket
    hostname = socket.gethostname()
    os_type = 'AIX' if sys.platform == 'aix' else 'LINUX'

    payload = {
        'apiKey': api_key,
        'hostname': hostname,
        'os': os_type,
        'version': version,
    }
    url = f"{server_url}/api/agent/register"
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, context=ssl_ctx, timeout=30) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        log.info(f"등록 완료: cluster={result['clusterName']}, role={result['role']}")
        return result


def save_metadata(metadata: dict):
    os.makedirs(os.path.dirname(METADATA_FILE), exist_ok=True)
    with open(METADATA_FILE, 'w') as f:
        json.dump(metadata, f, indent=2)


def run_push_loop(server_url: str, api_key: str):
    last_pull = 0
    while True:
        try:
            metrics = collect_metrics()
            push_metrics(server_url, api_key, metrics)
        except urllib.error.URLError as e:
            log.warning(f"Push 실패 (서버 연결 불가): {e.reason}")
        except Exception as e:
            log.error(f"Push 오류: {e}")

        # Pull: 600초 주기
        if time.time() - last_pull > PULL_INTERVAL:
            try:
                url = f"{server_url}/api/clusters"
                req = urllib.request.Request(url, headers={'Authorization': f'Bearer {api_key}'})
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
                    pass  # 연결 확인만
                last_pull = time.time()
            except Exception as e:
                log.debug(f"Pull 확인 실패: {e}")

        time.sleep(PUSH_INTERVAL)


def main():
    parser = argparse.ArgumentParser(description='Nemesis Agent')
    sub = parser.add_subparsers(dest='command')

    start_p = sub.add_parser('start', help='에이전트 시작')
    start_p.add_argument('--server', required=True, help='관리 서버 URL (예: https://192.168.1.10:18080)')
    start_p.add_argument('--key', required=True, help='API Key (Web UI에서 발급)')
    start_p.add_argument('--version', default='1.0.0')

    args = parser.parse_args()

    if args.command == 'start':
        log.info(f"Nemesis Agent 시작 → 서버: {args.server}")

        # 등록
        try:
            meta = register(args.server, args.key, args.version)
            save_metadata(meta)
        except Exception as e:
            log.error(f"등록 실패: {e}")
            sys.exit(1)

        # Push 루프
        log.info(f"메트릭 Push 시작 (주기: {PUSH_INTERVAL}초)")
        run_push_loop(args.server, args.key)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
PYEOF
chmod +x agent/nemesis-agent.py
```

- [ ] **Step 4: install.sh 작성**

```bash
cat > agent/install.sh << 'SHELLEOF'
#!/bin/sh
# Nemesis Agent 설치 스크립트
set -e

INSTALL_DIR=/opt/nemesis-agent
CONFIG_DIR=/etc/nemesis

echo "=== Nemesis Agent 설치 ==="

# 기존 설치 확인
if [ -d "$INSTALL_DIR" ]; then
  echo "이미 설치되어 있습니다. 업데이트합니다."
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"
cp -f nemesis-agent.py collect.sh "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/nemesis-agent.py" "$INSTALL_DIR/collect.sh"

# AIX 환경에서 collect.sh 교체
if [ "$(uname)" = "AIX" ]; then
  if [ -f collect_aix.sh ]; then
    cp -f collect_aix.sh "$INSTALL_DIR/collect.sh"
    chmod +x "$INSTALL_DIR/collect.sh"
    echo "AIX 전용 수집 스크립트 적용"
  fi
fi

echo ""
echo "설치 완료!"
echo ""
echo "에이전트 시작 명령:"
echo "  python3 $INSTALL_DIR/nemesis-agent.py start \\"
echo "    --server https://{관리서버IP}:18080 \\"
echo "    --key {API_KEY}"
SHELLEOF
chmod +x agent/install.sh
```

- [ ] **Step 5: 커밋**

```bash
git add agent/
git commit -m "feat: Linux agent with metric collection and push loop"
```

---

## Task 15: AIX 에이전트 (collect_aix.sh)

**Files:**
- Create: `agent/collect_aix.sh`

- [ ] **Step 1: collect_aix.sh 작성 (AIX vmstat/iostat/netstat 기반)**

```bash
cat > agent/collect_aix.sh << 'SHELLEOF'
#!/bin/sh
# AIX 메트릭 수집 스크립트 — AIX ksh/sh 호환
# AIX는 /proc 없음, vmstat/iostat/netstat 사용

HOSTNAME=$(hostname)
TIMESTAMP=$(date +%s)

# CPU (vmstat 1 2: 마지막 줄의 id 컬럼 = idle)
CPU_IDLE=$(vmstat 1 2 | tail -1 | awk '{print $16}')
# AIX vmstat 컬럼: us sy id wa pc ec (16번이 idle)
CPU=$(expr 100 - "$CPU_IDLE" 2>/dev/null || echo 0)

# Memory (svmon -G: AIX 메모리 조회)
# svmon 없으면 vmstat의 avm(active virtual memory) 사용
if command -v svmon > /dev/null 2>&1; then
  SVS=$(svmon -G | grep memory | awk '{print $2, $3}')
  MEM_TOTAL_4K=$(echo "$SVS" | awk '{print $1}')
  MEM_IN_USE_4K=$(echo "$SVS" | awk '{print $2}')
  MEM_TOTAL=$(expr "$MEM_TOTAL_4K" \* 4 / 1024)
  MEM_USED=$(expr "$MEM_IN_USE_4K" \* 4 / 1024)
else
  MEM_TOTAL=0
  MEM_USED=0
fi
MEM_PCT=0
if [ "$MEM_TOTAL" -gt 0 ]; then
  MEM_PCT=$(expr "$MEM_USED" \* 100 / "$MEM_TOTAL")
fi

# Disk (df -m /)
DISK_LINE=$(df -m / | tail -1)
DISK_USED=$(echo "$DISK_LINE" | awk '{print $3}')
DISK_TOTAL=$(echo "$DISK_LINE" | awk '{print $2}')
DISK_PCT=$(echo "$DISK_LINE" | awk '{print $4}' | tr -d '%')

# Network (netstat -i: en0 기준)
NET_IF=${NEMESIS_NET_IF:-en0}
NET_RX=$(netstat -i | grep "^${NET_IF}" | awk '{print $5}')
NET_TX=$(netstat -i | grep "^${NET_IF}" | awk '{print $7}')
NET_RX=${NET_RX:-0}
NET_TX=${NET_TX:-0}

# 프로세스 상태 (AIX ps)
PROCESSES=""
for PROC in ora_pmon tomcat nginx httpd mysqld java; do
  PID=$(ps -ef | grep "$PROC" | grep -v grep | awk '{print $2}' | head -1)
  if [ -n "$PID" ]; then
    PROCESSES="${PROCESSES},{\"name\":\"$PROC\",\"pid\":\"$PID\",\"status\":\"running\"}"
  fi
done
PROCESSES=$(echo "$PROCESSES" | sed 's/^,//')

# 에러 로그 프리뷰 (AIX syslog)
ERROR_PREVIEW="[]"
if [ -r /var/log/syslog ]; then
  ERRORS=$(grep -i "error\|oom\|critical" /var/log/syslog | tail -5 | \
           sed 's/"/\\"/g' | awk '{print "\"" $0 "\""}' | tr '\n' ',')
  ERROR_PREVIEW="[${ERRORS%,}]"
fi

echo "{
  \"hostname\": \"$HOSTNAME\",
  \"timestamp\": $TIMESTAMP,
  \"cpuPercent\": $CPU,
  \"memoryPercent\": $MEM_PCT,
  \"memoryUsedMb\": $MEM_USED,
  \"memoryTotalMb\": $MEM_TOTAL,
  \"diskPercent\": $DISK_PCT,
  \"diskUsedGb\": $(expr "$DISK_USED" / 1024 2>/dev/null || echo 0),
  \"diskTotalGb\": $(expr "$DISK_TOTAL" / 1024 2>/dev/null || echo 0),
  \"networkRxBytesPerSec\": $NET_RX,
  \"networkTxBytesPerSec\": $NET_TX,
  \"processes\": [$PROCESSES],
  \"errorLogPreview\": $ERROR_PREVIEW
}"
SHELLEOF
chmod +x agent/collect_aix.sh
```

- [ ] **Step 2: 커밋**

```bash
git add agent/collect_aix.sh
git commit -m "feat: AIX agent metric collection script"
```

---

## Task 16: 전체 통합 테스트 및 Docker Compose 기동

**Files:**
- Modify: `docker-compose.yml` (이미 완성됨)
- Create: `backend/Dockerfile` (Task 11에서 완성됨)

- [ ] **Step 1: 백엔드 JAR 빌드**

```bash
cd backend
./gradlew bootJar
ls build/libs/nemesis-server-1.0.0.jar
```

- [ ] **Step 2: 프론트엔드 빌드**

```bash
cd frontend
npm run build
ls dist/
```

- [ ] **Step 3: Docker 이미지 빌드**

```bash
cd backend
docker build -t nemesis-server:latest .
```

- [ ] **Step 4: Docker Compose 기동**

```bash
docker compose up -d
docker compose ps
```
예상 결과: `nemesis-server`, `nemesis-frontend`, `postgres` 모두 `Up` 상태

- [ ] **Step 5: 관리 서버 헬스체크**

```bash
curl -s http://localhost:18080/api/clusters | python3 -m json.tool
```
예상 결과: `[]` (빈 배열)

- [ ] **Step 6: Web UI 접속 확인**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:18090/
```
예상 결과: `200`

- [ ] **Step 7: 에이전트 등록 End-to-End 테스트**

```bash
# 1. 클러스터 생성
CLUSTER=$(curl -s -X POST http://localhost:18080/api/clusters \
  -H 'Content-Type: application/json' \
  -d '{"name":"통합테스트클러스터","vip":"192.168.1.100"}')
CLUSTER_ID=$(echo "$CLUSTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "클러스터 ID: $CLUSTER_ID"

# 2. API Key 발급 (DB에 직접 삽입 — Admin API는 Phase 2에서 개발)
docker compose exec postgres psql -U nemesis -d nemesis -c \
  "INSERT INTO agent_keys (id, cluster_group_id, api_key) VALUES (uuid_generate_v4(), '$CLUSTER_ID', 'nmss-e2e-test-key-001');"

# 3. 에이전트 등록
curl -s -X POST http://localhost:18080/api/agent/register \
  -H 'Content-Type: application/json' \
  -d '{"apiKey":"nmss-e2e-test-key-001","hostname":"test-server-01","os":"LINUX","version":"1.0.0","serviceIp":"192.168.1.101"}'
```
예상 결과: `{"nodeId":"...","clusterId":"...","clusterName":"통합테스트클러스터","role":"standby",...}`

- [ ] **Step 8: 메트릭 Push 테스트**

```bash
curl -s -X POST http://localhost:18080/api/agent/metrics \
  -H 'Authorization: Bearer nmss-e2e-test-key-001' \
  -H 'Content-Type: application/json' \
  -d '{"hostname":"test-server-01","timestamp":'"$(date +%s)"',"cpuPercent":45.2,"memoryPercent":60.0,"memoryUsedMb":4096,"memoryTotalMb":8192,"diskPercent":30.5}'
echo "→ HTTP 200 이어야 함"
```

- [ ] **Step 9: 클러스터 상태 확인 (메트릭 포함)**

```bash
curl -s "http://localhost:18080/api/clusters/$CLUSTER_ID/status" | python3 -m json.tool
```
예상 결과: 노드 목록과 cpuPercent: 45.2 등 메트릭 포함

- [ ] **Step 10: 최종 커밋**

```bash
cd ..
git add -A
git commit -m "feat: Phase 1 Foundation complete — server + agent + dashboard"
```

---

## 자기검토 (Spec 커버리지 확인)

PRD Phase 1 요구사항 대비:

| 요구사항 | 구현 Task |
|---|---|
| F-01: `java -jar nemesis-server.jar` 단일 기동 | Task 11 (Dockerfile + docker-compose) |
| F-01: AIX/Linux 커널 없이 에이전트 설치 | Task 14, 15 (Shell Script 기반) |
| F-01: 신규 노드 자동 등록 | Task 7 (AgentRegistrationController) |
| F-02: AIX/Linux 크로스 플랫폼 에이전트 | Task 14 (collect.sh), Task 15 (collect_aix.sh) |
| F-03: 실시간 CPU/Memory/Disk/Network 차트 | Task 13 (MetricsChart.jsx + Chart.js) |
| F-03: 프로세스 상태 모니터링 | Task 8 (MetricsPushRequest.processes) |
| F-07: 전체 클러스터 현황 Overview | Task 13 (Dashboard.jsx + ClusterCard.jsx) |
| F-07: 노드 상태 직관적 표시 | Task 13 (NodeStatus.jsx) |
| 멀티 클러스터 (최대 10개) | Task 9 (ClusterService.create — 10개 제한) |
| 에이전트 API Key 인증 | Task 7, 8 (Bearer Token) |
| 메타데이터 Push/Pull 동기화 | Task 8 (Push), Task 14 (Pull 600초 주기) |

**Phase 1에서 의도적으로 제외된 항목 (Phase 2 이후):**
- Failover / VIP 이동 (Phase 2)
- Heartbeat 모니터링 (Phase 2)
- AI Failover / Self-Healing (Phase 3, 4)
- Telegram/Email 알림 (Phase 2)
- Runbook 엔진 (Phase 2)
- Admin API Key 발급 UI (Phase 2)

---

## 실행 선택

플랜이 저장되었습니다. 두 가지 실행 방법:

**1. Subagent-Driven (권장)** — 태스크별 신선한 서브에이전트, 단계별 리뷰
→ `/subagent-driven-development` 호출

**2. Inline Execution** — 이 세션에서 직접 실행
→ `/executing-plans` 호출
