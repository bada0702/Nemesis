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

    private final Map<String, SseEmitter>   emitters  = new ConcurrentHashMap<>();
    private final Map<String, List<String>> logBuffer = new ConcurrentHashMap<>();

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    public String resolveHeartbeatIp(String host, String heartbeatIp) {
        return (heartbeatIp == null || heartbeatIp.isBlank()) ? host : heartbeatIp;
    }

    public TestConnResult testConnection(TestConnRequest req) {
        TestConnResult.TestConnResultBuilder result = TestConnResult.builder();
        Session session = null;

        try {
            session = openSession(req.getHost(), req.getSshPort() > 0 ? req.getSshPort() : 22,
                    req.getSshUser(), req.getSshPassword());
            result.sshOk(true);
        } catch (Exception e) {
            return result.sshOk(false).sshError(e.getMessage())
                         .port17001Ok(false).port17001Error("SSH 실패로 건너뜀")
                         .peerChecks(List.of()).build();
        }

        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(req.getHost(), 17001), 3000);
            result.port17001Ok(true);
        } catch (Exception e) {
            result.port17001Ok(false).port17001Error("포트 17001 미응답: " + e.getMessage());
        }

        List<Node> peers = req.getClusterId() != null
                ? nodeRepository.findByClusterId(req.getClusterId())
                : List.of();
        List<TestConnResult.PeerCheck> peerChecks = new ArrayList<>();
        for (Node peer : peers) {
            if (peer.getIpAddress() == null) continue;
            peerChecks.add(checkHeartbeatViaSsh(session, peer.getHostname(), peer.getIpAddress()));
        }
        result.peerChecks(peerChecks);

        session.disconnect();
        return result.build();
    }

    public void startInstall(InstallRequest req) {
        String jobId       = req.getJobId();
        String serviceIp   = req.getHost();
        String heartbeatIp = resolveHeartbeatIp(serviceIp, req.getHeartbeatIp());
        String mgmtUrl     = (req.getManagementUrl() != null && !req.getManagementUrl().isBlank())
                             ? req.getManagementUrl() : managementUrl;

        CompletableFuture.runAsync(() -> {
            Session session = null;
            try {
                emit(jobId, "[INFO] SSH 연결 중 (" + serviceIp + ":" + (req.getSshPort() > 0 ? req.getSshPort() : 22) + ")...");
                session = openSession(serviceIp,
                        req.getSshPort() > 0 ? req.getSshPort() : 22,
                        req.getSshUser(), req.getSshPassword());
                emit(jobId, "[INFO] SSH 연결 완료");

                emit(jobId, "[INFO] 원격 디렉토리 생성: /tmp/nemesis-install/");
                execCommand(session, "mkdir -p /tmp/nemesis-install/healing");

                scpFiles(session, jobId);

                emit(jobId, "[INFO] install.sh 실행 중...");
                execCommandStreaming(session, jobId, "cd /tmp/nemesis-install && sh install.sh 2>&1");

                String startCmd = String.format(
                    "NEMESIS_SERVICE_IP=%s NEMESIS_HEARTBEAT_IP=%s " +
                    "nohup python3 /opt/nemesis-agent/nemesis-agent.py start " +
                    "--server %s --key %s > /var/log/nemesis-agent.log 2>&1 &",
                    serviceIp, heartbeatIp, mgmtUrl, req.getApiKey());
                emit(jobId, "[INFO] 에이전트 시작 중 (NEMESIS_SERVICE_IP=" + serviceIp + ")...");
                execCommand(session, startCmd);

                emit(jobId, "[INFO] 관리서버 등록 확인 중...");
                boolean registered = waitForRegistration(session, mgmtUrl, 15);
                if (registered) {
                    emit(jobId, "[SUCCESS] 에이전트 설치 완료! 서버: " + serviceIp);
                } else {
                    emit(jobId, "[WARN] 에이전트가 시작됐으나 등록 확인 시간 초과. 로그: /var/log/nemesis-agent.log");
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

    public SseEmitter registerEmitter(String jobId) {
        SseEmitter emitter = new SseEmitter(300_000L);
        emitters.put(jobId, emitter);

        List<String> buffered = logBuffer.getOrDefault(jobId, List.of());
        for (String line : buffered) {
            try { emitter.send(SseEmitter.event().data(line)); } catch (Exception ignored) {}
        }

        emitter.onCompletion(() -> { emitters.remove(jobId); logBuffer.remove(jobId); });
        emitter.onTimeout(()    -> { emitters.remove(jobId); logBuffer.remove(jobId); });
        return emitter;
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

    private TestConnResult.PeerCheck checkHeartbeatViaSsh(Session session, String hostname, String peerIp) {
        try {
            String cmd = String.format(
                "nc -z -w2 %s 17000 2>/dev/null && echo OK || " +
                "(timeout 2 bash -c 'echo > /dev/tcp/%s/17000' 2>/dev/null && echo OK || echo FAIL)",
                peerIp, peerIp);
            String out = execCommand(session, cmd).trim();
            boolean ok = "OK".equals(out);
            return TestConnResult.PeerCheck.builder()
                    .nodeHostname(hostname).heartbeatIp(peerIp)
                    .reachable(ok).error(ok ? null : "17000 포트 미응답 (" + peerIp + ")")
                    .build();
        } catch (Exception e) {
            return TestConnResult.PeerCheck.builder()
                    .nodeHostname(hostname).heartbeatIp(peerIp)
                    .reachable(false).error(e.getMessage())
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
        long deadline = System.currentTimeMillis() + 30_000;
        while (!exec.isClosed() && System.currentTimeMillis() < deadline) {
            Thread.sleep(100);
        }
        exec.disconnect();
        return out.toString();
    }

    private void execCommandStreaming(Session session, String jobId, String cmd) throws Exception {
        ChannelExec exec = (ChannelExec) session.openChannel("exec");
        exec.setCommand(cmd);
        InputStream in = exec.getInputStream();
        exec.connect(5_000);
        byte[] buf = new byte[1024];
        StringBuilder lineBuf = new StringBuilder();
        while (true) {
            while (in.available() > 0) {
                int n = in.read(buf, 0, buf.length);
                if (n < 0) break;
                String chunk = new String(buf, 0, n);
                lineBuf.append(chunk);
                int nl;
                while ((nl = lineBuf.indexOf("\n")) >= 0) {
                    String line = lineBuf.substring(0, nl).stripTrailing();
                    if (!line.isBlank()) emit(jobId, line);
                    lineBuf.delete(0, nl + 1);
                }
            }
            if (exec.isClosed()) break;
            Thread.sleep(150);
        }
        if (!lineBuf.isEmpty()) emit(jobId, lineBuf.toString().stripTrailing());
        exec.disconnect();
    }

    private void scpFiles(Session session, String jobId) throws Exception {
        String[] mainFiles = {"nemesis-agent.py", "collect.sh", "collect_aix.sh", "control.sh", "install.sh"};
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
            File healingDir = new File(agentFilesDir, "healing");
            if (healingDir.isDirectory()) {
                File[] scripts = healingDir.listFiles();
                if (scripts != null) {
                    for (File hf : scripts) {
                        emit(jobId, "[INFO] 전송 중: healing/" + hf.getName());
                        try (InputStream in = new FileInputStream(hf)) {
                            sftp.put(in, "/tmp/nemesis-install/healing/" + hf.getName());
                        }
                        sftp.chmod(0755, "/tmp/nemesis-install/healing/" + hf.getName());
                    }
                }
            }
        } finally {
            sftp.disconnect();
        }
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
        logBuffer.remove(jobId);
    }
}
