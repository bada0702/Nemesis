package com.nemesis.domain.sync;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 폴더 동기화 실행: active 식별 → standby의 heartbeat IP로 rsync 명령 전송 → 이력 적재. */
@Slf4j
@Service
@RequiredArgsConstructor
public class SyncService {

    private final NodeRepository        nodeRepo;
    private final SyncJobRepository     jobRepo;
    private final SyncHistoryRepository historyRepo;
    private final AgentCommandClient    commandClient;

    private final Set<UUID> running = ConcurrentHashMap.newKeySet();
    private static final Pattern STATS =
            Pattern.compile("NEMESIS_SYNC\\s+\\{\"files\":(\\d+),\"bytes\":(\\d+)\\}");

    @Transactional
    public Map<String, Object> runJob(UUID jobId, SyncHistory.Trigger trigger) {
        SyncJob job = jobRepo.findById(jobId)
                .orElseThrow(() -> new IllegalArgumentException("작업 없음: " + jobId));
        if (!running.add(jobId)) {
            return Map.of("status", "BUSY", "message", "이미 실행 중");
        }
        try {
            List<Node> nodes = nodeRepo.findByClusterId(job.getClusterId());
            Node active = nodes.stream().filter(n -> n.getRole() == Node.Role.active).findFirst().orElse(null);
            if (active == null) {
                record(job, trigger, SyncHistory.Status.SKIPPED, null, null, 0, 0, 0, "active 노드 없음");
                return Map.of("status", "SKIPPED", "message", "active 노드 없음");
            }
            List<Node> standbys = nodes.stream().filter(n -> n.getRole() == Node.Role.standby).toList();
            int ok = 0, failed = 0, skipped = 0;
            for (Node sb : standbys) {
                if (sb.getHeartbeatIp() == null || sb.getHeartbeatIp().isBlank()) {
                    record(job, trigger, SyncHistory.Status.SKIPPED, active.getId(), sb.getId(),
                            0, 0, 0, "heartbeat IP 미설정: " + sb.getHostname());
                    skipped++;
                    continue;
                }
                String cmd = buildSyncCommand(job, sb.getHeartbeatIp());
                long t0 = System.currentTimeMillis();
                AgentCommandClient.Result r = commandClient.execute(active, cmd);
                long dur = System.currentTimeMillis() - t0;
                if (r.ok()) {
                    long[] st = parseStats(r.stdout());
                    record(job, trigger, SyncHistory.Status.SUCCESS, active.getId(), sb.getId(),
                            st[1], (int) st[0], dur, null);
                    ok++;
                } else {
                    String msg = r.error() != null ? r.error() : r.stderr();
                    record(job, trigger, SyncHistory.Status.FAILED, active.getId(), sb.getId(),
                            0, 0, dur, msg);
                    failed++;
                }
            }
            job.setLastRunAt(java.time.OffsetDateTime.now());
            jobRepo.save(job);
            return Map.of("status", "DONE", "success", ok, "failed", failed, "skipped", skipped);
        } finally {
            running.remove(jobId);
        }
    }

    String buildSyncCommand(SyncJob job, String hbIp) {
        StringBuilder sb = new StringBuilder("control.sh dir-sync ")
                .append(hbIp).append(' ')
                .append(job.getSourcePath()).append(' ')
                .append(job.getDestPath());
        if (job.isMirrorDelete()) sb.append(" --delete");
        if (job.getExcludes() != null && !job.getExcludes().isBlank()) {
            for (String ex : job.getExcludes().split("[,\\n]")) {
                String e = ex.trim();
                if (!e.isEmpty()) sb.append(" --exclude=").append(e);
            }
        }
        return sb.toString();
    }

    long[] parseStats(String stdout) {
        if (stdout != null) {
            Matcher m = STATS.matcher(stdout);
            if (m.find()) return new long[]{Long.parseLong(m.group(1)), Long.parseLong(m.group(2))};
        }
        return new long[]{0, 0};
    }

    private void record(SyncJob job, SyncHistory.Trigger trigger, SyncHistory.Status status,
                        UUID from, UUID to, long bytes, int files, long dur, String msg) {
        historyRepo.save(SyncHistory.builder()
                .job(job).triggerType(trigger).status(status)
                .fromNodeId(from).toNodeId(to)
                .bytesTransferred(bytes).filesCount(files).durationMs(dur)
                .message(msg).build());
    }

    public List<SyncHistory> history(UUID clusterId) {
        return historyRepo.findTop50ByJob_ClusterIdOrderByCreatedAtDesc(clusterId);
    }

    public java.util.List<SyncJob> listJobs(UUID clusterId) { return jobRepo.findByClusterId(clusterId); }

    @Transactional
    public SyncJob createJob(UUID clusterId, SyncJob in) {
        in.setId(null);
        in.setClusterId(clusterId);
        if (in.getDestPath() == null || in.getDestPath().isBlank()) in.setDestPath(in.getSourcePath());
        return jobRepo.save(in);
    }

    @Transactional
    public SyncJob updateJob(UUID jobId, SyncJob in) {
        SyncJob j = jobRepo.findById(jobId).orElseThrow(() -> new IllegalArgumentException("작업 없음"));
        j.setName(in.getName());
        j.setSourcePath(in.getSourcePath());
        j.setDestPath((in.getDestPath() == null || in.getDestPath().isBlank()) ? in.getSourcePath() : in.getDestPath());
        j.setMirrorDelete(in.isMirrorDelete());
        j.setExcludes(in.getExcludes());
        j.setScheduleSec(in.getScheduleSec());
        j.setEnabled(in.isEnabled());
        return jobRepo.save(j);
    }

    @Transactional
    public void deleteJob(UUID jobId) { jobRepo.deleteById(jobId); }

    /** 지정 노드의 경로 하위 디렉토리 목록(읽기전용). */
    public java.util.List<String> listDirs(UUID nodeId, String path) {
        Node node = nodeRepo.findById(nodeId).orElseThrow(() -> new IllegalArgumentException("노드 없음"));
        String p = (path == null || path.isBlank()) ? "/" : path;
        AgentCommandClient.Result r = commandClient.execute(node, "control.sh dir-list " + p);
        java.util.List<String> dirs = new java.util.ArrayList<>();
        if (r.ok() && r.stdout() != null) {
            for (String line : r.stdout().split("\n")) {
                String name = line.split("\t")[0].trim();
                if (!name.isEmpty()) dirs.add(name);
            }
        }
        return dirs;
    }
}
