# Nemesis Share S0(조회 단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공유 스토리지(FC SAN LUN)를 스캔·수동등록으로 인벤토리에 담고 UI 목록으로 볼 수 있게 한다. 파괴적 조작(mkfs/mount 등)은 전혀 포함하지 않는 순수 조회+등록 단계.

**Architecture:** 기존 dir-sync 도메인과 동일한 3계층 — 에이전트(`agent/storage.sh` 신규 스크립트, 화이트리스트 등록) → 백엔드(`domain/storage/` 신규 도메인, `AgentCommandClient` 재사용) → 프론트(`pages/storage/Storage.jsx` 신규 페이지). 디바이스는 multipath WWID로 식별하고(§6 재부팅/재설치 대비), 경로(`/dev/sdX`)는 저장하지 않는다.

**Tech Stack:** Spring Boot(Java 17) + JPA/Postgres(Flyway) 백엔드, React 프론트(axios), POSIX sh 에이전트 스크립트.

## Global Constraints

- FC(SAN) 전용 — iSCSI 관련 코드/서브커맨드를 만들지 않는다.
- AIX는 OS 분기 코드만 작성하고 이번 단계에서 테스트하지 않는다(장비는 있으나 검증 보류 — 사용자 확정).
- S0은 읽기 전용 스캔 + 메타데이터 등록만 다룬다. mkfs/mount/vg 생성 등 파괴적 명령은 이 계획에 없다(S1 이후).
- 디바이스 식별자는 WWID(멀티패스 WWID 또는 디스크 시리얼)만 사용한다. `/dev/sdX` 같은 경로는 DB에 저장하지 않는다.
- 에이전트 변경은 재배포가 필요하다(dir-sync 때와 동일 제약) — Task 9에서 반드시 컨테이너 재시작으로 반영한다.
- 백엔드 빌드/테스트는 호스트에 JDK가 없으므로 `docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon`로 실행한다(backend 디렉토리 기준).
- 이 저장소는 항상 무관한 변경이 스테이징돼 있을 수 있다 — 커밋 시 반드시 `git add <정확한 경로>`로 pathspec을 지정한다(전체 `git add -A` 금지).

---

### Task 1: DB 마이그레이션 — storage_devices 테이블

**Files:**
- Create: `backend/src/main/resources/db/migration/V22__shared_storage.sql`

**Interfaces:**
- Produces: 테이블 `storage_devices(id, cluster_group_id, wwid, label, size_bytes, path_count, source, discovered_node_id, status, created_at, updated_at)`, unique 제약 `(cluster_group_id, wwid)`. Task 2의 `StorageDevice` 엔티티가 이 스키마에 매핑된다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- Nemesis Share S0: 공유 스토리지 인벤토리(조회 전용) — WWID 기반 디바이스 식별.
-- /dev/sdX 같은 경로는 재부팅·재설치로 바뀌므로 저장하지 않고, multipath WWID를
-- 영구 식별자로 사용한다(design doc §6 재참여 설계 참조).

CREATE TABLE storage_devices (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_group_id   UUID NOT NULL REFERENCES cluster_groups(id) ON DELETE CASCADE,
    wwid               VARCHAR(100) NOT NULL,
    label              VARCHAR(100),
    size_bytes         BIGINT,
    path_count         INT NOT NULL DEFAULT 0,
    source             VARCHAR(20) NOT NULL DEFAULT 'MANUAL',    -- SCAN | MANUAL
    discovered_node_id UUID,
    status             VARCHAR(20) NOT NULL DEFAULT 'REGISTERED', -- REGISTERED | MISSING
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(cluster_group_id, wwid)
);

CREATE INDEX idx_storage_devices_cluster ON storage_devices(cluster_group_id);
```

- [ ] **Step 2: 문법 확인**

이 파일은 Flyway가 관리하며, 테스트 프로파일(`application.yml`의 `test` 프로파일)은 Flyway를 끄고 Hibernate `ddl-auto: create-drop`으로 스키마를 생성하므로 `gradle test`로는 이 SQL 자체가 검증되지 않는다. 실제 검증은 Task 9에서 백엔드가 실 Postgres에 재기동하며 Flyway가 이 파일을 적용할 때 이루어진다(문법 오류가 있으면 기동 로그에 Flyway 마이그레이션 실패로 즉시 드러난다). 여기서는 V1/V20 기존 파일과 컬럼 관례(들여쓰기, `uuid_generate_v4()`, `cluster_group_id` 네이밍)가 일치하는지 육안으로 재확인한다.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/resources/db/migration/V22__shared_storage.sql
git commit -m "feat(storage): storage_devices 테이블 추가 (Nemesis Share S0)"
```

---

### Task 2: StorageDevice 엔티티 + Repository

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/storage/StorageDevice.java`
- Create: `backend/src/main/java/com/nemesis/domain/storage/StorageDeviceRepository.java`
- Test: `backend/src/test/java/com/nemesis/domain/storage/StorageDeviceRepositoryTest.java`

**Interfaces:**
- Consumes: `com.nemesis.domain.cluster.Cluster`, `com.nemesis.domain.cluster.ClusterRepository`(테스트에서 클러스터 시드용)
- Produces: `StorageDevice`(필드: `id, cluster, wwid, label, sizeBytes, pathCount, source(Source enum), discoveredNodeId, status(Status enum), createdAt, updatedAt`), `StorageDeviceRepository.findByClusterId(UUID)`, `StorageDeviceRepository.findByClusterIdAndWwid(UUID, String)` — Task 4/5의 `StorageService`가 이 두 메서드와 `StorageDevice.builder()`를 사용한다.

- [ ] **Step 1: 실패하는 리포지토리 테스트 작성**

```java
package com.nemesis.domain.storage;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("test")
class StorageDeviceRepositoryTest {

    @Autowired StorageDeviceRepository repo;
    @Autowired ClusterRepository       clusterRepo;

    private Cluster cluster(String name) {
        return clusterRepo.save(Cluster.builder().name(name).build());
    }

    @Test
    void saves_and_finds_byClusterId() {
        Cluster c = cluster("storage-test-1");
        repo.save(StorageDevice.builder().cluster(c).wwid("360014056b1a3fbe4c1b4f0b9a5e2d1c").build());

        assertThat(repo.findByClusterId(c.getId())).hasSize(1);
    }

    @Test
    void findByClusterIdAndWwid_matchesExactWwid_onlyWithinCluster() {
        Cluster c1 = cluster("storage-test-2");
        Cluster c2 = cluster("storage-test-3");
        repo.save(StorageDevice.builder().cluster(c1).wwid("abc123").build());

        assertThat(repo.findByClusterIdAndWwid(c1.getId(), "abc123")).isPresent();
        assertThat(repo.findByClusterIdAndWwid(c2.getId(), "abc123")).isEmpty();
        assertThat(repo.findByClusterIdAndWwid(c1.getId(), "zzz")).isEmpty();
    }
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run (backend 디렉토리에서):
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageDeviceRepositoryTest" --no-daemon
```
Expected: FAIL — `StorageDevice`/`StorageDeviceRepository` 클래스가 없어 컴파일 에러.

- [ ] **Step 3: 엔티티 작성**

```java
package com.nemesis.domain.storage;

import com.nemesis.domain.cluster.Cluster;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "storage_devices")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StorageDevice {

    public enum Source { SCAN, MANUAL }
    public enum Status { REGISTERED, MISSING }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_group_id", nullable = false)
    private Cluster cluster;

    @Column(nullable = false, length = 100)
    private String wwid;

    @Column(length = 100)
    private String label;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "path_count", nullable = false)
    @Builder.Default
    private int pathCount = 0;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Source source = Source.MANUAL;

    @Column(name = "discovered_node_id")
    private UUID discoveredNodeId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Status status = Status.REGISTERED;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
        this.updatedAt = OffsetDateTime.now();
    }

    @PreUpdate
    void preUpdate() {
        this.updatedAt = OffsetDateTime.now();
    }
}
```

- [ ] **Step 4: Repository 작성**

```java
package com.nemesis.domain.storage;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface StorageDeviceRepository extends JpaRepository<StorageDevice, UUID> {
    List<StorageDevice> findByClusterId(UUID clusterId);
    Optional<StorageDevice> findByClusterIdAndWwid(UUID clusterId, String wwid);
}
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageDeviceRepositoryTest" --no-daemon
```
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/nemesis/domain/storage/StorageDevice.java \
        backend/src/main/java/com/nemesis/domain/storage/StorageDeviceRepository.java \
        backend/src/test/java/com/nemesis/domain/storage/StorageDeviceRepositoryTest.java
git commit -m "feat(storage): StorageDevice 엔티티/리포지토리 추가"
```

---

### Task 3: 에이전트 `storage.sh` — FC 스캔/디스크 목록(읽기 전용)

**Files:**
- Create: `agent/storage.sh`
- Modify: `agent/nemesis-agent.py:45-54` (`ALLOWED_SCRIPTS`에 `storage.sh` 등록)
- Modify: `agent/install.sh:20-23` 부근 (실배포용 복사)
- Modify: `agent/Dockerfile.test:8` (COPY 목록에 `storage.sh` 추가)

**Interfaces:**
- Produces: 명령 채널로 `storage.sh scan-fc`(FC/SCSI 재스캔, exit 0/1), `storage.sh disk-list`(TSV 출력 `name\twwid\tsize\tpaths`, exit 0). Task 5의 `StorageService.scan()`이 `AgentCommandClient.execute(node, "storage.sh scan-fc")`와 `"storage.sh disk-list"`를 호출한다.

이 에이전트 스크립트는 자동화 테스트 하네스가 없다(기존 `control.sh`도 동일 — 검증은 Docker 컨테이너에서 수동 실행으로 한다).

- [ ] **Step 1: `agent/storage.sh` 작성**

```sh
#!/bin/sh
# =============================================================================
# Nemesis storage.sh — 공유 스토리지(FC SAN) 조회 디스패처 (S0: 읽기 전용)
# AIX / Linux 공통, POSIX sh 호환. control.sh와 동일한 실행 규약을 따른다.
#
# 사용법: storage.sh <subcommand> [args...]
# 종료코드: 0 성공 / 1 실패 / 2 잘못된 사용법
#
# 서브커맨드(S0 — 읽기 전용, 파괴적 변경 없음):
#   scan-fc     FC/SCSI 버스 재스캔 트리거(신규 LUN 인식). 결과 자체는 반환하지 않음
#   disk-list   등록 가능한 LUN 목록(TSV: name\twwid\tsize\tpaths)
#
# AIX 분기는 코드만 작성(테스트 보류 — 장비 확보 후 검증 예정, S4).
# =============================================================================
export LC_ALL=C LANG=C

OS=$(uname -s 2>/dev/null || echo unknown)

log()  { echo "[storage] $*" >&2; }
die()  { log "ERROR: $*"; exit 1; }
usage(){ log "usage: storage.sh <subcommand> [args...]"; exit 2; }

has() { command -v "$1" >/dev/null 2>&1; }

# ----------------------------------------------------------------------------
# FC/SCSI 버스 재스캔
# ----------------------------------------------------------------------------
scan_fc() {
  case "$OS" in
    Linux)
      found=0
      for h in /sys/class/scsi_host/*/scan; do
        [ -e "$h" ] || continue
        echo "- - -" > "$h" 2>/dev/null && found=1
      done
      [ "$found" -eq 1 ] || log "scsi_host scan 인터페이스 없음(FC HBA 미탑재 환경일 수 있음)"
      if has multipath; then
        multipath -r >/dev/null 2>&1 || true
      fi
      log "FC/SCSI 재스캔 완료"
      exit 0
      ;;
    AIX)
      has cfgmgr || die "cfgmgr 없음"
      cfgmgr -v >/dev/null 2>&1 || die "cfgmgr 재스캔 실패"
      log "FC/SCSI 재스캔 완료(cfgmgr)"
      exit 0
      ;;
    *) die "지원하지 않는 OS: $OS" ;;
  esac
}

# ----------------------------------------------------------------------------
# 디스크(LUN) 목록 — TSV: name\twwid\tsize\tpaths
# ----------------------------------------------------------------------------
disk_list_linux_multipath() {
  multipath -ll 2>/dev/null | awk '
    BEGIN { name=""; wwid=""; size=""; paths=0 }
    /^[a-zA-Z0-9_-]+ \(/ {
      if (name != "") printf "%s\t%s\t%s\t%d\n", name, wwid, size, paths
      name=$1; wwid=$2; gsub(/[()]/, "", wwid); size=""; paths=0; next
    }
    {
      for (i=1;i<=NF;i++) if ($i ~ /^size=/) { split($i,a,"="); size=a[2] }
      if ($0 ~ /running$/) paths++
    }
    END { if (name != "") printf "%s\t%s\t%s\t%d\n", name, wwid, size, paths }
  '
}

disk_list_linux_fallback() {
  # multipath 미설치(단일경로) — WWN 지원(util-linux 2.29+) lsblk 폴백
  lsblk -ndp -o NAME,WWN,SIZE,TYPE 2>/dev/null | awk '
    $4 == "disk" && $2 != "" { print $1 "\t" $2 "\t" $3 "\t1" }
  '
}

disk_list() {
  case "$OS" in
    Linux)
      out=""
      if has multipath; then
        out=$(disk_list_linux_multipath)
      fi
      if [ -z "$out" ]; then
        has multipath || log "multipath 미설치 — 단일경로 폴백 조회"
        out=$(disk_list_linux_fallback)
      fi
      [ -n "$out" ] && printf '%s\n' "$out"
      exit 0
      ;;
    AIX)
      # 미검증(AIX 장비는 있으나 이번 릴리스 테스트 보류) — lspv 기반 베스트에포트
      has lspv || die "lspv 없음"
      lspv 2>/dev/null | awk '{ print $1 "\t" $1 "\t\t1" }'
      exit 0
      ;;
    *) die "지원하지 않는 OS: $OS" ;;
  esac
}

# ----------------------------------------------------------------------------
# 디스패치
# ----------------------------------------------------------------------------
SUB=$1; [ -n "$SUB" ] || usage; shift
case "$SUB" in
  scan-fc)   scan_fc ;;
  disk-list) disk_list ;;
  *)         log "알 수 없는 서브커맨드: $SUB"; usage ;;
esac
```

- [ ] **Step 2: `nemesis-agent.py` 화이트리스트에 등록**

`agent/nemesis-agent.py:45-54`의 `ALLOWED_SCRIPTS` 딕셔너리를 다음으로 교체:

```python
ALLOWED_SCRIPTS = {
    'control.sh':              os.path.join(SCRIPT_DIR, 'control.sh'),
    'storage.sh':              os.path.join(SCRIPT_DIR, 'storage.sh'),
    'healing/heal_oracle.sh':  os.path.join(HEALING_DIR, 'heal_oracle.sh'),
    'healing/heal_tomcat.sh':  os.path.join(HEALING_DIR, 'heal_tomcat.sh'),
    'healing/heal_nginx.sh':   os.path.join(HEALING_DIR, 'heal_nginx.sh'),
    # 베이스네임 단축 호출도 허용
    'heal_oracle.sh':          os.path.join(HEALING_DIR, 'heal_oracle.sh'),
    'heal_tomcat.sh':          os.path.join(HEALING_DIR, 'heal_tomcat.sh'),
    'heal_nginx.sh':           os.path.join(HEALING_DIR, 'heal_nginx.sh'),
}
```

- [ ] **Step 3: `install.sh`에 실배포용 복사 추가**

`agent/install.sh:20-23` 아래(HA 실행 스크립트 복사 다음)에 추가:

```sh
cp -f storage.sh "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/storage.sh"
```

- [ ] **Step 4: `Dockerfile.test`의 COPY 목록에 추가**

`agent/Dockerfile.test:8`을 다음으로 교체:

```
COPY nemesis-agent.py control.sh storage.sh collect.sh collect_aix.sh ./
```

- [ ] **Step 5: 실행 권한 부여 + 문법 검사**

```bash
chmod +x agent/storage.sh
sh -n agent/storage.sh
```
Expected: 출력 없음(문법 오류 없음)

- [ ] **Step 6: 로컬에서 직접 실행해 스모크 테스트**

```bash
cd agent && sh storage.sh disk-list; echo "exit=$?"
```
Expected: `exit=0` (개발 호스트엔 실 FC LUN이 없으므로 목록은 비어 있거나 호스트 로컬 디스크가 나올 수 있음 — TSV 형식이거나 빈 출력이면 정상)

```bash
sh storage.sh badcmd; echo "exit=$?"
```
Expected: `usage: storage.sh <subcommand> [args...]`와 함께 `exit=2`

- [ ] **Step 7: Docker 테스트 이미지로 재현(화이트리스트 경로까지 확인)**

```bash
cd agent && docker build -f Dockerfile.test -t nemesis-agent-test .
docker run --rm nemesis-agent-test true 2>&1 | head -1 || true
docker run --rm --entrypoint sh nemesis-agent-test -c "storage.sh disk-list; echo exit=\$?"
```
Expected: `exit=0`

- [ ] **Step 8: Commit**

```bash
git add agent/storage.sh agent/nemesis-agent.py agent/install.sh agent/Dockerfile.test
git commit -m "feat(agent): storage.sh 신설(FC 스캔/디스크 목록, 읽기 전용) + 화이트리스트 등록"
```

---

### Task 4: StorageService — 순수 파싱 함수(TSV → DiscoveredDevice, 크기 파싱)

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/storage/StorageService.java`
- Create: `backend/src/test/java/com/nemesis/domain/storage/StorageServiceTest.java`

**Interfaces:**
- Consumes: 없음(순수 함수, 이 단계에서는 리포지토리/커맨드클라이언트 미사용)
- Produces: `StorageService.DiscoveredDevice(name, wwid, sizeBytes, pathCount, alreadyRegistered)` record, `parseDiskList(String stdout)`, `parseSize(String s)` — Task 5의 `scan()`이 이 두 메서드를 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```java
package com.nemesis.domain.storage;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.NodeRepository;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class StorageServiceTest {

    private final StorageDeviceRepository deviceRepo  = mock(StorageDeviceRepository.class);
    private final ClusterRepository       clusterRepo = mock(ClusterRepository.class);
    private final NodeRepository          nodeRepo    = mock(NodeRepository.class);
    private final AgentCommandClient      cmd         = mock(AgentCommandClient.class);
    private final StorageService svc = new StorageService(deviceRepo, clusterRepo, nodeRepo, cmd);

    @Test
    void parseDiskList_parsesTsvLines() {
        var result = svc.parseDiskList("mpatha\t360014056b1a3fbe\t10G\t2\nmpathb\t360014056b1a3fbf\t5G\t1\n");

        assertThat(result).hasSize(2);
        assertThat(result.get(0).name()).isEqualTo("mpatha");
        assertThat(result.get(0).wwid()).isEqualTo("360014056b1a3fbe");
        assertThat(result.get(0).sizeBytes()).isEqualTo(10L * 1024 * 1024 * 1024);
        assertThat(result.get(0).pathCount()).isEqualTo(2);
    }

    @Test
    void parseDiskList_skipsBlankLinesAndRowsWithoutWwid() {
        var result = svc.parseDiskList("\nmpatha\t\t10G\t2\nmpathb\t360014056b1a3fbf\t5G\t1\n");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).wwid()).isEqualTo("360014056b1a3fbf");
    }

    @Test
    void parseDiskList_nullStdout_returnsEmptyList() {
        assertThat(svc.parseDiskList(null)).isEmpty();
    }

    @Test
    void parseSize_handlesUnitsAndPlainBytes() {
        assertThat(svc.parseSize("10G")).isEqualTo(10L * 1024 * 1024 * 1024);
        assertThat(svc.parseSize("512M")).isEqualTo(512L * 1024 * 1024);
        assertThat(svc.parseSize("2048")).isEqualTo(2048L);
        assertThat(svc.parseSize(null)).isNull();
        assertThat(svc.parseSize("garbage")).isNull();
    }
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageServiceTest" --no-daemon
```
Expected: FAIL — `StorageService` 클래스가 없어 컴파일 에러

- [ ] **Step 3: `StorageService` 골격 + 파싱 함수 구현**

```java
package com.nemesis.domain.storage;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 공유 스토리지(FC LUN) 인벤토리: 스캔 조회(비영속) + 등록/삭제(영속). */
@Slf4j
@Service
@RequiredArgsConstructor
public class StorageService {

    private final StorageDeviceRepository deviceRepository;
    private final ClusterRepository       clusterRepository;
    private final NodeRepository          nodeRepository;
    private final AgentCommandClient      commandClient;

    private static final Pattern SIZE_PATTERN =
            Pattern.compile("([0-9.]+)\\s*([KMGTP]?)B?", Pattern.CASE_INSENSITIVE);

    public record DiscoveredDevice(String name, String wwid, Long sizeBytes,
                                    int pathCount, boolean alreadyRegistered) {}

    /** storage.sh disk-list의 TSV 출력(name\twwid\tsize\tpaths)을 파싱한다. */
    List<DiscoveredDevice> parseDiskList(String stdout) {
        List<DiscoveredDevice> out = new ArrayList<>();
        if (stdout == null) return out;
        for (String line : stdout.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            String[] cols = trimmed.split("\t", -1);
            if (cols.length < 4) continue;
            String wwid = cols[1].trim();
            if (wwid.isEmpty()) continue;
            out.add(new DiscoveredDevice(cols[0].trim(), wwid,
                    parseSize(cols[2].trim()), parseIntSafe(cols[3].trim()), false));
        }
        return out;
    }

    /** "10G"/"512M"/"2048" 같은 크기 표기를 바이트로 변환한다(이진 단위). */
    Long parseSize(String s) {
        if (s == null || s.isBlank()) return null;
        Matcher m = SIZE_PATTERN.matcher(s.trim());
        if (!m.matches()) return null;
        double num = Double.parseDouble(m.group(1));
        long mult = switch (m.group(2).toUpperCase()) {
            case "K" -> 1024L;
            case "M" -> 1024L * 1024;
            case "G" -> 1024L * 1024 * 1024;
            case "T" -> 1024L * 1024 * 1024 * 1024;
            case "P" -> 1024L * 1024 * 1024 * 1024 * 1024;
            default -> 1L;
        };
        return (long) (num * mult);
    }

    private int parseIntSafe(String s) {
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; }
    }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageServiceTest" --no-daemon
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/nemesis/domain/storage/StorageService.java \
        backend/src/test/java/com/nemesis/domain/storage/StorageServiceTest.java
git commit -m "feat(storage): StorageService 디스크 목록/크기 파싱 구현"
```

---

### Task 5: StorageService — scan/list/register/delete

**Files:**
- Modify: `backend/src/main/java/com/nemesis/domain/storage/StorageService.java` (Task 4에 이어 추가)
- Modify: `backend/src/test/java/com/nemesis/domain/storage/StorageServiceTest.java` (테스트 추가)
- Create: `backend/src/main/java/com/nemesis/domain/storage/dto/StorageDtos.java`

**Interfaces:**
- Consumes: Task 2의 `StorageDevice`/`StorageDeviceRepository`, Task 4의 `parseDiskList`/`parseSize`, `com.nemesis.domain.agent.AgentCommandClient.Result(ok, exitCode, stdout, stderr, error)`, `com.nemesis.domain.node.Node`/`NodeRepository.findByClusterId`, `com.nemesis.domain.cluster.Cluster`/`ClusterRepository`
- Produces: `StorageService.listDevices(UUID clusterId)`, `StorageService.scan(UUID clusterId, UUID nodeId)`, `StorageService.registerDevice(UUID clusterId, StorageDtos.RegisterDeviceRequest req)`, `StorageService.deleteDevice(UUID clusterId, UUID deviceId)` — Task 6의 `StorageController`가 이 4개 메서드를 호출한다.

- [ ] **Step 1: DTO 파일 작성**

```java
package com.nemesis.domain.storage.dto;

import java.util.UUID;

public class StorageDtos {
    public record RegisterDeviceRequest(String wwid, String label, Long sizeBytes,
                                         Integer pathCount, UUID discoveredNodeId) {}
}
```

- [ ] **Step 2: 실패하는 테스트 추가**

`StorageServiceTest.java`에 다음 import와 테스트를 추가한다:

```java
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.storage.dto.StorageDtos.RegisterDeviceRequest;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
```

기존 클래스 본문 끝에 추가:

```java
    private Cluster cluster(UUID id) {
        Cluster c = new Cluster(); c.setId(id); c.setName("c"); return c;
    }

    private Node node(UUID clusterId, UUID nodeId, String host) {
        Node n = new Node(); n.setId(nodeId); n.setHostname(host);
        n.setServiceIp("10.0.0.1"); n.setNetIface("eth0");
        return n;
    }

    @Test
    void registerDevice_rejectsInvalidWwid() {
        UUID clusterId = UUID.randomUUID();
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));

        assertThatThrownBy(() -> svc.registerDevice(clusterId,
                new RegisterDeviceRequest("not a wwid!", null, null, null, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("WWID");
    }

    @Test
    void registerDevice_rejectsDuplicateWwidInSameCluster() {
        UUID clusterId = UUID.randomUUID();
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(deviceRepo.findByClusterIdAndWwid(clusterId, "0123abcd")).thenReturn(Optional.of(mock(StorageDevice.class)));

        assertThatThrownBy(() -> svc.registerDevice(clusterId,
                new RegisterDeviceRequest("0123abcd", null, null, null, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("이미 등록");
    }

    @Test
    void registerDevice_savesManualSource_whenNoDiscoveredNodeId() {
        UUID clusterId = UUID.randomUUID();
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(deviceRepo.findByClusterIdAndWwid(clusterId, "0123abcd")).thenReturn(Optional.empty());
        when(deviceRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

        StorageDevice saved = svc.registerDevice(clusterId,
                new RegisterDeviceRequest("0123abcd", "라벨", 100L, 2, null));

        assertThat(saved.getSource()).isEqualTo(StorageDevice.Source.MANUAL);
        assertThat(saved.getWwid()).isEqualTo("0123abcd");
    }

    @Test
    void scan_marksAlreadyRegisteredDevices() {
        UUID clusterId = UUID.randomUUID();
        UUID nodeId = UUID.randomUUID();
        Node n = node(clusterId, nodeId, "bot");
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(nodeRepo.findByClusterId(clusterId)).thenReturn(List.of(n));
        when(cmd.execute(eq(n), eq("storage.sh scan-fc")))
                .thenReturn(new AgentCommandClient.Result(true, 0, "", "", null));
        when(cmd.execute(eq(n), eq("storage.sh disk-list")))
                .thenReturn(new AgentCommandClient.Result(true, 0, "mpatha\tabc123\t10G\t2\n", "", null));
        StorageDevice existing = StorageDevice.builder().wwid("abc123").build();
        when(deviceRepo.findByClusterId(clusterId)).thenReturn(List.of(existing));

        var result = svc.scan(clusterId, nodeId);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).alreadyRegistered()).isTrue();
    }

    @Test
    void scan_throwsIllegalState_whenDiskListFails() {
        UUID clusterId = UUID.randomUUID();
        UUID nodeId = UUID.randomUUID();
        Node n = node(clusterId, nodeId, "bot");
        when(clusterRepo.findById(clusterId)).thenReturn(Optional.of(cluster(clusterId)));
        when(nodeRepo.findByClusterId(clusterId)).thenReturn(List.of(n));
        when(cmd.execute(eq(n), eq("storage.sh scan-fc")))
                .thenReturn(new AgentCommandClient.Result(true, 0, "", "", null));
        when(cmd.execute(eq(n), eq("storage.sh disk-list")))
                .thenReturn(AgentCommandClient.Result.transportError("에이전트 통신 실패"));

        assertThatThrownBy(() -> svc.scan(clusterId, nodeId))
                .isInstanceOf(IllegalStateException.class);
    }
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageServiceTest" --no-daemon
```
Expected: FAIL — `listDevices`/`scan`/`registerDevice`/`deleteDevice` 메서드가 없어 컴파일 에러

- [ ] **Step 4: 메서드 구현**

`StorageService.java`에 다음 import를 추가:

```java
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.domain.storage.dto.StorageDtos.RegisterDeviceRequest;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
```

클래스 본문에 다음 메서드와 필드를 추가:

```java
    private static final Pattern WWID_PATTERN = Pattern.compile("^[0-9a-fA-F]{8,64}$");

    public List<StorageDevice> listDevices(UUID clusterId) {
        return deviceRepository.findByClusterId(clusterId);
    }

    /** 지정 노드에서 FC 재스캔 후 디스크 목록을 조회한다(영속화하지 않음 — 등록 전 미리보기). */
    public List<DiscoveredDevice> scan(UUID clusterId, UUID nodeId) {
        clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("cluster not found: " + clusterId));
        Node node = nodeRepository.findByClusterId(clusterId).stream()
                .filter(n -> n.getId().equals(nodeId)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("노드가 클러스터에 없습니다: " + nodeId));

        AgentCommandClient.Result rescan = commandClient.execute(node, "storage.sh scan-fc");
        if (!rescan.ok()) {
            log.warn("FC 재스캔 실패(계속 진행, 기존 상태로 조회): {} - {}",
                    node.getHostname(), rescan.error() != null ? rescan.error() : rescan.stderr());
        }

        AgentCommandClient.Result list = commandClient.execute(node, "storage.sh disk-list");
        if (!list.ok()) {
            throw new IllegalStateException("디스크 목록 조회 실패: " +
                    (list.error() != null ? list.error() : list.stderr()));
        }

        List<String> registeredWwids = deviceRepository.findByClusterId(clusterId).stream()
                .map(StorageDevice::getWwid).toList();
        return parseDiskList(list.stdout()).stream()
                .map(d -> new DiscoveredDevice(d.name(), d.wwid(), d.sizeBytes(), d.pathCount(),
                        registeredWwids.contains(d.wwid())))
                .toList();
    }

    @Transactional
    public StorageDevice registerDevice(UUID clusterId, RegisterDeviceRequest req) {
        Cluster cluster = clusterRepository.findById(clusterId)
                .orElseThrow(() -> new IllegalArgumentException("cluster not found: " + clusterId));
        String wwid = req.wwid() == null ? "" : req.wwid().trim();
        if (!WWID_PATTERN.matcher(wwid).matches()) {
            throw new IllegalStateException("올바르지 않은 WWID 형식입니다: " + req.wwid());
        }
        if (deviceRepository.findByClusterIdAndWwid(clusterId, wwid).isPresent()) {
            throw new IllegalStateException("이미 등록된 WWID입니다: " + wwid);
        }
        StorageDevice device = StorageDevice.builder()
                .cluster(cluster)
                .wwid(wwid)
                .label(req.label())
                .sizeBytes(req.sizeBytes())
                .pathCount(req.pathCount() == null ? 0 : req.pathCount())
                .source(req.discoveredNodeId() != null ? StorageDevice.Source.SCAN : StorageDevice.Source.MANUAL)
                .discoveredNodeId(req.discoveredNodeId())
                .status(StorageDevice.Status.REGISTERED)
                .build();
        return deviceRepository.save(device);
    }

    @Transactional
    public void deleteDevice(UUID clusterId, UUID deviceId) {
        StorageDevice device = deviceRepository.findById(deviceId)
                .orElseThrow(() -> new IllegalArgumentException("디바이스 없음: " + deviceId));
        if (!device.getCluster().getId().equals(clusterId)) {
            throw new IllegalArgumentException("디바이스가 해당 클러스터에 속하지 않습니다: " + deviceId);
        }
        deviceRepository.deleteById(deviceId);
    }
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageServiceTest" --no-daemon
```
Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/nemesis/domain/storage/StorageService.java \
        backend/src/main/java/com/nemesis/domain/storage/dto/StorageDtos.java \
        backend/src/test/java/com/nemesis/domain/storage/StorageServiceTest.java
git commit -m "feat(storage): 스캔/등록/삭제 로직 구현"
```

---

### Task 6: StorageController + RBAC 규칙

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/storage/StorageController.java`
- Modify: `backend/src/main/java/com/nemesis/security/RbacFilter.java:85-86` 부근
- Create: `backend/src/test/java/com/nemesis/domain/storage/StorageControllerRbacTest.java`

**Interfaces:**
- Consumes: Task 5의 `StorageService.listDevices/scan/registerDevice/deleteDevice`, `com.nemesis.security.TokenService`, `com.nemesis.domain.user.User`
- Produces: REST 엔드포인트 `GET/POST /api/clusters/{clusterId}/storage/devices`, `POST /api/clusters/{clusterId}/storage/scan?nodeId=`, `DELETE /api/clusters/{clusterId}/storage/devices/{deviceId}` — Task 7 프론트가 호출.

- [ ] **Step 1: 컨트롤러 작성**

```java
package com.nemesis.domain.storage;

import com.nemesis.domain.storage.dto.StorageDtos.RegisterDeviceRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/clusters/{clusterId}/storage")
@RequiredArgsConstructor
public class StorageController {

    private final StorageService storageService;

    @GetMapping("/devices")
    public ResponseEntity<List<StorageDevice>> devices(@PathVariable UUID clusterId) {
        return ResponseEntity.ok(storageService.listDevices(clusterId));
    }

    @PostMapping("/scan")
    public ResponseEntity<List<StorageService.DiscoveredDevice>> scan(
            @PathVariable UUID clusterId, @RequestParam UUID nodeId) {
        return ResponseEntity.ok(storageService.scan(clusterId, nodeId));
    }

    @PostMapping("/devices")
    public ResponseEntity<StorageDevice> register(@PathVariable UUID clusterId,
                                                   @RequestBody RegisterDeviceRequest body) {
        return ResponseEntity.ok(storageService.registerDevice(clusterId, body));
    }

    @DeleteMapping("/devices/{deviceId}")
    public ResponseEntity<Void> delete(@PathVariable UUID clusterId, @PathVariable UUID deviceId) {
        storageService.deleteDevice(clusterId, deviceId);
        return ResponseEntity.noContent().build();
    }
}
```

- [ ] **Step 2: RBAC 규칙 추가**

`backend/src/main/java/com/nemesis/security/RbacFilter.java`의 `mutating` 블록(85-86번 줄 부근, `sync/provision-ssh` 규칙 다음)에 추가:

```java
            if (path.matches("/api/clusters/[^/]+/storage/.*"))            return Need.OPERATOR; // scan/등록/삭제
```

- [ ] **Step 3: 실패하는 RBAC 테스트 작성**

```java
package com.nemesis.domain.storage;

import com.nemesis.domain.user.User;
import com.nemesis.security.TokenService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.test.context.ActiveProfiles;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class StorageControllerRbacTest {

    @LocalServerPort int port;
    @Autowired TestRestTemplate http;
    @Autowired TokenService tokenService;

    private HttpEntity<Void> as(String username, User.Role role) {
        String token = tokenService.issue(User.builder().username(username).role(role).build());
        HttpHeaders h = new HttpHeaders(); h.setBearerAuth(token);
        return new HttpEntity<>(h);
    }

    @Test
    void viewer_cannot_triggerScan() {
        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/clusters/" + UUID.randomUUID()
                        + "/storage/scan?nodeId=" + UUID.randomUUID(),
                HttpMethod.POST, as("v", User.Role.viewer), String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void viewer_can_listDevices() {
        ResponseEntity<String> r = http.exchange(
                "http://localhost:" + port + "/api/clusters/" + UUID.randomUUID() + "/storage/devices",
                HttpMethod.GET, as("v", User.Role.viewer), String.class);
        assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```

- [ ] **Step 4: 테스트 실행 → 실패 확인**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageControllerRbacTest" --no-daemon
```
Expected: FAIL — 컨트롤러가 없어 404, 또는 RBAC 규칙 미적용으로 `viewer_cannot_triggerScan`이 200을 반환

- [ ] **Step 5: Step 1·2를 적용한 뒤 재실행 → 통과 확인**

Run:
```bash
docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --tests "com.nemesis.domain.storage.StorageControllerRbacTest" --no-daemon
```
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/nemesis/domain/storage/StorageController.java \
        backend/src/main/java/com/nemesis/security/RbacFilter.java \
        backend/src/test/java/com/nemesis/domain/storage/StorageControllerRbacTest.java
git commit -m "feat(storage): StorageController + RBAC(OPERATOR) 규칙 추가"
```

---

### Task 7: 프론트 API 클라이언트

**Files:**
- Modify: `frontend/src/api/client.js` (sync 섹션 뒤, 대략 61번 줄 이후)

**Interfaces:**
- Produces: `getStorageDevices(clusterId)`, `scanStorage(clusterId, nodeId)`, `registerStorageDevice(clusterId, data)`, `deleteStorageDevice(clusterId, deviceId)` — Task 8의 `Storage.jsx`가 이 4개를 import한다.

- [ ] **Step 1: API 함수 추가**

`frontend/src/api/client.js`의 `browseNodeDirs` 라인 다음에 추가:

```js
// ── 공유 스토리지 (Nemesis Share, S0: 조회) ─────────────────────
export const getStorageDevices     = (cid)          => client.get(`/clusters/${cid}/storage/devices`)
export const scanStorage           = (cid, nodeId)  => client.post(`/clusters/${cid}/storage/scan`, null, { params: { nodeId } })
export const registerStorageDevice = (cid, data)    => client.post(`/clusters/${cid}/storage/devices`, data)
export const deleteStorageDevice   = (cid, deviceId)=> client.delete(`/clusters/${cid}/storage/devices/${deviceId}`)
```

- [ ] **Step 2: 문법 확인**

```bash
cd frontend && node --check src/api/client.js
```
Expected: 출력 없음(문법 오류 없음). `node --check`는 ESM 문법(import/export)도 파싱 가능.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.js
git commit -m "feat(storage): 공유 스토리지 API 클라이언트 함수 추가"
```

---

### Task 8: 프론트 Storage 페이지 + 라우팅

**Files:**
- Create: `frontend/src/pages/storage/Storage.jsx`
- Modify: `frontend/src/components/Sidebar.jsx:18-22` (클러스터 그룹에 메뉴 추가)
- Modify: `frontend/src/App.jsx` (import + route 추가)

**Interfaces:**
- Consumes: Task 7의 `getStorageDevices/scanStorage/registerStorageDevice/deleteStorageDevice`, 기존 `getClusters/getClusterStatus`
- Produces: 라우트 `/storage` — 사용자가 사이드바 '클러스터 > 공유 스토리지'로 진입.

- [ ] **Step 1: `Storage.jsx` 작성**

```jsx
import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw, HardDrive, Trash2, ScanLine } from 'lucide-react'
import {
  getClusters, getClusterStatus,
  getStorageDevices, scanStorage, registerStorageDevice, deleteStorageDevice,
} from '../../api/client'

function RegisterForm({ clusterId, discoveredNodeId, prefill, onDone }) {
  const [form, setForm] = useState({
    wwid: prefill?.wwid || '',
    label: '',
    sizeBytes: prefill?.sizeBytes ?? '',
    pathCount: prefill?.pathCount ?? 1,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setSaving(true); setError('')
    try {
      await registerStorageDevice(clusterId, {
        wwid: form.wwid.trim(),
        label: form.label.trim() || null,
        sizeBytes: form.sizeBytes === '' ? null : Number(form.sizeBytes),
        pathCount: form.pathCount === '' ? null : Number(form.pathCount),
        discoveredNodeId: discoveredNodeId || null,
      })
      onDone()
    } catch (e) {
      setError(e.response?.data?.error || '등록 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 bg-gray-900/50 rounded-lg p-3">
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">WWID</label>
        <input className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-56"
          value={form.wwid} onChange={e => setForm(f => ({ ...f, wwid: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">라벨</label>
        <input className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-32"
          value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">크기(byte)</label>
        <input type="number" className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-32"
          value={form.sizeBytes} onChange={e => setForm(f => ({ ...f, sizeBytes: e.target.value }))} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">경로 수</label>
        <input type="number" className="bg-gray-800 text-xs text-white rounded px-2 py-1 w-20"
          value={form.pathCount} onChange={e => setForm(f => ({ ...f, pathCount: e.target.value }))} />
      </div>
      <button disabled={saving || !form.wwid.trim()} onClick={submit}
        className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded px-3 py-1.5">
        등록
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  )
}

function ClusterStoragePanel({ cluster }) {
  const [devices, setDevices] = useState([])
  const [selectedNode, setSelectedNode] = useState('')
  const [discovered, setDiscovered] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [showManual, setShowManual] = useState(false)

  const load = useCallback(async () => {
    const res = await getStorageDevices(cluster.clusterId)
    setDevices(res.data ?? [])
  }, [cluster.clusterId])

  useEffect(() => { load() }, [load])

  const runScan = async () => {
    if (!selectedNode) return
    setScanning(true); setScanError(''); setDiscovered(null)
    try {
      const res = await scanStorage(cluster.clusterId, selectedNode)
      setDiscovered(res.data)
    } catch (e) {
      setScanError(e.response?.data?.error || '스캔 실패')
    } finally {
      setScanning(false)
    }
  }

  const removeDevice = async (deviceId) => {
    if (!window.confirm('이 디바이스 등록을 해제하시겠습니까? (실제 디스크는 변경되지 않습니다)')) return
    await deleteStorageDevice(cluster.clusterId, deviceId)
    load()
  }

  return (
    <div className="card-bg rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-blue-400" />
          <span className="font-bold text-white">{cluster.clusterName}</span>
        </div>
        <div className="flex items-center gap-2">
          <select className="bg-gray-800 text-xs text-white rounded px-2 py-1"
            value={selectedNode} onChange={e => setSelectedNode(e.target.value)}>
            <option value="">노드 선택</option>
            {(cluster.nodes ?? []).map(n => (
              <option key={n.nodeId} value={n.nodeId}>{n.hostname}</option>
            ))}
          </select>
          <button disabled={!selectedNode || scanning} onClick={runScan}
            className="flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white rounded px-3 py-1.5">
            <ScanLine className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            FC 스캔
          </button>
          <button onClick={() => setShowManual(s => !s)}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-white rounded px-3 py-1.5">
            수동 등록
          </button>
        </div>
      </div>

      {scanError && <div className="text-xs text-red-400">{scanError}</div>}

      {discovered && (
        <div className="space-y-2">
          <p className="text-[10px] text-gray-500 uppercase">
            스캔 결과 ({discovered.length}건 — 등록 전까지 저장되지 않음)
          </p>
          {discovered.length === 0
            ? <p className="text-xs text-gray-600">발견된 LUN이 없습니다.</p>
            : discovered.map(d => (
                <div key={d.wwid} className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2 text-xs gap-3 flex-wrap">
                  <span className="text-gray-300 font-mono">{d.wwid}</span>
                  <span className="text-gray-500">{d.name} · {d.pathCount}경로</span>
                  {d.alreadyRegistered
                    ? <span className="text-green-400">등록됨</span>
                    : <RegisterForm clusterId={cluster.clusterId} discoveredNodeId={selectedNode}
                        prefill={{ wwid: d.wwid, sizeBytes: d.sizeBytes, pathCount: d.pathCount }}
                        onDone={() => { load(); setDiscovered(null) }} />}
                </div>
              ))}
        </div>
      )}

      {showManual && (
        <RegisterForm clusterId={cluster.clusterId} discoveredNodeId={null}
          onDone={() => { load(); setShowManual(false) }} />
      )}

      <div className="border-t border-gray-800 pt-3">
        <p className="text-[10px] text-gray-500 uppercase mb-2">등록된 디바이스 ({devices.length})</p>
        {devices.length === 0
          ? <p className="text-xs text-gray-600">등록된 공유 디바이스가 없습니다.</p>
          : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 text-left">
                  <th className="font-normal pb-2">WWID</th>
                  <th className="font-normal pb-2">라벨</th>
                  <th className="font-normal pb-2">크기</th>
                  <th className="font-normal pb-2">경로</th>
                  <th className="font-normal pb-2">출처</th>
                  <th className="font-normal pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id} className="border-t border-gray-800/60">
                    <td className="py-2 font-mono text-gray-300">{d.wwid}</td>
                    <td className="py-2 text-gray-400">{d.label || '—'}</td>
                    <td className="py-2 text-gray-400">
                      {d.sizeBytes ? `${(d.sizeBytes / (1024 ** 3)).toFixed(1)} GiB` : '—'}
                    </td>
                    <td className="py-2 text-gray-400">{d.pathCount}</td>
                    <td className="py-2 text-gray-500">{d.source}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeDevice(d.id)} className="text-gray-500 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}

export default function Storage() {
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const listRes = await getClusters()
      const stats = await Promise.all(
        listRes.data.map(c =>
          getClusterStatus(c.id).then(r => r.data)
            .catch(() => ({ clusterId: c.id, clusterName: c.name, nodes: [] }))
        )
      )
      setStatuses(stats)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-8 pt-0 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">공유 스토리지</h2>
          <p className="text-xs text-gray-500 mt-1">FC SAN 디바이스 조회 · 등록 (Nemesis Share)</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> 수동 갱신
        </button>
      </div>

      {loading && statuses.length === 0 ? (
        <div className="text-center py-16 text-gray-500">로딩 중...</div>
      ) : statuses.length === 0 ? (
        <div className="text-center py-16 text-gray-500">등록된 클러스터가 없습니다.</div>
      ) : statuses.map(c => <ClusterStoragePanel key={c.clusterId} cluster={c} />)}
    </div>
  )
}
```

- [ ] **Step 2: Sidebar에 메뉴 추가**

`frontend/src/components/Sidebar.jsx:18-22`를 다음으로 교체:

```jsx
  { label: '클러스터', icon: GitBranch, path: null, children: [
    { label: '클러스터 목록', path: '/ha/groups'         },
    { label: '공유 스토리지', path: '/storage'           },
    { label: '클러스터 설정', path: '/settings/clusters' },
    { label: 'HA 운영 절차', path: '/ha/sequence'       },
  ]},
```

- [ ] **Step 3: App.jsx에 라우트 추가**

`frontend/src/App.jsx`의 import 목록(`HaSequence` 다음 줄)에 추가:

```jsx
import Storage           from './pages/storage/Storage'
```

`{/* HA */}` 라우트 블록 다음에 추가:

```jsx
          {/* 스토리지 */}
          <Route path="/storage"               element={<Storage />} />
```

- [ ] **Step 4: 문법 확인**

```bash
cd frontend && node --check src/pages/storage/Storage.jsx \
  && node --check src/components/Sidebar.jsx \
  && node --check src/App.jsx
```
Expected: 출력 없음(세 파일 모두 문법 오류 없음)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/storage/Storage.jsx frontend/src/components/Sidebar.jsx frontend/src/App.jsx
git commit -m "feat(storage): 공유 스토리지 목록/스캔/등록 UI + 사이드바 라우팅"
```

---

### Task 9: 전체 스택 재빌드·재배포 + 수동 e2e 검증

**Files:** 없음(빌드/배포/수동 검증만)

**Interfaces:** 없음(통합 검증 단계)

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend && docker run --rm -v "$PWD":/app -w /app gradle:8.7-jdk17-alpine gradle test --no-daemon
```
Expected: 전 테스트 PASS (신규 Task 2/4/5/6 테스트 포함). 기존에 상시 실패로 알려진 `NodeDeleteErrorTest`/`AgentRegistrationControllerTest`(환경 이슈, SP3와 무관)는 실패해도 무관 — 신규 storage 테스트만 확인한다.

- [ ] **Step 2: 백엔드 재빌드·재기동 (실 Postgres 대상 — Flyway가 V22 적용)**

기존 배포 흐름(운영 컨테이너 `docker run --name nemesis-server-e2e ...`)을 따라 이미지 재빌드 후 컨테이너 재생성. 기동 로그에서 확인:

```bash
docker logs nemesis-server-e2e 2>&1 | grep -i "V22\|storage_devices\|Flyway"
```
Expected: `Migrating schema ... to version "22 - shared storage"` 류의 로그, 에러 없음.

- [ ] **Step 3: 에이전트 재배포 (bot 컨테이너들에 storage.sh 반영)**

기존 dir-sync 배포 시 사용한 방식대로 bot/bot-02 컨테이너의 에이전트 파일을 갱신하고 재시작한다(코드 수정 후 재시작 필수 — [[nemesis-local-dev-quirks]]). 반영 확인:

```bash
docker exec bot sh -c "storage.sh disk-list; echo exit=\$?"
```
Expected: `exit=0`

- [ ] **Step 4: 프론트 빌드/재기동**

기존 배포 절차대로 프론트 재빌드 후 nginx(:18090) 반영.

- [ ] **Step 5: 브라우저로 실제 동작 확인**

1. `:18090`으로 로그인 → 사이드바 '클러스터 > 공유 스토리지' 진입 → `/storage` 렌더링 확인
2. 클러스터 패널에서 노드 선택 → 'FC 스캔' 클릭 → 스캔 결과(빈 목록이어도 무방, 개발 환경엔 실 FC 없음) 표시 확인, 에러 없이 응답 오는지 확인
3. '수동 등록' 클릭 → WWID(`0123456789abcdef0123456789abcdef` 등 유효 16진수) 입력 후 등록 → 등록된 디바이스 목록에 반영 확인
4. 잘못된 WWID(`abc!`)로 등록 시도 → 400/에러 메시지 노출 확인
5. 등록된 디바이스 삭제(휴지통 아이콘) → 목록에서 제거 확인
6. viewer 계정으로 로그인 → 스캔/등록/삭제 버튼이 403으로 막히는지(또는 UI에서 시도 시 에러) 확인 — RBAC 규칙 실제 동작 검증

- [ ] **Step 6: 최종 커밋(문서 갱신이 필요하면)**

이 태스크는 코드 변경이 없으므로 커밋 없음. 검증 중 발견된 문제는 해당 태스크로 돌아가 수정 후 그 태스크에서 커밋한다.

---

## Self-Review 메모

- **스펙 커버리지**: PRD 6.1(스토리지 스캔)·인벤토리 API·수동 등록 경로·UI 목록·WWID 스키마 — 모두 Task 1~8에서 커버. 6.2~6.7(파티션/볼륨/FS/마운트 정책)과 페일오버 통합은 S1/S2 스코프로 design 문서에 명시돼 있어 이 계획에는 포함하지 않음(의도적 범위 제한).
- **플레이스홀더 없음**: 각 스텝에 완전한 코드/명령을 포함시킴.
- **타입 일관성**: `StorageService.DiscoveredDevice` 필드명(`name, wwid, sizeBytes, pathCount, alreadyRegistered`)이 Task 4/5/6/8 전체에서 동일하게 사용됨. `RegisterDeviceRequest` 필드명도 Task 5 서비스 구현과 Task 8 프론트 payload가 일치.
- **스코프 확인**: 파괴적 작업(mkfs/mount 등) 없음 — S0 원칙 준수.
