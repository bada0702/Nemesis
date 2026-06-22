# 노드 간 폴더 동기화 (Directory Sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클러스터 설정에서 디렉토리를 선택해 active→standby 노드로 rsync(SSH, heartbeat IP 경유) 복제하는 기능을 추가한다(주기+수동, Phase 1).

**Architecture:** control.sh에 읽기전용 `dir-list` / rsync 실행 `dir-sync` / SSH 키 `ssh-keygen-nemesis`·`ssh-authorize` 서브커맨드를 추가(에이전트 화이트리스트 무수정). 백엔드 `domain/sync` 패키지가 active 노드를 동적 식별해 17001 명령채널(serviceIp)로 active에 `dir-sync`를 시키고, active가 standby의 **heartbeat IP**로 rsync over SSH 전송한다. 결과를 `sync_history`에 적재한다. 프론트는 ClusterSettings에 `DirSyncPanel`을 추가한다.

**Tech Stack:** Spring Boot(JPA/Flyway), POSIX sh(rsync/ssh-keygen), React(axios), 기존 `AgentCommandClient`/`RbacFilter` 재사용.

## Global Constraints

- rsync 데이터 전송은 **무조건 대상 노드의 `heartbeat_ip` 경유**. heartbeat_ip 없으면 해당 노드 `SKIPPED`.
- 방향은 항상 **active → standby**. active는 매 실행 시 `role=active`로 동적 식별.
- 제어 명령(17001)은 active의 `serviceIp` 사용. 파일 전송만 heartbeat IP.
- mirror(`--delete`) 기본 OFF. dest 경로 미지정 시 source와 동일.
- 모든 명령은 control.sh 화이트리스트 내. 에이전트(`nemesis-agent.py`)는 수정하지 않는다.
- 실시간(inotify)은 범위 외(Phase 2).
- RBAC: 설정 변경/수동 실행/SSH 프로비저닝 = operator+ (기존 `RbacFilter` 패턴).
- 백엔드 테스트는 기존 Mockito 단위테스트 패턴(`FailoverOrchestratorTest`)을 따른다. 셸은 `sh -n` + 기능 호출. 프론트는 `vite build`.
- Flyway 다음 번호: **V15**.

---

### Task 1: control.sh — dir-list / dir-sync / ssh-keygen-nemesis / ssh-authorize 서브커맨드

**Files:**
- Modify: `agent/control.sh` (헬퍼 함수 추가 + `case "$SUB"` 디스패치 추가 + 헤더 주석)
- Test: 셸 직접 호출(아래 Step들)

**Interfaces:**
- Produces (control.sh CLI 계약, 백엔드가 의존):
  - `control.sh dir-list <path>` → stdout: `이름\tdir` 라인들. 미존재=exit 2.
  - `control.sh dir-sync <destHbIp> <src> <dst> [--delete] [--exclude=PAT]` → 성공 시 마지막 라인 `NEMESIS_SYNC {"files":N,"bytes":N}`, exit 0. 실패 exit 1.
  - `control.sh ssh-keygen-nemesis` → stdout: 공개키 1줄, exit 0(멱등).
  - `control.sh ssh-authorize <pubkey>` → authorized_keys에 멱등 추가, exit 0.

- [ ] **Step 1: 헬퍼 함수 추가** — `agent/control.sh`에서 `docker_images()` 함수 다음(또는 `SUB=$1` 라인 위)에 추가:

```sh
# ── Phase: 폴더 동기화(dir-sync) ───────────────────────────────────────────
# rsync 전용 SSH 계정. install.sh가 보장(없으면 root 홈 폴백).
SYNC_USER=${NEMESIS_SYNC_USER:-nemesis}

_sync_home() {
  h=$(eval echo "~${SYNC_USER}" 2>/dev/null)
  case "$h" in ~*|"") h="/home/${SYNC_USER}" ;; esac
  [ -d "$h" ] || h=$(eval echo ~ 2>/dev/null)
  echo "$h"
}

# 읽기전용: 지정 경로의 하위 디렉토리만 TSV(name\tdir)로 출력
dir_list() {
  path=$1; [ -n "$path" ] || usage
  [ -d "$path" ] || { log "경로 없음: $path"; exit 2; }
  ls -1Ap "$path" 2>/dev/null | grep '/$' | sed 's#/$##' | while IFS= read -r d; do
    printf '%s\tdir\n' "$d"
  done
}

# active에서 실행: heartbeat IP로 standby에 rsync over SSH
dir_sync() {
  dest_ip=$1; src=$2; dst=$3
  [ -n "$dest_ip" ] && [ -n "$src" ] && [ -n "$dst" ] || usage
  [ $# -ge 3 ] && shift 3 || shift $#
  has rsync || die "rsync 미설치"
  flags="-az --stats"
  for a in "$@"; do
    case "$a" in
      --delete)    flags="$flags --delete" ;;
      --exclude=*) flags="$flags --exclude=${a#--exclude=}" ;;
    esac
  done
  ssh_opts="ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10"
  # shellcheck disable=SC2086
  out=$(rsync $flags -e "$ssh_opts" "$src/" "${SYNC_USER}@${dest_ip}:${dst}/" 2>&1) \
    || { log "rsync 실패: $out"; exit 1; }
  files=$(printf '%s\n' "$out" | sed -n 's/^Number of regular files transferred: *//p' | tr -d ', ')
  bytes=$(printf '%s\n' "$out" | sed -n 's/^Total transferred file size: *//p' | sed 's/ bytes//' | tr -d ', ')
  echo "NEMESIS_SYNC {\"files\":${files:-0},\"bytes\":${bytes:-0}}"
  exit 0
}

# SSH 키쌍 없으면 생성, 공개키 출력(멱등)
ssh_keygen_nemesis() {
  d="$(_sync_home)/.ssh"
  mkdir -p "$d"; chmod 700 "$d"
  key="$d/id_ed25519"
  [ -f "$key" ] || ssh-keygen -t ed25519 -N "" -f "$key" -q || die "키 생성 실패"
  chown -R "${SYNC_USER}" "$d" 2>/dev/null || true
  cat "${key}.pub" || die "공개키 읽기 실패"
}

# peer 공개키를 authorized_keys에 멱등 추가
ssh_authorize() {
  pub="$*"; [ -n "$pub" ] || usage
  d="$(_sync_home)/.ssh"
  mkdir -p "$d"; chmod 700 "$d"
  ak="$d/authorized_keys"; touch "$ak"; chmod 600 "$ak"
  grep -qF "$pub" "$ak" || echo "$pub" >> "$ak"
  chown -R "${SYNC_USER}" "$d" 2>/dev/null || true
  log "authorized"; exit 0
}
```

- [ ] **Step 2: `case "$SUB"` 디스패치에 항목 추가** — `docker-images) docker_images ;;` 다음 줄에 추가:

```sh
  dir-list)           dir_list "$1" ;;
  dir-sync)           dir_sync "$@" ;;
  ssh-keygen-nemesis) ssh_keygen_nemesis ;;
  ssh-authorize)      ssh_authorize "$@" ;;
```

- [ ] **Step 3: 헤더 주석 서브커맨드 목록에 추가** — `#   svc-status ...` 줄 다음에:

```sh
#   dir-list  <path>                    하위 디렉토리 목록(TSV, 읽기전용)
#   dir-sync  <destHbIp> <src> <dst> [--delete] [--exclude=PAT]  rsync over SSH
#   ssh-keygen-nemesis                  rsync용 SSH 키 생성, 공개키 출력(멱등)
#   ssh-authorize <pubkey>              peer 공개키 신뢰 등록(멱등)
```

- [ ] **Step 4: 문법 검증** — Run: `sh -n agent/control.sh`  Expected: 출력 없음(통과).

- [ ] **Step 5: dir-list 기능 검증** — Run:
```bash
mkdir -p /tmp/dstest/a /tmp/dstest/b && touch /tmp/dstest/f.txt
sh agent/control.sh dir-list /tmp/dstest
```
Expected: `a\tdir` 와 `b\tdir` 두 줄(파일 `f.txt`는 제외).

- [ ] **Step 6: dir-list 미존재 경로** — Run: `sh agent/control.sh dir-list /no/such/path; echo "exit=$?"`  Expected: `exit=2`.

- [ ] **Step 7: ssh-keygen 멱등 검증** — Run:
```bash
NEMESIS_SYNC_USER=$(whoami) sh agent/control.sh ssh-keygen-nemesis | head -c 20
NEMESIS_SYNC_USER=$(whoami) sh agent/control.sh ssh-keygen-nemesis | head -c 20
```
Expected: 두 번 모두 동일한 `ssh-ed25519 AAAA...` 접두 출력(재생성 안 함).

- [ ] **Step 8: 커밋**
```bash
git add agent/control.sh
git commit -m "feat(agent): control.sh에 dir-list/dir-sync/ssh-* 서브커맨드 추가"
```

---

### Task 2: Flyway V15 스키마 + JPA 엔티티(SyncJob, SyncHistory) + 리포지토리

**Files:**
- Create: `backend/src/main/resources/db/migration/V15__directory_sync.sql`
- Create: `backend/src/main/java/com/nemesis/domain/sync/SyncJob.java`
- Create: `backend/src/main/java/com/nemesis/domain/sync/SyncHistory.java`
- Create: `backend/src/main/java/com/nemesis/domain/sync/SyncJobRepository.java`
- Create: `backend/src/main/java/com/nemesis/domain/sync/SyncHistoryRepository.java`

**Interfaces:**
- Produces:
  - `SyncJob`(getters): `UUID getId()`, `UUID getClusterId()`, `String getName()`, `String getSourcePath()`, `String getDestPath()`, `boolean isMirrorDelete()`, `String getExcludes()`, `int getScheduleSec()`, `boolean isEnabled()`, `OffsetDateTime getLastRunAt()`, `setLastRunAt(OffsetDateTime)`
  - `SyncHistory.Trigger` enum {SCHEDULED, MANUAL, REALTIME}; `SyncHistory.Status` enum {SUCCESS, FAILED, SKIPPED}
  - `SyncJobRepository extends JpaRepository<SyncJob, UUID>`: `List<SyncJob> findByClusterId(UUID)`, `List<SyncJob> findByEnabledTrueAndScheduleSecGreaterThan(int)`
  - `SyncHistoryRepository extends JpaRepository<SyncHistory, Long>`: `List<SyncHistory> findTop50ByJob_ClusterIdOrderByCreatedAtDesc(UUID)`

- [ ] **Step 1: 마이그레이션 작성** — `V15__directory_sync.sql`:

```sql
CREATE TABLE sync_jobs (
    id               UUID PRIMARY KEY,
    cluster_group_id UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    name             VARCHAR(200) NOT NULL,
    source_path      TEXT NOT NULL,
    dest_path        TEXT NOT NULL,
    mirror_delete    BOOLEAN NOT NULL DEFAULT FALSE,
    excludes         TEXT,
    schedule_sec     INTEGER NOT NULL DEFAULT 0,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_jobs_cluster ON sync_jobs(cluster_group_id);

CREATE TABLE sync_history (
    id                BIGSERIAL PRIMARY KEY,
    sync_job_id       UUID NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
    trigger_type      VARCHAR(20) NOT NULL,
    status            VARCHAR(20) NOT NULL,
    from_node_id      UUID,
    to_node_id        UUID,
    bytes_transferred BIGINT NOT NULL DEFAULT 0,
    files_count       INTEGER NOT NULL DEFAULT 0,
    duration_ms       BIGINT NOT NULL DEFAULT 0,
    message           TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_history_job ON sync_history(sync_job_id, created_at DESC);
```

- [ ] **Step 2: SyncJob 엔티티** — `SyncJob.java` (ConfigSnapshot 스타일):

```java
package com.nemesis.domain.sync;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** 클러스터별 폴더 동기화 작업 정의(1행=1폴더쌍). 방향은 active→standby. */
@Entity
@Table(name = "sync_jobs")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SyncJob {

    @Id private UUID id;

    @Column(name = "cluster_group_id", nullable = false) private UUID clusterId;
    @Column(nullable = false, length = 200) private String name;
    @Column(name = "source_path", columnDefinition = "TEXT", nullable = false) private String sourcePath;
    @Column(name = "dest_path",   columnDefinition = "TEXT", nullable = false) private String destPath;
    @Column(name = "mirror_delete", nullable = false) private boolean mirrorDelete;
    @Column(columnDefinition = "TEXT") private String excludes;
    @Column(name = "schedule_sec", nullable = false) private int scheduleSec;
    @Column(nullable = false) private boolean enabled = true;
    @Column(name = "last_run_at") private OffsetDateTime lastRunAt;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;
    @Column(name = "updated_at") private OffsetDateTime updatedAt;

    @PrePersist void prePersist() {
        if (id == null) id = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }
    @PreUpdate void preUpdate() { updatedAt = OffsetDateTime.now(); }
}
```

- [ ] **Step 3: SyncHistory 엔티티** — `SyncHistory.java`:

```java
package com.nemesis.domain.sync;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;
import java.util.UUID;

/** 동기화 실행 1회 결과. */
@Entity
@Table(name = "sync_history")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SyncHistory {

    public enum Trigger { SCHEDULED, MANUAL, REALTIME }
    public enum Status  { SUCCESS, FAILED, SKIPPED }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sync_job_id", nullable = false)
    private SyncJob job;

    @Enumerated(EnumType.STRING) @Column(name = "trigger_type", nullable = false, length = 20) private Trigger triggerType;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private Status status;
    @Column(name = "from_node_id") private UUID fromNodeId;
    @Column(name = "to_node_id")   private UUID toNodeId;
    @Column(name = "bytes_transferred", nullable = false) private long bytesTransferred;
    @Column(name = "files_count", nullable = false) private int filesCount;
    @Column(name = "duration_ms", nullable = false) private long durationMs;
    @Column(columnDefinition = "TEXT") private String message;
    @Column(name = "created_at", updatable = false) private OffsetDateTime createdAt;

    @PrePersist void prePersist() { if (createdAt == null) createdAt = OffsetDateTime.now(); }
}
```

- [ ] **Step 4: 리포지토리 2종** — `SyncJobRepository.java`:

```java
package com.nemesis.domain.sync;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SyncJobRepository extends JpaRepository<SyncJob, UUID> {
    List<SyncJob> findByClusterId(UUID clusterId);
    List<SyncJob> findByEnabledTrueAndScheduleSecGreaterThan(int sec);
}
```

`SyncHistoryRepository.java`:

```java
package com.nemesis.domain.sync;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SyncHistoryRepository extends JpaRepository<SyncHistory, Long> {
    List<SyncHistory> findTop50ByJob_ClusterIdOrderByCreatedAtDesc(UUID clusterId);
}
```

- [ ] **Step 5: 컴파일 검증** — Run(Docker gradle, 로컬 JDK 없음): `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle compileJava -q`  Expected: BUILD SUCCESSFUL(엔티티/리포지토리 매핑 오류 없음).

- [ ] **Step 6: 커밋**
```bash
git add backend/src/main/resources/db/migration/V15__directory_sync.sql backend/src/main/java/com/nemesis/domain/sync/
git commit -m "feat(sync): V15 스키마 + SyncJob/SyncHistory 엔티티·리포지토리"
```

---

### Task 3: SyncService — active 식별·heartbeat IP 가드·명령 조립·이력 적재 (핵심 로직, TDD)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/sync/SyncService.java`
- Test: `backend/src/test/java/com/nemesis/domain/sync/SyncServiceTest.java`

**Interfaces:**
- Consumes: `AgentCommandClient.execute(Node, String) -> Result(boolean ok, int exitCode, String stdout, String stderr, String error)`; `NodeRepository.findByClusterId(UUID)`; `Node.getRole()`(Role.active/standby), `getHeartbeatIp()`, `getServiceIp()`, `getId()`, `getHostname()`; `SyncJobRepository`, `SyncHistoryRepository`.
- Produces:
  - `Map<String,Object> runJob(UUID jobId, SyncHistory.Trigger trigger)` — 작업 1건 실행, 결과 요약 반환.
  - `String buildSyncCommand(SyncJob job, String hbIp)` (package-private, 테스트 대상).
  - `long[] parseStats(String stdout)` → `[files, bytes]` (package-private).

- [ ] **Step 1: 실패 테스트 작성** — `SyncServiceTest.java`:

```java
package com.nemesis.domain.sync;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class SyncServiceTest {

    private final NodeRepository nodeRepo = mock(NodeRepository.class);
    private final SyncJobRepository jobRepo = mock(SyncJobRepository.class);
    private final SyncHistoryRepository historyRepo = mock(SyncHistoryRepository.class);
    private final AgentCommandClient cmd = mock(AgentCommandClient.class);
    private final SyncService svc = new SyncService(nodeRepo, jobRepo, historyRepo, cmd);

    private Node node(String host, Node.Role role, String svcIp, String hbIp) {
        Node n = new Node();
        n.setId(UUID.randomUUID());
        n.setHostname(host); n.setRole(role);
        n.setServiceIp(svcIp); n.setHeartbeatIp(hbIp);
        return n;
    }

    private SyncJob job(boolean mirror) {
        return SyncJob.builder().id(UUID.randomUUID()).clusterId(UUID.randomUUID())
                .name("app").sourcePath("/data/app").destPath("/data/app")
                .mirrorDelete(mirror).scheduleSec(0).enabled(true).build();
    }

    @Test
    void buildSyncCommand_usesHeartbeatIp_andDeleteFlag() {
        SyncJob j = job(true);
        String c = svc.buildSyncCommand(j, "10.0.0.9");
        assertThat(c).isEqualTo("control.sh dir-sync 10.0.0.9 /data/app /data/app --delete");
    }

    @Test
    void buildSyncCommand_noDelete_whenMirrorOff() {
        String c = svc.buildSyncCommand(job(false), "10.0.0.9");
        assertThat(c).isEqualTo("control.sh dir-sync 10.0.0.9 /data/app /data/app");
    }

    @Test
    void parseStats_extractsFilesAndBytes() {
        long[] r = svc.parseStats("blah\nNEMESIS_SYNC {\"files\":12,\"bytes\":3456}\n");
        assertThat(r).containsExactly(12L, 3456L);
    }

    @Test
    void runJob_skips_whenStandbyHasNoHeartbeatIp() {
        SyncJob j = job(false);
        Node active = node("bot", Node.Role.active, "192.168.0.17", "192.168.0.17");
        Node sb     = node("bot-02", Node.Role.standby, "192.168.0.18", null); // hbIp 없음
        when(jobRepo.findById(j.getId())).thenReturn(java.util.Optional.of(j));
        when(nodeRepo.findByClusterId(j.getClusterId())).thenReturn(List.of(active, sb));

        svc.runJob(j.getId(), SyncHistory.Trigger.MANUAL);

        verify(cmd, never()).execute(any(), anyString());
        ArgumentCaptor<SyncHistory> cap = ArgumentCaptor.forClass(SyncHistory.class);
        verify(historyRepo).save(cap.capture());
        assertThat(cap.getValue().getStatus()).isEqualTo(SyncHistory.Status.SKIPPED);
        assertThat(cap.getValue().getMessage()).contains("heartbeat");
    }

    @Test
    void runJob_sendsDirSyncToActive_targetingStandbyHeartbeatIp_onSuccess() {
        SyncJob j = job(false);
        Node active = node("bot", Node.Role.active, "192.168.0.17", "192.168.0.17");
        Node sb     = node("bot-02", Node.Role.standby, "192.168.0.18", "10.0.0.18");
        when(jobRepo.findById(j.getId())).thenReturn(java.util.Optional.of(j));
        when(nodeRepo.findByClusterId(j.getClusterId())).thenReturn(List.of(active, sb));
        when(cmd.execute(eq(active), anyString()))
            .thenReturn(new AgentCommandClient.Result(true, 0,
                "NEMESIS_SYNC {\"files\":3,\"bytes\":100}", "", null));

        svc.runJob(j.getId(), SyncHistory.Trigger.MANUAL);

        ArgumentCaptor<String> cmdCap = ArgumentCaptor.forClass(String.class);
        verify(cmd).execute(eq(active), cmdCap.capture());
        assertThat(cmdCap.getValue()).isEqualTo("control.sh dir-sync 10.0.0.18 /data/app /data/app");
        ArgumentCaptor<SyncHistory> cap = ArgumentCaptor.forClass(SyncHistory.class);
        verify(historyRepo).save(cap.capture());
        assertThat(cap.getValue().getStatus()).isEqualTo(SyncHistory.Status.SUCCESS);
        assertThat(cap.getValue().getFilesCount()).isEqualTo(3);
        assertThat(cap.getValue().getBytesTransferred()).isEqualTo(100);
    }

    @Test
    void runJob_skips_whenNoActiveNode() {
        SyncJob j = job(false);
        Node sb = node("bot-02", Node.Role.standby, "192.168.0.18", "10.0.0.18");
        when(jobRepo.findById(j.getId())).thenReturn(java.util.Optional.of(j));
        when(nodeRepo.findByClusterId(j.getClusterId())).thenReturn(List.of(sb));

        svc.runJob(j.getId(), SyncHistory.Trigger.MANUAL);

        verify(cmd, never()).execute(any(), anyString());
        ArgumentCaptor<SyncHistory> cap = ArgumentCaptor.forClass(SyncHistory.class);
        verify(historyRepo).save(cap.capture());
        assertThat(cap.getValue().getStatus()).isEqualTo(SyncHistory.Status.SKIPPED);
        assertThat(cap.getValue().getMessage()).contains("active");
    }
}
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test --tests '*SyncServiceTest*' -q`  Expected: 컴파일 실패(SyncService 없음).

- [ ] **Step 3: SyncService 구현** — `SyncService.java`:

```java
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
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test --tests '*SyncServiceTest*' -q`  Expected: 6개 테스트 PASS.

- [ ] **Step 5: 커밋**
```bash
git add backend/src/main/java/com/nemesis/domain/sync/SyncService.java backend/src/test/java/com/nemesis/domain/sync/SyncServiceTest.java
git commit -m "feat(sync): SyncService 핵심 로직(active 식별·hbIp 가드·명령조립·이력) + 단위테스트 6"
```

---

### Task 4: SshProvisionService — 노드 SSH 키 자동 프로비저닝 (TDD)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/sync/SshProvisionService.java`
- Test: `backend/src/test/java/com/nemesis/domain/sync/SshProvisionServiceTest.java`

**Interfaces:**
- Consumes: `NodeRepository.findByClusterId`, `AgentCommandClient.execute`.
- Produces: `Map<String,Object> provision(UUID clusterId)` — 각 노드 keygen → pubkey 수집 → 모든 peer에 ssh-authorize 배포. 결과 `{provisioned:[hostnames], failed:[hostnames]}`.

- [ ] **Step 1: 실패 테스트 작성** — `SshProvisionServiceTest.java`:

```java
package com.nemesis.domain.sync;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class SshProvisionServiceTest {

    private final NodeRepository nodeRepo = mock(NodeRepository.class);
    private final AgentCommandClient cmd = mock(AgentCommandClient.class);
    private final SshProvisionService svc = new SshProvisionService(nodeRepo, cmd);

    private Node node(String host) {
        Node n = new Node(); n.setId(UUID.randomUUID()); n.setHostname(host);
        n.setRole(Node.Role.active); n.setServiceIp("1.2.3." + host.length());
        return n;
    }

    @Test
    void provision_keygensEachNode_andAuthorizesPeers() {
        UUID cid = UUID.randomUUID();
        Node a = node("aa"), b = node("bbb");
        when(nodeRepo.findByClusterId(cid)).thenReturn(List.of(a, b));
        // keygen 호출은 stdout에 pubkey 반환
        when(cmd.execute(eq(a), eq("control.sh ssh-keygen-nemesis")))
            .thenReturn(new AgentCommandClient.Result(true, 0, "ssh-ed25519 KEYA host-aa", "", null));
        when(cmd.execute(eq(b), eq("control.sh ssh-keygen-nemesis")))
            .thenReturn(new AgentCommandClient.Result(true, 0, "ssh-ed25519 KEYB host-bbb", "", null));
        when(cmd.execute(any(), startsWith("control.sh ssh-authorize")))
            .thenReturn(new AgentCommandClient.Result(true, 0, "authorized", "", null));

        Map<String,Object> r = svc.provision(cid);

        // a는 b의 키를 authorize, b는 a의 키를 authorize
        verify(cmd).execute(eq(a), eq("control.sh ssh-authorize \"ssh-ed25519 KEYB host-bbb\""));
        verify(cmd).execute(eq(b), eq("control.sh ssh-authorize \"ssh-ed25519 KEYA host-aa\""));
        assertThat((List<?>) r.get("provisioned")).containsExactlyInAnyOrder("aa", "bbb");
    }
}
```
> 참고: import `java.util.Map`를 상단에 추가.

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test --tests '*SshProvisionServiceTest*' -q`  Expected: 컴파일 실패.

- [ ] **Step 3: 구현** — `SshProvisionService.java`:

```java
package com.nemesis.domain.sync;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/** 클러스터 노드 간 passwordless SSH 신뢰를 자동 구성한다(rsync용). */
@Slf4j
@Service
@RequiredArgsConstructor
public class SshProvisionService {

    private final NodeRepository     nodeRepo;
    private final AgentCommandClient commandClient;

    public Map<String, Object> provision(UUID clusterId) {
        List<Node> nodes = nodeRepo.findByClusterId(clusterId);
        List<String> provisioned = new ArrayList<>();
        List<String> failed = new ArrayList<>();

        // 1) 각 노드 keygen → pubkey 수집
        Map<Node, String> pubkeys = new LinkedHashMap<>();
        for (Node n : nodes) {
            AgentCommandClient.Result r = commandClient.execute(n, "control.sh ssh-keygen-nemesis");
            if (r.ok() && r.stdout() != null && !r.stdout().isBlank()) {
                pubkeys.put(n, r.stdout().trim());
                provisioned.add(n.getHostname());
            } else {
                failed.add(n.getHostname());
            }
        }
        // 2) 각 노드에 다른 모든 peer의 공개키를 authorize
        for (Node n : pubkeys.keySet()) {
            for (Map.Entry<Node, String> peer : pubkeys.entrySet()) {
                if (peer.getKey().equals(n)) continue;
                commandClient.execute(n, "control.sh ssh-authorize \"" + peer.getValue() + "\"");
            }
        }
        return Map.of("provisioned", provisioned, "failed", failed);
    }
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test --tests '*SshProvisionServiceTest*' -q`  Expected: PASS.

- [ ] **Step 5: 커밋**
```bash
git add backend/src/main/java/com/nemesis/domain/sync/SshProvisionService.java backend/src/test/java/com/nemesis/domain/sync/SshProvisionServiceTest.java
git commit -m "feat(sync): SSH 자동 프로비저닝 서비스 + 단위테스트"
```

---

### Task 5: 컨트롤러 — SyncJob CRUD/run/history + DirBrowse + SshProvision

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/sync/SyncJobController.java`
- Create: `backend/src/main/java/com/nemesis/domain/sync/DirBrowseController.java`
- Create: `backend/src/main/java/com/nemesis/domain/sync/dto/SyncDtos.java`
- Modify: `SyncService.java`(CRUD 메서드 추가), `SshProvisionService` 주입은 컨트롤러에서.
- Test: 없음(엔드포인트는 Task 8 e2e + 컴파일로 검증; 로직은 Task 3/4에서 커버).

**Interfaces:**
- Produces (REST, ClusterConfigController 패턴):
  - `GET    /api/clusters/{clusterId}/sync/jobs`
  - `POST   /api/clusters/{clusterId}/sync/jobs`               (operator+)
  - `PUT    /api/clusters/{clusterId}/sync/jobs/{jobId}`        (operator+)
  - `DELETE /api/clusters/{clusterId}/sync/jobs/{jobId}`        (operator+)
  - `POST   /api/clusters/{clusterId}/sync/jobs/{jobId}/run`    (operator+)
  - `GET    /api/clusters/{clusterId}/sync/history`
  - `POST   /api/clusters/{clusterId}/sync/provision-ssh`       (operator+)
  - `GET    /api/clusters/{clusterId}/nodes/{nodeId}/dirs?path=`

- [ ] **Step 1: SyncService에 CRUD 메서드 추가** — `SyncService.java`에 추가(`history` 메서드 아래):

```java
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
```

- [ ] **Step 2: DirBrowse용 메서드 추가(SyncService)** — `dir-list` 프록시:

```java
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
```
> `import com.nemesis.domain.node.Node;` 는 이미 존재.

- [ ] **Step 3: DTO** — `dto/SyncDtos.java`:

```java
package com.nemesis.domain.sync.dto;

import java.util.List;

public class SyncDtos {
    public record DirListResponse(String path, List<String> dirs) {}
}
```

- [ ] **Step 4: SyncJobController** — `SyncJobController.java`:

```java
package com.nemesis.domain.sync;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 폴더 동기화 작업 CRUD/실행/이력 + SSH 프로비저닝. */
@RestController
@RequestMapping("/api/clusters/{clusterId}/sync")
@RequiredArgsConstructor
public class SyncJobController {

    private final SyncService        syncService;
    private final SshProvisionService sshService;

    @GetMapping("/jobs")
    public ResponseEntity<List<SyncJob>> jobs(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(syncService.listJobs(clusterId));
    }

    @PostMapping("/jobs")
    public ResponseEntity<SyncJob> create(@PathVariable UUID clusterId, @RequestBody SyncJob body) {
        return ResponseEntity.ok(syncService.createJob(clusterId, body));
    }

    @PutMapping("/jobs/{jobId}")
    public ResponseEntity<SyncJob> update(@PathVariable UUID clusterId, @PathVariable UUID jobId,
                                          @RequestBody SyncJob body) {
        return ResponseEntity.ok(syncService.updateJob(jobId, body));
    }

    @DeleteMapping("/jobs/{jobId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId, @PathVariable UUID jobId) {
        syncService.deleteJob(jobId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/jobs/{jobId}/run")
    public ResponseEntity<Map<String, Object>> run(@PathVariable UUID clusterId, @PathVariable UUID jobId) {
        return ResponseEntity.ok(syncService.runJob(jobId, SyncHistory.Trigger.MANUAL));
    }

    @GetMapping("/history")
    public ResponseEntity<List<SyncHistory>> history(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(syncService.history(clusterId));
    }

    @PostMapping("/provision-ssh")
    public ResponseEntity<Map<String, Object>> provision(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(sshService.provision(clusterId));
    }
}
```

- [ ] **Step 5: DirBrowseController** — `DirBrowseController.java`:

```java
package com.nemesis.domain.sync;

import com.nemesis.domain.sync.dto.SyncDtos.DirListResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** 노드 파일시스템 탐색(읽기전용, 폴더 브라우저용). */
@RestController
@RequestMapping("/api/clusters/{clusterId}/nodes/{nodeId}")
@RequiredArgsConstructor
public class DirBrowseController {

    private final SyncService syncService;

    @GetMapping("/dirs")
    public ResponseEntity<DirListResponse> dirs(@PathVariable UUID clusterId, @PathVariable UUID nodeId,
                                                @RequestParam(defaultValue = "/") String path) {
        return ResponseEntity.ok(new DirListResponse(path, syncService.listDirs(nodeId, path)));
    }
}
```

- [ ] **Step 6: 컴파일 검증** — Run: `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle compileJava -q`  Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: 커밋**
```bash
git add backend/src/main/java/com/nemesis/domain/sync/
git commit -m "feat(sync): SyncJob/DirBrowse 컨트롤러 + CRUD/dir-list 서비스 메서드"
```

---

### Task 6: SyncScheduler (@Scheduled 주기 실행) + RBAC 게이트

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/sync/SyncScheduler.java`
- Modify: `backend/src/main/java/com/nemesis/security/RbacFilter.java` (requirement에 sync 경로 추가)
- Test: `backend/src/test/java/com/nemesis/domain/sync/SyncSchedulerTest.java`

**Interfaces:**
- Consumes: `SyncJobRepository.findByEnabledTrueAndScheduleSecGreaterThan(0)`, `SyncService.runJob`, `SyncJob.getLastRunAt()/getScheduleSec()`.
- Produces: `boolean isDue(SyncJob job, OffsetDateTime now)` (package-private, 테스트 대상); `@Scheduled tick()`.

- [ ] **Step 1: 실패 테스트 작성** — `SyncSchedulerTest.java`:

```java
package com.nemesis.domain.sync;

import org.junit.jupiter.api.Test;
import java.time.OffsetDateTime;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class SyncSchedulerTest {

    private final SyncScheduler s = new SyncScheduler(mock(SyncJobRepository.class), mock(SyncService.class));

    private SyncJob job(int sec, OffsetDateTime lastRun) {
        return SyncJob.builder().scheduleSec(sec).lastRunAt(lastRun).enabled(true).build();
    }

    @Test
    void due_whenNeverRun() {
        assertThat(s.isDue(job(60, null), OffsetDateTime.now())).isTrue();
    }

    @Test
    void due_whenIntervalElapsed() {
        OffsetDateTime now = OffsetDateTime.now();
        assertThat(s.isDue(job(60, now.minusSeconds(61)), now)).isTrue();
    }

    @Test
    void notDue_withinInterval() {
        OffsetDateTime now = OffsetDateTime.now();
        assertThat(s.isDue(job(60, now.minusSeconds(10)), now)).isFalse();
    }
}
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test --tests '*SyncSchedulerTest*' -q`  Expected: 컴파일 실패.

- [ ] **Step 3: SyncScheduler 구현** — `SyncScheduler.java`:

```java
package com.nemesis.domain.sync;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;

/** enabled && scheduleSec>0 작업을 주기 도래 시 실행한다. */
@Slf4j
@Component
@RequiredArgsConstructor
public class SyncScheduler {

    private final SyncJobRepository jobRepo;
    private final SyncService       syncService;

    @Scheduled(fixedDelayString = "${nemesis.sync.tick-ms:30000}")
    public void tick() {
        OffsetDateTime now = OffsetDateTime.now();
        for (SyncJob job : jobRepo.findByEnabledTrueAndScheduleSecGreaterThan(0)) {
            if (isDue(job, now)) {
                try {
                    syncService.runJob(job.getId(), SyncHistory.Trigger.SCHEDULED);
                } catch (Exception e) {
                    log.warn("스케줄 동기화 실패 job={}: {}", job.getId(), e.getMessage());
                }
            }
        }
    }

    boolean isDue(SyncJob job, OffsetDateTime now) {
        if (job.getLastRunAt() == null) return true;
        return job.getLastRunAt().plusSeconds(job.getScheduleSec()).isBefore(now);
    }
}
```
> `@EnableScheduling`은 `NemesisServerApplication`에 이미 켜져 있음(기존 HealthMonitor가 사용).

- [ ] **Step 4: RbacFilter에 sync 경로 추가** — `RbacFilter.java`의 `requirement()`에서 `config/sync` 줄 다음에 추가:

```java
        if (path.matches("/api/clusters/[^/]+/sync/jobs.*"))          return Need.OPERATOR; // POST/PUT/DELETE/run
        if (path.matches("/api/clusters/[^/]+/sync/provision-ssh"))   return Need.OPERATOR;
```
> `requirement()`는 POST/DELETE만 게이트(GET은 NONE)하므로, PUT도 게이트하려면 `requirement` 진입 조건에 PUT을 추가해야 한다. `RbacFilter.java`의 메서드 가드 라인을 확인해 PUT 포함 여부를 점검하고, sync/jobs PUT(작업 수정)도 operator+가 되도록 다음과 같이 보정:
```java
// 변경 전: if (!"POST".equalsIgnoreCase(method) && !"DELETE".equalsIgnoreCase(method)) return Need.NONE;
// 변경 후:
if (!"POST".equalsIgnoreCase(method) && !"DELETE".equalsIgnoreCase(method)
        && !"PUT".equalsIgnoreCase(method)) return Need.NONE;
```

- [ ] **Step 5: 테스트 통과 + 전체 회귀** — Run: `cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle test -q`  Expected: 신규 SyncSchedulerTest 3 PASS, 기존 테스트 회귀 0.

- [ ] **Step 6: 커밋**
```bash
git add backend/src/main/java/com/nemesis/domain/sync/SyncScheduler.java backend/src/main/java/com/nemesis/security/RbacFilter.java backend/src/test/java/com/nemesis/domain/sync/SyncSchedulerTest.java
git commit -m "feat(sync): 주기 스케줄러 + sync 경로 RBAC operator+ 게이트"
```

---

### Task 7: 프론트엔드 — client.js 헬퍼 + DirSyncPanel + 폴더 브라우저 모달

**Files:**
- Modify: `frontend/src/api/client.js` (api 헬퍼 추가)
- Create: `frontend/src/components/DirSyncPanel.jsx`
- Create: `frontend/src/components/DirBrowserModal.jsx`
- Modify: `frontend/src/pages/ClusterSettings.jsx` (DirSyncPanel 렌더)

**Interfaces:**
- Consumes: 백엔드 REST(Task 5). `useAuth().isOperator`(기존).
- Produces: `<DirSyncPanel clusterId nodes />`.

- [ ] **Step 1: client.js 헬퍼 추가** — `syncClusterConfig` 줄(50) 다음에:

```js
// 폴더 동기화(Directory Sync)
export const getSyncJobs       = (cid)        => client.get(`/clusters/${cid}/sync/jobs`)
export const createSyncJob     = (cid, d)     => client.post(`/clusters/${cid}/sync/jobs`, d)
export const updateSyncJob     = (cid, jid, d)=> client.put(`/clusters/${cid}/sync/jobs/${jid}`, d)
export const deleteSyncJob     = (cid, jid)   => client.delete(`/clusters/${cid}/sync/jobs/${jid}`)
export const runSyncJob        = (cid, jid)   => client.post(`/clusters/${cid}/sync/jobs/${jid}/run`)
export const getSyncHistory    = (cid)        => client.get(`/clusters/${cid}/sync/history`)
export const provisionSyncSsh  = (cid)        => client.post(`/clusters/${cid}/sync/provision-ssh`)
export const browseNodeDirs    = (cid, nid, path) => client.get(`/clusters/${cid}/nodes/${nid}/dirs`, { params: { path } })
```

- [ ] **Step 2: DirBrowserModal 작성** — `DirBrowserModal.jsx` (노드 디렉토리 탐색, 경로 선택):

```jsx
import React, { useEffect, useState, useCallback } from 'react'
import { browseNodeDirs } from '../api/client'

export default function DirBrowserModal({ clusterId, node, onPick, onClose }) {
  const [path, setPath] = useState('/')
  const [dirs, setDirs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (p) => {
    setLoading(true); setError(null)
    try {
      const r = await browseNodeDirs(clusterId, node.nodeId, p)
      setDirs(r.data.dirs || []); setPath(r.data.path || p)
    } catch (e) {
      setError(e.response?.data?.message || '탐색 실패')
    } finally { setLoading(false) }
  }, [clusterId, node])

  useEffect(() => { load('/') }, [load])

  function enter(name) {
    const next = path.endsWith('/') ? path + name : path + '/' + name
    load(next)
  }
  function up() {
    if (path === '/') return
    const parent = path.replace(/\/[^/]+\/?$/, '') || '/'
    load(parent)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-[480px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-200">{node.hostname} 폴더 선택</span>
          <button onClick={up} className="text-xs text-sky-400">상위로</button>
        </div>
        <div className="px-4 py-2 text-xs font-mono text-slate-400 border-b border-slate-800 truncate">{path}</div>
        <div className="flex-1 overflow-auto p-2">
          {loading && <div className="text-xs text-slate-500 p-2">불러오는 중...</div>}
          {error && <div className="text-xs text-red-400 p-2">{error}</div>}
          {!loading && dirs.length === 0 && <div className="text-xs text-slate-600 p-2">하위 폴더 없음</div>}
          {dirs.map(d => (
            <button key={d} onClick={() => enter(d)}
              className="w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 rounded font-mono">
              <span className="material-icons text-amber-400 text-sm align-middle mr-1">folder</span>{d}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-slate-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400">취소</button>
          <button onClick={() => onPick(path)} className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded">이 폴더 선택</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: DirSyncPanel 작성** — `DirSyncPanel.jsx` (작업 목록 + 추가 모달 + 실행 + SSH 버튼). ClusterSettings의 패널 스타일(`bg-slate-900 border border-slate-800 rounded-xl`) 따름:

```jsx
import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import {
  getSyncJobs, createSyncJob, deleteSyncJob, runSyncJob,
  getSyncHistory, provisionSyncSsh,
} from '../api/client'
import DirBrowserModal from './DirBrowserModal'

export default function DirSyncPanel({ clusterId, nodes }) {
  const { isOperator } = useAuth()
  const [jobs, setJobs] = useState([])
  const [history, setHistory] = useState([])
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const [j, h] = await Promise.all([getSyncJobs(clusterId), getSyncHistory(clusterId)])
    setJobs(j.data || []); setHistory(h.data || [])
  }, [clusterId])
  useEffect(() => { load() }, [load])

  async function run(jid) {
    setMsg('동기화 실행 중...')
    try { const r = await runSyncJob(clusterId, jid); setMsg(JSON.stringify(r.data)); await load() }
    catch (e) { setMsg(e.response?.data?.message || '실행 실패') }
  }
  async function provision() {
    setMsg('SSH 신뢰 구성 중...')
    try { const r = await provisionSyncSsh(clusterId); setMsg(`프로비저닝: ${(r.data.provisioned||[]).join(', ')}`) }
    catch (e) { setMsg(e.response?.data?.message || 'SSH 구성 실패') }
  }
  async function remove(jid) {
    if (!confirm('이 동기화 작업을 삭제할까요?')) return
    await deleteSyncJob(clusterId, jid); await load()
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-200">폴더 동기화 (active → standby, rsync/heartbeat)</h3>
        <div className="flex gap-2">
          <button disabled={!isOperator} onClick={provision}
            title={isOperator ? '' : 'operator 이상 권한 필요'}
            className="px-3 py-1.5 text-xs bg-slate-700 text-slate-200 rounded disabled:opacity-40">SSH 신뢰 구성</button>
          <button disabled={!isOperator} onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded disabled:opacity-40">+ 작업 추가</button>
        </div>
      </div>

      {msg && <div className="mb-3 text-xs font-mono text-slate-400 bg-slate-950 rounded p-2 break-all">{msg}</div>}

      <div className="space-y-2">
        {jobs.length === 0 && <div className="text-xs text-slate-600">동기화 작업이 없습니다.</div>}
        {jobs.map(j => (
          <div key={j.id} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-slate-200 font-mono truncate">{j.name}: {j.sourcePath} → {j.destPath}</div>
              <div className="text-[10px] text-slate-500">
                {j.scheduleSec > 0 ? `주기 ${j.scheduleSec}s` : '수동전용'}{j.mirrorDelete ? ' · mirror(--delete)' : ''}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button disabled={!isOperator} onClick={() => run(j.id)}
                className="px-2 py-1 text-xs bg-emerald-700 text-white rounded disabled:opacity-40">지금 동기화</button>
              <button disabled={!isOperator} onClick={() => remove(j.id)}
                className="px-2 py-1 text-xs text-red-400 disabled:opacity-40">삭제</button>
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">최근 이력</div>
          <div className="space-y-1">
            {history.slice(0, 10).map(h => (
              <div key={h.id} className="text-[11px] font-mono text-slate-500 flex justify-between">
                <span className={h.status === 'SUCCESS' ? 'text-emerald-400' : h.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}>{h.status}</span>
                <span className="truncate px-2">{h.filesCount}개 / {h.bytesTransferred}B / {h.durationMs}ms</span>
                <span>{new Date(h.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && (
        <AddJobModal clusterId={clusterId} nodes={nodes}
          onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load() }} />
      )}
    </div>
  )
}

function AddJobModal({ clusterId, nodes, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', sourcePath: '', destPath: '', scheduleSec: 0, mirrorDelete: false, excludes: '' })
  const [browsing, setBrowsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const browseNode = nodes.find(n => n.role === 'PRIMARY') || nodes[0]

  async function submit(e) {
    e.preventDefault(); setSaving(true); setError(null)
    try { await createSyncJob(clusterId, { ...form, destPath: form.destPath || form.sourcePath }); onSaved() }
    catch (e) { setError(e.response?.data?.message || '저장 실패'); setSaving(false) }
  }
  const input = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono'
  const label = 'block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={onClose}>
      <form onSubmit={submit} className="bg-slate-900 border border-slate-700 rounded-xl w-[440px] p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h4 className="text-sm font-bold text-slate-200">동기화 작업 추가</h4>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <div><label className={label}>이름</label><input className={input} value={form.name} onChange={e => set('name', e.target.value)} required /></div>
        <div>
          <label className={label}>소스 경로(active)</label>
          <div className="flex gap-2">
            <input className={input} value={form.sourcePath} onChange={e => set('sourcePath', e.target.value)} placeholder="/data/app" required />
            {browseNode && <button type="button" onClick={() => setBrowsing(true)} className="px-2 text-xs bg-slate-700 text-slate-200 rounded shrink-0">찾아보기</button>}
          </div>
        </div>
        <div><label className={label}>대상 경로(미입력 시 소스와 동일)</label><input className={input} value={form.destPath} onChange={e => set('destPath', e.target.value)} placeholder="(소스와 동일)" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>주기(초, 0=수동)</label><input type="number" min="0" className={input} value={form.scheduleSec} onChange={e => set('scheduleSec', Number(e.target.value))} /></div>
          <label className="flex items-center gap-2 text-xs text-slate-300 mt-5">
            <input type="checkbox" checked={form.mirrorDelete} onChange={e => set('mirrorDelete', e.target.checked)} />
            mirror(--delete)
          </label>
        </div>
        {form.mirrorDelete && <div className="text-[11px] text-amber-400">⚠ standby에서 소스에 없는 파일이 삭제됩니다.</div>}
        <div><label className={label}>제외 패턴(콤마/개행)</label><input className={input} value={form.excludes} onChange={e => set('excludes', e.target.value)} placeholder="*.log, tmp/" /></div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400">취소</button>
          <button type="submit" disabled={saving} className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded">저장</button>
        </div>
        {browsing && browseNode && (
          <DirBrowserModal clusterId={clusterId} node={browseNode}
            onPick={(p) => { set('sourcePath', p); setBrowsing(false) }} onClose={() => setBrowsing(false)} />
        )}
      </form>
    </div>
  )
}
```
> `createSyncJob` import는 상단 import 블록에 추가(`import { ..., createSyncJob } from '../api/client'`).

- [ ] **Step 4: ClusterSettings에 패널 렌더** — `ClusterSettings.jsx`에서 기존 패널들이 렌더되는 영역(예: `VipStatusPanel` 렌더 위치 근처)에 추가. import 상단에 `import DirSyncPanel from '../components/DirSyncPanel'` 추가 후, 노드 목록(`nodes` state)이 있는 JSX에 삽입:

```jsx
<DirSyncPanel clusterId={clusterId} nodes={nodes} />
```
> `clusterId`와 `nodes`는 ClusterSettings가 이미 보유. 변수명이 다르면(예: `cluster.id`) 해당 이름으로 맞춘다.

- [ ] **Step 5: 빌드 검증** — Run: `cd frontend && npm run build`  Expected: vite build 성공(에러 0).

- [ ] **Step 6: 커밋**
```bash
git add frontend/src/api/client.js frontend/src/components/DirSyncPanel.jsx frontend/src/components/DirBrowserModal.jsx frontend/src/pages/ClusterSettings.jsx
git commit -m "feat(sync): DirSyncPanel + 폴더 브라우저 모달 + client.js 헬퍼"
```

---

### Task 8: e2e 실측 (bot-02 컨테이너 + 실 스택)

**Files:**
- Modify: `agent/Dockerfile.test` (openssh-server, rsync, nemesis 계정 추가 — e2e 전용)
- 검증 스크립트는 수동 실행(아래 Step). 코드 변경 없음.

**Interfaces:**
- Consumes: 전체 스택(nemesis-server 18080, bot-02 컨테이너 172.18.0.50), Task 1~7 산출물.

- [ ] **Step 1: 백엔드 재빌드·재기동 + V15 적용 확인** — Run:
```bash
cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17 gradle bootJar -q
cd .. && docker build -t nemesis-server:latest backend && docker restart nemesis-server
sleep 8
docker exec nemesis_v100_postgres_1 psql -U nemesis -d nemesis -c "\dt sync_jobs sync_history"
```
Expected: `sync_jobs`, `sync_history` 테이블 존재(Flyway V15 적용).

- [ ] **Step 2: 동기화 작업 생성 + 수동 실행(heartbeat IP 가드 경로)** — Run:
```bash
PORT=18080; CID=c3e0616c-bce5-4f9d-b440-8eb92f8c792d
T=$(curl -s -X POST http://localhost:$PORT/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST "http://localhost:$PORT/api/clusters/$CID/sync/jobs" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"name":"e2e","sourcePath":"/tmp/src","destPath":"/tmp/dst","scheduleSec":0,"mirrorDelete":false}'
JID=$(curl -s "http://localhost:$PORT/api/clusters/$CID/sync/jobs" -H "Authorization: Bearer $T" | python3 -c "import sys,json;print(json.load(sys.stdin)[-1]['id'])")
curl -s -X POST "http://localhost:$PORT/api/clusters/$CID/sync/jobs/$JID/run" -H "Authorization: Bearer $T"
```
Expected: 응답 `{"status":"DONE",...}` 또는 bot-02에 SSH/rsync 미설치 시 해당 standby `FAILED`(이력 기록됨). **핵심 검증: heartbeat IP가 없으면 SKIPPED, 있으면 active로 dir-sync 명령이 전송됨.**

- [ ] **Step 3: dir-list 프록시 검증(SSH 불요)** — Run:
```bash
docker exec bot-02 mkdir -p /tmp/browse/aa /tmp/browse/bb
N2=744713da-041c-4417-9871-1b4339de6cf3
curl -s "http://localhost:$PORT/api/clusters/$CID/nodes/$N2/dirs?path=/tmp/browse" -H "Authorization: Bearer $T"
```
Expected: `{"path":"/tmp/browse","dirs":["aa","bb"]}` — 폴더 브라우저 백엔드 동작 확인.

- [ ] **Step 4: (선택) 실 rsync 왕복** — bot-02 컨테이너에 sshd+rsync+nemesis 계정을 추가한 이미지로 재기동한 경우에만:
```bash
docker exec bot-02 sh -c 'mkdir -p /tmp/src && echo hello > /tmp/src/a.txt'
# SSH 신뢰 구성
curl -s -X POST "http://localhost:$PORT/api/clusters/$CID/sync/provision-ssh" -H "Authorization: Bearer $T"
# 동기화 실행 후 대상 확인
curl -s -X POST "http://localhost:$PORT/api/clusters/$CID/sync/jobs/$JID/run" -H "Authorization: Bearer $T"
docker exec bot-02 cat /tmp/dst/a.txt
```
Expected: `hello` — 실제 rsync over SSH(heartbeat IP)로 파일 도착. (sshd 미구성 시 이 Step은 생략하고 Step 2의 명령 전송까지를 검증 종료점으로 본다.)

- [ ] **Step 5: 이력 확인** — Run:
```bash
curl -s "http://localhost:$PORT/api/clusters/$CID/sync/history" -H "Authorization: Bearer $T" | python3 -m json.tool | head -20
```
Expected: 실행한 작업의 `sync_history` 레코드(status/files/bytes/durationMs) 존재.

- [ ] **Step 6: 결과 기록** — 검증 결과(통과/실패 항목, sshd 구성 여부)를 스펙 문서 또는 메모리에 남긴다. 코드 변경 없으면 커밋 없음.

---

## Self-Review

**Spec coverage 매핑:**
- §3 스키마 → Task 2 / §4 control.sh → Task 1 / §5 SSH 프로비저닝 → Task 4 / §6 백엔드 sync 패키지 → Task 3·5·6 / §7 프론트 → Task 7 / §8 실행 흐름 → Task 3 / §9 에러·안전장치(heartbeat 가드·in-flight 락·mirror 경고·화이트리스트) → Task 3(가드/락)·Task 7(mirror 경고)·Task 1(화이트리스트) / §11 테스트 → 각 Task의 TDD + Task 8 e2e. **모든 §에 대응 Task 존재.**
- 실시간(Phase 2)은 의도적으로 범위 외(Global Constraints 명시).

**Placeholder scan:** 모든 step에 실제 코드/명령/기대출력 포함. "적절히 처리" 류 없음.

**Type consistency:** `AgentCommandClient.Result(ok, exitCode, stdout, stderr, error)` 생성자/접근자 일관(Task 3·4·5). `SyncHistory.Trigger/Status` enum 명칭 일관. `buildSyncCommand`/`parseStats`/`isDue` 시그니처가 테스트와 구현에서 동일. `Node.Role.active/standby`, `getHeartbeatIp()` 일관. 프론트 `role === 'PRIMARY'`는 백엔드 `uiToken()` 매핑과 정합(기존 계약).

**주의(구현 시 확인):** ① `RbacFilter.requirement()`의 메서드 가드에 PUT 추가 필요(Task 6 Step 4 명시). ② bot-02 실 rsync e2e는 sshd/rsync/nemesis 계정 필요 — 미구성 시 명령 전송까지를 검증 종료점으로(Task 8 Step 4). ③ install.sh의 nemesis 계정/ssh 서버 보장은 본 플랜 범위 밖(스펙 §4 전제) — 운영 배포 시 별도 확인.
