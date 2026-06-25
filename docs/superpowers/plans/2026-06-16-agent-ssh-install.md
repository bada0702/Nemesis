# Agent SSH Install Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리 콘솔에서 SSH 비밀번호 인증으로 대상 서버에 Nemesis 에이전트를 원격 설치하는 3단계 위저드 페이지를 구축한다.

**Architecture:** 백엔드는 JSch로 SSH/SCP를 처리하고 `SseEmitter`로 설치 로그를 실시간 스트리밍한다. 프론트엔드는 `/settings/agents/install` 신규 페이지에 Step 1(서버 정보) → Step 2(연결 검증) → Step 3(설치+로그) 위저드를 구성하고 SSE는 브라우저 네이티브 `EventSource`로 수신한다.

**Tech Stack:** JSch 0.1.55, Spring SseEmitter, React EventSource API, Axios

---

## File Map

### Backend (신규)
- `build.gradle` — JSch 의존성 추가
- `application.yml` — `nemesis.agent.files-dir` 속성 추가
- `domain/install/dto/TestConnRequest.java` — SSH 연결 테스트 요청 DTO
- `domain/install/dto/TestConnResult.java` — 검증 결과 DTO (항목별 ok/error)
- `domain/install/dto/InstallRequest.java` — 설치 요청 DTO
- `domain/install/AgentInstallService.java` — SSH 연결 테스트, 핫비트 확인, SCP+설치 실행, SSE 잡 관리
- `domain/install/AgentInstallController.java` — REST 3개 엔드포인트 + 에이전트 키 목록

### Backend (수정)
- `domain/agent/AgentKeyRepository.java` — `findByClusterIdAndRevokedFalse` 메서드 추가

### Backend (테스트)
- `test/.../install/AgentInstallServiceTest.java` — 연결 테스트·핫비트·설치 로직 단위 테스트

### Frontend (신규)
- `src/pages/settings/AgentInstall.jsx` — 위저드 페이지 (Step 1/2/3 포함)

### Frontend (수정)
- `src/api/client.js` — `testAgentInstall`, `startAgentInstall`, `getClusterAgentKeys` 추가
- `src/App.jsx` — `/settings/agents/install` 라우트 추가
- `src/components/Sidebar.jsx` — 시스템 메뉴에 "에이전트 설치" 링크 추가

---

## Task 1: JSch 의존성 추가 + 설정

**Files:**
- Modify: `backend/build.gradle`
- Modify: `backend/src/main/resources/application.yml`

- [ ] **Step 1: build.gradle에 JSch 추가**

```groovy
// dependencies 블록 안에 추가
implementation 'com.jcraft:jsch:0.1.55'
```

- [ ] **Step 2: application.yml에 agent 파일 경로 추가**

`nemesis:` 섹션에 아래 항목 추가:

```yaml
nemesis:
  # ... 기존 설정 ...
  agent:
    files-dir: ${NEMESIS_AGENT_DIR:/var/www/html/Nemesis_v100/agent}
    management-url: ${NEMESIS_MGMT_URL:https://localhost:18080}
```

- [ ] **Step 3: 빌드 확인**

```bash
cd backend && ./gradlew dependencies --configuration runtimeClasspath | grep jsch
```
Expected: `com.jcraft:jsch:0.1.55`

- [ ] **Step 4: 커밋**

```bash
git add backend/build.gradle backend/src/main/resources/application.yml
git commit -m "feat: add JSch SSH library + agent install config"
```

---

## Task 2: AgentKeyRepository 메서드 추가

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/agent/AgentKeyRepository.java`

- [ ] **Step 1: 클러스터별 유효 키 조회 메서드 추가**

```java
import java.util.List;

public interface AgentKeyRepository extends JpaRepository<AgentKey, UUID> {
    Optional<AgentKey> findByApiKey(String apiKey);
    boolean existsByApiKey(String apiKey);
    Optional<AgentKey> findByNodeId(UUID nodeId);

    // 추가
    List<AgentKey> findByClusterIdAndRevokedFalse(UUID clusterId);
}
```

- [ ] **Step 2: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/agent/AgentKeyRepository.java
git commit -m "feat: add findByClusterIdAndRevokedFalse to AgentKeyRepository"
```

---

## Task 3: DTO 클래스 3개 생성

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/install/dto/TestConnRequest.java`
- Create: `backend/src/main/java/com/nemesis/domain/install/dto/TestConnResult.java`
- Create: `backend/src/main/java/com/nemesis/domain/install/dto/InstallRequest.java`

- [ ] **Step 1: TestConnRequest.java 생성**

```java
package com.nemesis.domain.install.dto;

import lombok.Data;
import java.util.UUID;

@Data
public class TestConnRequest {
    private String host;          // 대상 서버 IP (serviceIp)
    private int    sshPort;       // 기본 22
    private String sshUser;
    private String sshPassword;
    private String heartbeatIp;   // 핫비트 IP (null이면 host와 동일)
    private UUID   clusterId;     // 같은 클러스터 피어 조회용
}
```

- [ ] **Step 2: TestConnResult.java 생성**

```java
package com.nemesis.domain.install.dto;

import lombok.Builder;
import lombok.Data;
import java.util.List;

@Data
@Builder
public class TestConnResult {
    private boolean sshOk;
    private String  sshError;

    private boolean port17001Ok;   // 관리서버 → 대상 명령 채널
    private String  port17001Error;

    private List<PeerCheck> peerChecks;  // 대상 → 피어 핫비트(17000)

    @Data
    @Builder
    public static class PeerCheck {
        private String  nodeHostname;
        private String  heartbeatIp;
        private boolean reachable;
        private String  error;
    }
}
```

- [ ] **Step 3: InstallRequest.java 생성**

```java
package com.nemesis.domain.install.dto;

import lombok.Data;
import java.util.UUID;

@Data
public class InstallRequest {
    private String jobId;          // 프론트에서 생성한 UUID
    private String host;           // 대상 서버 IP = NEMESIS_SERVICE_IP
    private int    sshPort;
    private String sshUser;
    private String sshPassword;
    private String heartbeatIp;    // NEMESIS_HEARTBEAT_IP (null이면 host와 동일)
    private UUID   clusterId;
    private String role;           // PRIMARY or STANDBY
    private String apiKey;         // 선택된 에이전트 API 키
    private String managementUrl;  // 관리서버 URL (기본값은 application.yml)
}
```

- [ ] **Step 4: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/install/
git commit -m "feat: add AgentInstall DTO classes"
```

---

## Task 4: AgentInstallService — 연결 테스트 + 핫비트 확인

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/install/AgentInstallService.java`
- Create: `backend/src/test/java/com/nemesis/install/AgentInstallServiceTest.java`

- [ ] **Step 1: 테스트 먼저 작성**

`backend/src/test/java/com/nemesis/install/AgentInstallServiceTest.java`:

```java
package com.nemesis.install;

import com.nemesis.domain.install.AgentInstallService;
import com.nemesis.domain.install.dto.TestConnRequest;
import com.nemesis.domain.install.dto.TestConnResult;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentInstallServiceTest {

    @Mock NodeRepository nodeRepository;
    @InjectMocks AgentInstallService service;

    private UUID clusterId;

    @BeforeEach
    void setUp() {
        clusterId = UUID.randomUUID();
        // files-dir, mgmt-url은 @Value 주입 → reflection으로 설정
        org.springframework.test.util.ReflectionTestUtils.setField(service, "agentFilesDir", "/tmp");
        org.springframework.test.util.ReflectionTestUtils.setField(service, "managementUrl", "https://localhost:18080");
    }

    @Test
    void heartbeatIp_defaults_to_host_when_blank() {
        // heartbeatIp가 비어있으면 host IP가 사용된다는 로직 검증
        TestConnRequest req = new TestConnRequest();
        req.setHost("10.0.1.10");
        req.setHeartbeatIp("");  // 빈 값
        req.setClusterId(clusterId);

        // 피어 없는 클러스터: peerChecks 빈 리스트
        when(nodeRepository.findByClusterId(clusterId)).thenReturn(List.of());

        // SSH 테스트는 실제 연결 없이 — 서비스 내부 resolveHeartbeatIp만 검증
        String resolved = service.resolveHeartbeatIp(req.getHost(), req.getHeartbeatIp());
        assertThat(resolved).isEqualTo("10.0.1.10");
    }

    @Test
    void heartbeatIp_uses_provided_value_when_not_blank() {
        String resolved = service.resolveHeartbeatIp("10.0.1.10", "192.168.10.5");
        assertThat(resolved).isEqualTo("192.168.10.5");
    }

    @Test
    void port17001_error_message_set_on_failure() {
        // 관리서버→대상 17001 확인: 연결 불가 시 에러 메시지 포함
        TestConnResult.PeerCheck check = TestConnResult.PeerCheck.builder()
                .nodeHostname("node-02")
                .heartbeatIp("10.0.1.11")
                .reachable(false)
                .error("Connection refused")
                .build();
        assertThat(check.getError()).contains("Connection refused");
        assertThat(check.isReachable()).isFalse();
    }
}
```

- [ ] **Step 2: 테스트 실행 → 컴파일 실패 확인**

```bash
cd backend && ./gradlew test --tests "com.nemesis.install.AgentInstallServiceTest" 2>&1 | tail -20
```
Expected: 컴파일 에러 (AgentInstallService 없음)

- [ ] **Step 3: AgentInstallService 연결 테스트 부분 구현**

`backend/src/main/java/com/nemesis/domain/install/AgentInstallService.java`:

```java
package com.nemesis.domain.install;

import com.jcraft.jsch.*;
import com.nemesis.domain.install.dto.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.*;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.*;
import java.util.concurrent.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class AgentInstallService {

    private final NodeRepository nodeRepository;

    @Value("${nemesis.agent.files-dir}")
    private String agentFilesDir;

    @Value("${nemesis.agent.management-url}")
    private String managementUrl;

    // jobId → SseEmitter
    private final Map<String, SseEmitter>   emitters = new ConcurrentHashMap<>();
    // jobId → 버퍼(아직 emitter 연결 전 로그)
    private final Map<String, List<String>> logBuffer = new ConcurrentHashMap<>();

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /** heartbeatIp 미지정 시 host IP 사용 */
    public String resolveHeartbeatIp(String host, String heartbeatIp) {
        return (heartbeatIp == null || heartbeatIp.isBlank()) ? host : heartbeatIp;
    }

    /** Step 2: SSH 연결 + 포트 + 핫비트 일괄 검증 */
    public TestConnResult testConnection(TestConnRequest req) {
        TestConnResult.TestConnResultBuilder result = TestConnResult.builder();
        Session session = null;

        // 1) SSH 연결 테스트
        try {
            session = openSession(req.getHost(), req.getSshPort() > 0 ? req.getSshPort() : 22,
                    req.getSshUser(), req.getSshPassword());
            result.sshOk(true);
        } catch (Exception e) {
            result.sshOk(false).sshError(e.getMessage());
            return result.port17001Ok(false).port17001Error("SSH 실패로 건너뜀")
                         .peerChecks(List.of()).build();
        }

        // 2) 관리서버 → 대상 17001 도달 확인
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(req.getHost(), 17001), 3000);
            result.port17001Ok(true);
        } catch (Exception e) {
            result.port17001Ok(false).port17001Error("포트 17001 미응답: " + e.getMessage());
        }

        // 3) 대상 → 피어 핫비트(17000) 확인
        String hbIp = resolveHeartbeatIp(req.getHost(), req.getHeartbeatIp());
        List<Node> peers = req.getClusterId() != null
                ? nodeRepository.findByClusterId(req.getClusterId())
                : List.of();
        List<TestConnResult.PeerCheck> peerChecks = new ArrayList<>();
        for (Node peer : peers) {
            if (peer.getIpAddress() == null) continue;
            String peerHbIp = peer.getIpAddress(); // 피어의 heartbeatIp 필드가 있으면 사용
            peerChecks.add(checkHeartbeatViaSsh(session, peer.getHostname(), peerHbIp));
        }
        result.peerChecks(peerChecks);

        if (session != null) session.disconnect();
        return result.build();
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private Session openSession(String host, int port, String user, String password) throws JSchException {
        JSch jsch = new JSch();
        Session session = jsch.getSession(user, host, port);
        session.setPassword(password);
        session.setConfig("StrictHostKeyChecking", "no");
        session.setTimeout(10_000);
        session.connect(10_000);
        return session;
    }

    private TestConnResult.PeerCheck checkHeartbeatViaSsh(Session session, String peerHostname, String peerIp) {
        try {
            String cmd = String.format(
                "nc -z -w2 %s 17000 2>/dev/null && echo OK || " +
                "(timeout 2 bash -c 'echo > /dev/tcp/%s/17000' 2>/dev/null && echo OK || echo FAIL)",
                peerIp, peerIp);
            String output = execCommand(session, cmd).trim();
            boolean ok = "OK".equals(output);
            return TestConnResult.PeerCheck.builder()
                    .nodeHostname(peerHostname)
                    .heartbeatIp(peerIp)
                    .reachable(ok)
                    .error(ok ? null : "17000 포트 미응답 (" + peerIp + ")")
                    .build();
        } catch (Exception e) {
            return TestConnResult.PeerCheck.builder()
                    .nodeHostname(peerHostname)
                    .heartbeatIp(peerIp)
                    .reachable(false)
                    .error(e.getMessage())
                    .build();
        }
    }

    private String execCommand(Session session, String cmd) throws Exception {
        ChannelExec exec = (ChannelExec) session.openChannel("exec");
        exec.setCommand(cmd);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        exec.setOutputStream(out);
        exec.setErrStream(out);
        exec.connect(5_000);
        long deadline = System.currentTimeMillis() + 10_000;
        while (!exec.isClosed() && System.currentTimeMillis() < deadline) {
            Thread.sleep(100);
        }
        exec.disconnect();
        return out.toString();
    }

    // -----------------------------------------------------------------------
    // SSE 잡 관리 (Task 5에서 install 메서드 추가)
    // -----------------------------------------------------------------------

    public SseEmitter registerEmitter(String jobId) {
        SseEmitter emitter = new SseEmitter(300_000L); // 5분
        emitters.put(jobId, emitter);

        // 버퍼에 쌓인 로그 먼저 전송
        List<String> buffered = logBuffer.getOrDefault(jobId, List.of());
        for (String line : buffered) {
            try { emitter.send(SseEmitter.event().data(line)); } catch (Exception ignored) {}
        }

        emitter.onCompletion(() -> { emitters.remove(jobId); logBuffer.remove(jobId); });
        emitter.onTimeout(()    -> { emitters.remove(jobId); logBuffer.remove(jobId); });
        return emitter;
    }

    void emit(String jobId, String line) {
        logBuffer.computeIfAbsent(jobId, k -> Collections.synchronizedList(new ArrayList<>())).add(line);
        SseEmitter emitter = emitters.get(jobId);
        if (emitter != null) {
            try { emitter.send(SseEmitter.event().data(line)); }
            catch (Exception e) { emitters.remove(jobId); }
        }
    }

    void completeJob(String jobId) {
        SseEmitter emitter = emitters.remove(jobId);
        if (emitter != null) emitter.complete();
    }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd backend && ./gradlew test --tests "com.nemesis.install.AgentInstallServiceTest" 2>&1 | tail -20
```
Expected: BUILD SUCCESSFUL, 3 tests passed

- [ ] **Step 5: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/install/ \
        backend/src/test/java/com/nemesis/install/
git commit -m "feat: AgentInstallService - SSH test + heartbeat check"
```

---

## Task 5: AgentInstallService — 설치 실행 (SCP + exec + SSE)

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/install/AgentInstallService.java`

- [ ] **Step 1: install 메서드 추가 (AgentInstallService 하단에)**

```java
// AgentInstallService.java 에 추가

public void startInstall(InstallRequest req) {
    String jobId = req.getJobId();
    String serviceIp  = req.getHost();
    String heartbeatIp = resolveHeartbeatIp(serviceIp, req.getHeartbeatIp());
    String mgmtUrl = (req.getManagementUrl() != null && !req.getManagementUrl().isBlank())
                     ? req.getManagementUrl() : managementUrl;

    // 비동기 실행
    Thread.ofVirtual().start(() -> {
        Session session = null;
        try {
            emit(jobId, "[INFO] SSH 연결 중 (" + serviceIp + ":" + req.getSshPort() + ")...");
            session = openSession(serviceIp,
                    req.getSshPort() > 0 ? req.getSshPort() : 22,
                    req.getSshUser(), req.getSshPassword());
            emit(jobId, "[INFO] SSH 연결 완료");

            // 원격 임시 디렉토리 생성
            emit(jobId, "[INFO] 원격 디렉토리 생성: /tmp/nemesis-install/");
            execCommand(session, "mkdir -p /tmp/nemesis-install/healing");

            // SCP 파일 전송
            scpFiles(session, jobId);

            // install.sh 실행
            emit(jobId, "[INFO] install.sh 실행 중...");
            String installOut = execCommandStreaming(session, jobId,
                    "cd /tmp/nemesis-install && sh install.sh 2>&1");
            emit(jobId, installOut.isBlank() ? "[INFO] install.sh 완료" : installOut);

            // 에이전트 시작
            String startCmd = String.format(
                "NEMESIS_SERVICE_IP=%s NEMESIS_HEARTBEAT_IP=%s " +
                "nohup python3 /opt/nemesis-agent/nemesis-agent.py start " +
                "--server %s --key %s > /var/log/nemesis-agent.log 2>&1 &",
                serviceIp, heartbeatIp, mgmtUrl, req.getApiKey());
            emit(jobId, "[INFO] 에이전트 시작 중 (NEMESIS_SERVICE_IP=" + serviceIp + ")...");
            execCommand(session, startCmd);

            // 등록 확인 (최대 15초 대기)
            emit(jobId, "[INFO] 관리서버 등록 확인 중...");
            boolean registered = waitForRegistration(session, mgmtUrl, 15);
            if (registered) {
                emit(jobId, "[SUCCESS] 에이전트 설치 완료! 서버: " + serviceIp);
            } else {
                emit(jobId, "[WARN] 에이전트가 시작됐으나 등록 확인 시간 초과. 로그를 확인하세요: /var/log/nemesis-agent.log");
            }
        } catch (Exception e) {
            log.error("Agent install failed for jobId={}", jobId, e);
            emit(jobId, "[ERROR] 설치 실패: " + e.getMessage());
        } finally {
            if (session != null) session.disconnect();
            completeJob(jobId);
        }
    });
}

private void scpFiles(Session session, String jobId) throws Exception {
    String[] mainFiles = {"nemesis-agent.py", "collect.sh", "collect_aix.sh",
                          "control.sh", "install.sh"};
    ChannelSftp sftp = (ChannelSftp) session.openChannel("sftp");
    sftp.connect(5_000);
    try {
        for (String fname : mainFiles) {
            File f = new File(agentFilesDir, fname);
            if (!f.exists()) { emit(jobId, "[WARN] 파일 없음: " + fname + " — 건너뜀"); continue; }
            emit(jobId, "[INFO] 전송 중: " + fname + " (" + f.length() / 1024 + "KB)");
            try (InputStream in = new FileInputStream(f)) {
                sftp.put(in, "/tmp/nemesis-install/" + fname);
            }
            sftp.chmod(0755, "/tmp/nemesis-install/" + fname);
        }
        // healing 스크립트
        File healingDir = new File(agentFilesDir, "healing");
        if (healingDir.isDirectory()) {
            for (File hf : Objects.requireNonNull(healingDir.listFiles())) {
                emit(jobId, "[INFO] 전송 중: healing/" + hf.getName());
                try (InputStream in = new FileInputStream(hf)) {
                    sftp.put(in, "/tmp/nemesis-install/healing/" + hf.getName());
                }
                sftp.chmod(0755, "/tmp/nemesis-install/healing/" + hf.getName());
            }
        }
    } finally {
        sftp.disconnect();
    }
}

private String execCommandStreaming(Session session, String jobId, String cmd) throws Exception {
    ChannelExec exec = (ChannelExec) session.openChannel("exec");
    exec.setCommand(cmd);
    StringBuilder sb = new StringBuilder();
    InputStream in = exec.getInputStream();
    exec.connect(5_000);
    byte[] buf = new byte[1024];
    while (true) {
        while (in.available() > 0) {
            int n = in.read(buf, 0, buf.length);
            if (n < 0) break;
            String chunk = new String(buf, 0, n);
            sb.append(chunk);
            for (String line : chunk.split("\n")) {
                if (!line.isBlank()) emit(jobId, line);
            }
        }
        if (exec.isClosed()) break;
        Thread.sleep(150);
    }
    exec.disconnect();
    return sb.toString();
}

private boolean waitForRegistration(Session session, String mgmtUrl, int timeoutSec) {
    String checkCmd = String.format(
        "curl -sk -o /dev/null -w '%%{http_code}' %s/actuator/health 2>/dev/null || echo 000", mgmtUrl);
    long deadline = System.currentTimeMillis() + timeoutSec * 1000L;
    while (System.currentTimeMillis() < deadline) {
        try {
            String out = execCommand(session, checkCmd).trim();
            if ("200".equals(out)) return true;
            Thread.sleep(2000);
        } catch (Exception e) {
            return false;
        }
    }
    return false;
}
```

- [ ] **Step 2: 필요한 import 추가 (파일 상단)**

`AgentInstallService.java` import 블록에 아래 추가:

```java
import java.nio.file.Files;
```

- [ ] **Step 3: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava 2>&1 | tail -20
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/install/AgentInstallService.java
git commit -m "feat: AgentInstallService - SCP file transfer + async install + SSE streaming"
```

---

## Task 6: AgentInstallController 생성

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/install/AgentInstallController.java`

- [ ] **Step 1: 컨트롤러 생성**

```java
package com.nemesis.domain.install;

import com.nemesis.domain.agent.AgentKey;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.install.dto.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/agent-install")
@RequiredArgsConstructor
public class AgentInstallController {

    private final AgentInstallService installService;
    private final AgentKeyRepository  agentKeyRepository;

    /** Step 2: SSH + 포트 + 핫비트 일괄 검증 */
    @PostMapping("/test")
    public ResponseEntity<TestConnResult> testConnection(@RequestBody TestConnRequest req) {
        return ResponseEntity.ok(installService.testConnection(req));
    }

    /** Step 3: 설치 job 시작. 프론트가 미리 jobId를 만들어 전달한다. */
    @PostMapping("/install")
    public ResponseEntity<Map<String, String>> install(@RequestBody InstallRequest req) {
        if (req.getJobId() == null || req.getJobId().isBlank()) {
            req.setJobId(UUID.randomUUID().toString());
        }
        installService.startInstall(req);
        return ResponseEntity.ok(Map.of("jobId", req.getJobId()));
    }

    /** SSE 로그 스트림. EventSource는 커스텀 헤더 불가 → 토큰을 쿼리 파라미터로 받는다. */
    @GetMapping(value = "/stream/{jobId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable String jobId) {
        return installService.registerEmitter(jobId);
    }

    /** 클러스터별 유효 에이전트 키 목록 */
    @GetMapping("/keys")
    public ResponseEntity<List<Map<String, String>>> listKeys(@RequestParam UUID clusterId) {
        List<Map<String, String>> keys = agentKeyRepository
                .findByClusterIdAndRevokedFalse(clusterId)
                .stream()
                .map(k -> Map.of(
                    "id",     k.getId().toString(),
                    "apiKey", k.getApiKey(),
                    "label",  k.getNode() != null ? k.getNode().getHostname() : "공용 키"
                ))
                .collect(Collectors.toList());
        return ResponseEntity.ok(keys);
    }
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
cd backend && ./gradlew compileJava 2>&1 | tail -10
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/install/AgentInstallController.java
git commit -m "feat: AgentInstallController - test/install/stream/keys endpoints"
```

---

## Task 7: 백엔드 빌드 + 서버 재시작 확인

- [ ] **Step 1: 전체 빌드**

```bash
cd backend && ./gradlew build -x test 2>&1 | tail -10
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 2: 테스트 실행**

```bash
cd backend && ./gradlew test 2>&1 | tail -20
```
Expected: BUILD SUCCESSFUL (기존 테스트 포함 통과)

---

## Task 8: Frontend — API 클라이언트 + 라우트 + 사이드바

**Files:**
- Modify: `frontend/src/api/client.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Sidebar.jsx`

- [ ] **Step 1: client.js에 3개 API 함수 추가**

`client.js` 하단(기존 export 목록 아래)에 추가:

```js
// Agent Install
export const testAgentInstall  = (data)       => client.post('/agent-install/test', data)
export const startAgentInstall = (data)       => client.post('/agent-install/install', data)
export const getClusterAgentKeys = (clusterId) => client.get(`/agent-install/keys?clusterId=${clusterId}`)
```

- [ ] **Step 2: App.jsx에 라우트 추가**

`App.jsx` import 블록에 추가:
```jsx
import AgentInstall from './pages/settings/AgentInstall'
```

Routes 블록의 설정 라우트 부분에 추가:
```jsx
{/* 설정 */}
<Route path="/settings/clusters"        element={<ClustersSettings />} />
<Route path="/settings/agents"          element={<AgentsSettings />} />
<Route path="/settings/agents/install"  element={<AgentInstall />} />   {/* 추가 */}
<Route path="/settings/system"          element={<SystemSettings />} />
```

- [ ] **Step 3: Sidebar.jsx — 시스템 메뉴에 에이전트 설치 추가**

`Sidebar.jsx`의 `MENU` 배열에서 `시스템` 항목 수정:

```js
{ label: '시스템', icon: Settings, path: null, children: [
  { label: '시스템 설정',  path: '/settings/system'          },
  { label: '에이전트 설치', path: '/settings/agents/install' },  // 추가
]},
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/api/client.js frontend/src/App.jsx frontend/src/components/Sidebar.jsx
git commit -m "feat: add AgentInstall route + sidebar link + API client functions"
```

---

## Task 9: Frontend — AgentInstall.jsx (전체 위저드)

**Files:**
- Create: `frontend/src/pages/settings/AgentInstall.jsx`

- [ ] **Step 1: AgentInstall.jsx 생성**

```jsx
import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Terminal, CheckCircle, XCircle, Loader, ChevronRight, ArrowLeft } from 'lucide-react'
import { getClusters, testAgentInstall, startAgentInstall, getClusterAgentKeys } from '../../api/client'
import { getToken } from '../../api/token'

const inputCls = "w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500"

// ─── Step 1: 서버 정보 입력 ────────────────────────────────────────────────
function StepServerInfo({ form, setForm, clusters, onNext }) {
  const valid = form.host && form.sshUser && form.sshPassword && form.clusterId

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white">Step 1 — 대상 서버 정보</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">대상 서버 IP (Real IP)</label>
          <input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
            placeholder="10.0.1.12" className={inputCls} />
          <p className="text-[10px] text-gray-600 mt-1">NEMESIS_SERVICE_IP로 고정됩니다</p>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">핫비트 IP (선택)</label>
          <input value={form.heartbeatIp} onChange={e => setForm(f => ({ ...f, heartbeatIp: e.target.value }))}
            placeholder="비우면 서버 IP와 동일" className={inputCls} />
          <p className="text-[10px] text-gray-600 mt-1">NEMESIS_HEARTBEAT_IP — 별도 NIC 사용 시</p>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">SSH 사용자명</label>
          <input value={form.sshUser} onChange={e => setForm(f => ({ ...f, sshUser: e.target.value }))}
            placeholder="root" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">SSH 비밀번호</label>
          <input type="password" value={form.sshPassword}
            onChange={e => setForm(f => ({ ...f, sshPassword: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">SSH 포트</label>
          <input type="number" value={form.sshPort}
            onChange={e => setForm(f => ({ ...f, sshPort: +e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">클러스터</label>
          <select value={form.clusterId} onChange={e => setForm(f => ({ ...f, clusterId: e.target.value }))}
            className={inputCls}>
            <option value="">— 선택 —</option>
            {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">노드 역할</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            className={inputCls}>
            <option value="STANDBY">STANDBY</option>
            <option value="PRIMARY">PRIMARY</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={onNext} disabled={!valid}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700">
          다음 — 연결 검증 <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: 연결 검증 ────────────────────────────────────────────────────
function CheckRow({ label, ok, error, loading }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-800/50">
      <div className="w-5 h-5 flex-shrink-0">
        {loading ? <Loader className="w-4 h-4 text-blue-400 animate-spin" /> :
         ok      ? <CheckCircle className="w-4 h-4 text-green-400" /> :
                   <XCircle    className="w-4 h-4 text-red-400" />}
      </div>
      <div className="flex-1">
        <span className="text-xs text-white">{label}</span>
        {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
      </div>
    </div>
  )
}

function StepConnTest({ form, onNext, onBack }) {
  const [state, setState] = useState('idle') // idle | testing | done
  const [result, setResult] = useState(null)

  async function runTest() {
    setState('testing')
    try {
      const r = await testAgentInstall({
        host:        form.host,
        sshPort:     form.sshPort,
        sshUser:     form.sshUser,
        sshPassword: form.sshPassword,
        heartbeatIp: form.heartbeatIp,
        clusterId:   form.clusterId || null,
      })
      setResult(r.data)
    } catch (e) {
      setResult({ sshOk: false, sshError: e.message, port17001Ok: false, peerChecks: [] })
    } finally {
      setState('done')
    }
  }

  const allOk = result && result.sshOk && result.port17001Ok &&
                (result.peerChecks ?? []).every(p => p.reachable)

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white">Step 2 — 연결 검증</h3>

      {state === 'idle' && (
        <div className="card-bg rounded-xl p-5 text-center space-y-3">
          <p className="text-xs text-gray-400">SSH 연결, 포트, 핫비트 통신을 일괄 확인합니다.</p>
          <button onClick={runTest}
            className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
            연결 검증 시작
          </button>
        </div>
      )}

      {(state === 'testing' || state === 'done') && result && (
        <div className="card-bg rounded-xl p-5 space-y-1">
          <CheckRow label={`SSH 접속 (${form.host}:${form.sshPort})`}
            ok={result.sshOk} error={result.sshError} loading={state === 'testing' && !result.sshOk && !result.sshError} />
          <CheckRow label="관리서버 → 대상 17001 (명령 채널)"
            ok={result.port17001Ok} error={result.port17001Error} loading={false} />
          {(result.peerChecks ?? []).map(p => (
            <CheckRow key={p.nodeHostname}
              label={`${form.host} → ${p.nodeHostname} (${p.heartbeatIp}:17000) 핫비트`}
              ok={p.reachable} error={p.error} loading={false} />
          ))}
        </div>
      )}

      {state === 'done' && !allOk && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between">
          <p className="text-xs text-yellow-400">일부 항목이 실패했습니다. 방화벽을 확인하세요.</p>
          <button onClick={() => onNext(true)}
            className="text-xs text-yellow-400 underline ml-4 flex-shrink-0">경고 무시하고 진행</button>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <ArrowLeft className="w-3.5 h-3.5" /> 이전
        </button>
        <button onClick={() => onNext(false)} disabled={!allOk}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-blue-700">
          다음 — 설치 <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: 설치 실행 + SSE 로그 ─────────────────────────────────────────
function StepInstall({ form, onBack }) {
  const navigate = useNavigate()
  const [keys, setKeys]     = useState([])
  const [apiKey, setApiKey] = useState('')
  const [logs, setLogs]     = useState([])
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const logRef = useRef(null)

  useEffect(() => {
    if (form.clusterId) {
      getClusterAgentKeys(form.clusterId)
        .then(r => { setKeys(r.data); if (r.data.length > 0) setApiKey(r.data[0].apiKey) })
        .catch(() => {})
    }
  }, [form.clusterId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  async function runInstall() {
    const jobId = crypto.randomUUID()
    setLogs([])
    setStatus('running')

    // SSE 먼저 구독
    const token = getToken()
    const es = new EventSource(`/api/agent-install/stream/${jobId}${token ? '?token=' + token : ''}`)
    es.onmessage = e => {
      setLogs(prev => [...prev, e.data])
      if (e.data.startsWith('[SUCCESS]')) setStatus('done')
      if (e.data.startsWith('[ERROR]'))   setStatus('error')
    }
    es.onerror = () => { es.close(); setStatus(s => s === 'running' ? 'error' : s) }

    // 설치 시작
    try {
      await startAgentInstall({
        jobId,
        host:          form.host,
        sshPort:       form.sshPort,
        sshUser:       form.sshUser,
        sshPassword:   form.sshPassword,
        heartbeatIp:   form.heartbeatIp,
        clusterId:     form.clusterId,
        role:          form.role,
        apiKey,
      })
    } catch (e) {
      setLogs(prev => [...prev, '[ERROR] 설치 요청 실패: ' + e.message])
      setStatus('error')
      es.close()
    }
  }

  const lineColor = line => {
    if (line.startsWith('[SUCCESS]')) return 'text-green-400'
    if (line.startsWith('[ERROR]'))   return 'text-red-400'
    if (line.startsWith('[WARN]'))    return 'text-yellow-400'
    return 'text-gray-300'
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white">Step 3 — 설치 실행</h3>

      {status === 'idle' && (
        <div className="card-bg rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase mb-1">에이전트 API 키</label>
            {keys.length > 0 ? (
              <select value={apiKey} onChange={e => setApiKey(e.target.value)} className={inputCls}>
                {keys.map(k => <option key={k.id} value={k.apiKey}>{k.label} — {k.apiKey.slice(0, 12)}…</option>)}
              </select>
            ) : (
              <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="API 키를 직접 입력" className={inputCls} />
            )}
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <p>• 대상: <span className="text-white font-mono">{form.host}</span></p>
            <p>• NEMESIS_SERVICE_IP: <span className="text-blue-400 font-mono">{form.host}</span></p>
            <p>• NEMESIS_HEARTBEAT_IP: <span className="text-blue-400 font-mono">{form.heartbeatIp || form.host}</span></p>
            <p>• 역할: <span className="text-white">{form.role}</span></p>
          </div>
        </div>
      )}

      {/* 터미널 로그 */}
      {logs.length > 0 && (
        <div ref={logRef}
          className="bg-gray-950 border border-gray-800 rounded-xl p-4 h-64 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.map((l, i) => (
            <div key={i} className={lineColor(l)}>{l}</div>
          ))}
          {status === 'running' && (
            <div className="flex items-center gap-2 text-gray-500 mt-1">
              <Loader className="w-3 h-3 animate-spin" /> 실행 중...
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} disabled={status === 'running'}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white disabled:opacity-40">
          <ArrowLeft className="w-3.5 h-3.5" /> 이전
        </button>
        {status === 'idle' && (
          <button onClick={runInstall} disabled={!apiKey}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 text-white text-xs font-bold disabled:opacity-40 hover:bg-green-700">
            <Terminal className="w-3.5 h-3.5" /> 설치 시작
          </button>
        )}
        {status === 'done' && (
          <button onClick={() => navigate('/settings/agents')}
            className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
            에이전트 관리로 이동
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 메인 위저드 컴포넌트 ─────────────────────────────────────────────────
const STEPS = ['서버 정보', '연결 검증', '설치']

export default function AgentInstall() {
  const [step, setStep] = useState(0)
  const [clusters, setClusters] = useState([])
  const [form, setForm] = useState({
    host: '', sshPort: 22, sshUser: 'root', sshPassword: '',
    heartbeatIp: '', clusterId: '', role: 'STANDBY',
  })

  useEffect(() => {
    getClusters().then(r => setClusters(r.data)).catch(() => {})
  }, [])

  return (
    <div className="p-8 pt-0 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">에이전트 설치</h2>
        <p className="text-xs text-gray-500 mt-1">SSH를 통해 대상 서버에 Nemesis 에이전트를 원격 설치합니다</p>
      </div>

      {/* 스텝 인디케이터 */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium
              ${i === step ? 'bg-blue-600/20 text-blue-400' :
                i < step   ? 'text-green-400' : 'text-gray-600'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                ${i === step ? 'bg-blue-600 text-white' :
                  i < step   ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              {s}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-gray-700 mx-1" />}
          </React.Fragment>
        ))}
      </div>

      {/* 스텝 컨텐츠 */}
      <div className="card-bg rounded-xl p-6">
        {step === 0 && (
          <StepServerInfo form={form} setForm={setForm} clusters={clusters}
            onNext={() => setStep(1)} />
        )}
        {step === 1 && (
          <StepConnTest form={form}
            onNext={(force) => setStep(2)}
            onBack={() => setStep(0)} />
        )}
        {step === 2 && (
          <StepInstall form={form} onBack={() => setStep(1)} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/pages/settings/AgentInstall.jsx
git commit -m "feat: AgentInstall wizard - 3-step SSH install with SSE log streaming"
```

---

## Task 10: 동작 확인

- [ ] **Step 1: 백엔드 기동**

```bash
cd backend && ./gradlew bootRun 2>&1 | tail -5
```
Expected: Started NemesisApplication on port 18080

- [ ] **Step 2: 프론트엔드 기동**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: 브라우저에서 확인**

1. `http://localhost:5173/settings/agents/install` 접속
2. 사이드바 시스템 메뉴 → "에이전트 설치" 링크 확인
3. Step 1: 서버 정보 입력 → "다음" 버튼 활성화 확인
4. Step 2: "연결 검증 시작" 클릭 → 체크 항목 표시 확인
5. Step 3: API 키 선택 → "설치 시작" 클릭 → 터미널 로그 스트리밍 확인

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: complete agent SSH install wizard with real-time SSE log"
```
