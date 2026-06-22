# 노드 간 폴더 동기화 (Directory Sync) 설계

> 작성일: 2026-06-22
> 대상: Nemesis 클러스터 설정 추가 기능
> 한 줄: 사용자가 동기화할 디렉토리를 선택하면 rsync(SSH, heartbeat IP 경유)로 active→standby 노드 간 폴더를 동기화한다.

---

## 1. 목적 / 배경

HA 클러스터에서 페일오버 후 standby가 즉시 서비스를 이어받으려면, standby의 데이터(애플리케이션 파일, 설정, DB 덤프 등)가 active와 최신 상태로 유지돼야 한다. 현재 Nemesis에는 노드 간 파일 복제 기능이 없다. 본 기능은 클러스터 설정에 "폴더 동기화"를 추가해, 지정한 디렉토리를 active에서 standby로 주기적/수동/실시간 복제한다.

## 2. 확정된 설계 결정

| 항목 | 결정 |
|---|---|
| 트리거 | 주기 스케줄 + 수동 버튼 (Phase 1) / 실시간 inotify (Phase 2) |
| 방향 | active → standby 단방향 (active는 매 실행 시 동적 식별) |
| 전송/인증 | SSH + 자동 키 프로비저닝 |
| **데이터 경로** | **rsync는 무조건 대상 노드의 heartbeat IP 경유** (제어 명령채널 17001은 serviceIp 사용, 파일 전송만 heartbeat IP) |
| 폴더 선택 | 파일시스템 브라우저(control.sh dir-list) |
| mirror(--delete) | 기본 OFF, 작업별 명시 토글 |
| source/dest 경로 | 기본 동일 경로(dest 미지정 시 source와 동일) |

## 3. 데이터 모델 (Flyway 신규 마이그레이션 — 다음 가용 V 번호)

### `sync_jobs` — 클러스터별 동기화 설정(1행=1폴더쌍)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| cluster_group_id | uuid FK | 소속 클러스터 |
| name | varchar | 작업 이름 |
| source_path | text | 소스 절대경로(active 기준) |
| dest_path | text | 대상 절대경로(기본 = source_path) |
| mirror_delete | boolean default false | rsync --delete 여부 |
| excludes | text nullable | 제외 패턴(개행/콤마 구분) |
| schedule_sec | int default 0 | 0=수동전용, >0=주기(초) |
| enabled | boolean default true | |
| created_at, updated_at | timestamptz | |

### `sync_history` — 실행 이력
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigserial PK | |
| sync_job_id | uuid FK | |
| trigger_type | varchar | SCHEDULED \| MANUAL \| REALTIME |
| status | varchar | SUCCESS \| FAILED \| SKIPPED |
| from_node_id | uuid | active |
| to_node_id | uuid | standby(대상) |
| bytes_transferred | bigint | rsync --stats 파싱 |
| files_count | int | rsync --stats 파싱 |
| duration_ms | bigint | |
| message | text | 실패 사유/요약 |
| created_at | timestamptz | |

## 4. 에이전트 / control.sh 신규 서브커맨드

control.sh는 이미 화이트리스트 진입점이므로 **에이전트(nemesis-agent.py) 화이트리스트 수정 불필요**. 서브커맨드만 추가한다.

- `dir-list <path>` — 읽기전용. 해당 경로의 하위 디렉토리 목록을 TSV(name\ttype) 반환. 경로 미존재=종료코드 2, 권한오류=3. 브라우저 모달용.
- `dir-sync <destHeartbeatIp> <srcPath> <destPath> [--delete] [--exclude=PATTERN ...]`
  - active에서 실행. `rsync -az --stats -e "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10" <srcPath>/ nemesis@<destHeartbeatIp>:<destPath>/`
  - `--stats` 출력에서 transferred bytes / files 파싱해 JSON 반환(stdout). 비0 종료=실패.
- `ssh-keygen-nemesis` — `~nemesis/.ssh/id_ed25519` 없으면 생성(`ssh-keygen -t ed25519 -N ""`), **공개키 stdout 반환**. 멱등.
- `ssh-authorize <pubkey>` — 받은 peer 공개키를 `~nemesis/.ssh/authorized_keys`에 멱등 추가(중복 방지).

> 전제: 각 노드에 rsync 전용 계정 `nemesis`(또는 기존 에이전트 실행 계정)와 SSH 서버가 있어야 한다. 설치 스크립트(install.sh)에서 계정/디렉토리 보장은 구현 시 확정.

## 5. SSH 키 자동 프로비저닝

관리서버가 17001 명령채널(serviceIp)로 오케스트레이션:
1. 클러스터의 각 노드에 `ssh-keygen-nemesis` 전송 → 공개키 수집
2. 각 노드에 다른 모든 peer의 공개키를 `ssh-authorize`로 배포
3. 결과를 응답(성공/실패 노드 목록)

UI: 클러스터 설정에 **"SSH 신뢰 구성" 버튼**. 노드 추가 후 재실행 권장.
known_hosts는 rsync 시 `StrictHostKeyChecking=accept-new`로 heartbeat IP 기준 자동 등록.

## 6. 백엔드 (`domain/sync` 패키지 — config 백업/복구 패턴 미러링)

- `SyncJob` 엔티티 + `SyncJobRepository` + `SyncHistory` 엔티티 + Repository
- `SyncJobController` — `/api/clusters/{id}/sync/jobs` CRUD, `/api/clusters/{id}/sync/jobs/{jobId}/run`(수동 실행), `/api/clusters/{id}/sync/history`
- `SyncService` — 핵심 로직:
  1. active 노드 동적 식별(role=active)
  2. 클러스터의 standby 목록 순회
  3. 각 standby의 `heartbeat_ip` 검증 — 비어있으면 `SKIPPED("heartbeat IP 미설정")` 기록 후 건너뜀
  4. `AgentCommandClient.execute(active, "control.sh dir-sync <standby.heartbeatIp> <src> <dst> [--delete] ...")`
  5. `--stats` 파싱 → `sync_history` 적재(SUCCESS/FAILED + bytes/files/duration)
  6. in-flight 락으로 동일 작업 중복 실행 방지
- `SyncScheduler` (`@Scheduled(fixedDelay=...)`) — enabled && schedule_sec>0 작업을 주기 도래 시 실행
- `DirBrowseController` — `GET /api/clusters/{id}/nodes/{nodeId}/dirs?path=` → `dir-list` 프록시(읽기전용)
- `SshProvisionController` — `POST /api/clusters/{id}/sync/provision-ssh`
- RBAC: 작업 생성/수정/삭제·수동실행·SSH 프로비저닝 = operator+ (기존 `RbacFilter` 패턴)

## 7. 프론트엔드 (ClusterSettings.jsx에 `DirSyncPanel` 추가)

- 동기화 작업 목록: 소스→대상, 주기, mirror 여부, 마지막 실행 결과 배지(성공/실패/시각)
- "+ 작업 추가" 모달:
  - **폴더 브라우저**: 노드 선택 → dir-list 트리 탐색 → 경로 선택
  - 주기(초/분, 0=수동전용), mirror(--delete) 토글 + 경고문, 제외 패턴 입력
- 작업별 "지금 동기화" 버튼(operator+ gate), 실행 결과·이력 표시
- 상단 "SSH 신뢰 구성" 버튼(operator+)
- 기존 client.js api 헬퍼 + axios 인터셉터(Bearer) 재사용

## 8. 동기화 실행 흐름

```
[스케줄러 도래 | 수동버튼] → SyncService.run(job)
  → active 노드 식별(role=active)
  → for each standby:
       heartbeat_ip 없음 → SKIPPED 기록, continue
       AgentCommandClient.execute(active,
         "control.sh dir-sync <standby.heartbeat_ip> <src> <dst> [--delete] [--exclude=...]")
       → active가 rsync over SSH(heartbeat IP)로 standby에 전송
       → --stats 파싱 → SUCCESS/FAILED + bytes/files/duration
  → sync_history 적재
```
페일오버로 active가 바뀌면 다음 실행에서 **새 active 기준**으로 방향 자동 전환(active를 매번 동적 식별하므로 별도 처리 불필요).

## 9. 에러 처리 / 안전장치

- standby 미도달·SSH 실패·rsync 비0 종료 → 해당 standby만 `FAILED`, **다른 standby/다음 주기에 영향 없음**(HA 독립성)
- `heartbeat_ip` 미설정 노드 → `SKIPPED` + UI 경고(데이터 경로 강제 규칙)
- `--delete`(mirror) 기본 OFF, 켜면 "standby에서 소스에 없는 파일 삭제됨" UI 경고
- 동일 작업 in-flight 락(중복 실행 방지)
- 모든 명령은 control.sh 화이트리스트 내 → 임의 명령 실행 불가, 인자 인젝션 방지(에이전트 기존 shlex 처리 + control.sh 인자 검증)

## 10. 단계 (phasing)

- **Phase 1 (본 스펙 범위)**: 스키마 + control.sh(dir-list/dir-sync/ssh-*) + 백엔드 sync 패키지 + SSH 프로비저닝 + 주기 스케줄러 + 수동버튼 + 폴더 브라우저 UI + 이력
- **Phase 2 (후속)**: 실시간(inotify watch 데몬 + 디바운스 + 부하제어). Phase 1 안정화 후 별도 스펙.

## 11. 테스트

- 단위(backend gradle): SyncService(active 식별, 명령 문자열 조립, heartbeat IP 가드, 이력 적재), rsync --stats 파싱
- 셸: control.sh 신규 서브커맨드 `sh -n` + 인자 검증
- e2e: **bot-02 standby 컨테이너(이미 가동 중)** 활용 — 실제 rsync over SSH(heartbeat IP)로 테스트 폴더가 bot→bot-02 복제되는지 실측. SSH 프로비저닝→작업 생성→수동 실행→sync_history SUCCESS + 대상에 파일 도착 확인.

## 12. 범위 외 (YAGNI)

- 양방향 동기화 / 충돌 해결
- 실시간 동기화(Phase 2)
- 폴더가 아닌 블록/DB 레플리케이션(별도 영역)
- 동기화 대역폭 제한(필요 시 후속 rsync --bwlimit)
