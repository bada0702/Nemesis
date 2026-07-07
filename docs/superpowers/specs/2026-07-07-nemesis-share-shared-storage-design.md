# Nemesis Share — 공유 스토리지 관리 설계

- 날짜: 2026-07-07
- 상태: 설계 확정 대기(사용자 스펙 리뷰 전)
- 근거 문서: Nemesis Share PRD (Active-Standby 공유 스토리지)
- 관련 코드: `domain/failover/FailoverOrchestrator.java`, `domain/failover/FenceService.java`,
  `domain/cluster/VipReconciler.java`, `domain/sync/`(아키텍처 선례), `agent/control.sh`, `agent/nemesis-agent.py`

## 1. 개요

Active-Standby HA 클러스터를 위한 SAN 공유 스토리지 관리 기능.
GUI(마법사)로 FC LUN 스캔 → 볼륨/파일시스템 생성 → 클러스터 연결 → 마운트 정책까지 구성하고,
장애 시 페일오버 체인에 스토리지 인수(umount/mount) 단계를 통합한다.

PRD 요구 중 VIP 관리(6.8), 페일오버 골격(6.9), 하트비트/모니터링(6.10), Active/Standby 구성(6.6),
펜싱(PRD 외)은 기존 구현을 재사용한다. 신규 개발은 스토리지 계층(6.1~6.5, 6.7)과
페일오버 체인 통합, 마법사 UI, 대시보드다.

## 2. 스코프 결정 사항

| 항목 | 결정 | 비고 |
|---|---|---|
| 전송 방식 | **FC(SAN) 전용. iSCSI 제외** | 사용자 확정(2026-07-07) |
| AIX | **코드 경로(OS 분기)만 구현, 테스트 보류** | 장비는 있으나 이번 릴리스에서 검증 안 함. 사용자 확정 |
| 파티션 관리 | **v1 제외 — LUN 전체를 LVM PV로 사용** | SAN LUN 표준 관행(리사이즈 단순·정렬 문제 없음). *가정 채택 — 리뷰 시 번복 가능* |
| Standby RO 마운트(PRD 6.7 선택 기능) | **v1 제외** | ext4 RO 마운트도 저널 리플레이 발생 가능 → 파손 위험. *가정 채택 — 리뷰 시 번복 가능* |
| 파일시스템 | Linux: ext4, XFS / AIX: JFS2(코드만) | |
| GPFS·Active-Active·DLM | 제외 | PRD Excluded 준수. 기존 gpfs-* 명령은 레거시로 유지 |
| 스냅샷/복제/온라인 리사이즈 | 제외(PRD v2.0) | v1 운영 가이드에 "백업은 외부 수단 병행" 명기 |

## 3. 아키텍처

기존 실행 경로를 그대로 사용한다:
**관리서버(Spring) → 에이전트 명령 채널(:17001, Bearer 키) → 화이트리스트 스크립트**.

```
[GUI 마법사/대시보드]
        │ REST
[backend domain/storage/]──(비동기 StorageJob)──[AgentCommandClient :17001]
        │                                              │
   PostgreSQL(V22)                          [agent storage.sh (신규)]
                                             ├ 조회: scan-fc, disk-list, fs-status
                                             └ 변경: vg/lv, mkfs, fs-mount/umount
```

### 3.1 에이전트 — `agent/storage.sh` (신규 스크립트)

`control.sh`(395줄)에 얹지 않고 별도 스크립트로 분리, `nemesis-agent.py`의
`ALLOWED_SCRIPTS` 화이트리스트에 1건 추가한다. POSIX sh + `uname` OS 분기(control.sh와 동일 구조).
**에이전트 재배포 필요**(dir-sync 때와 동일한 제약).

읽기 전용(조회):
- `scan-fc` — `/sys/class/scsi_host/*/scan` rescan + `lsscsi`. AIX: `cfgmgr` + `lsdev`
- `disk-list` — `lsblk`/`multipath -ll` 기반 LUN 목록(WWID·크기·경로 수). AIX: `lspv`
- `fs-status` — Nemesis 관리 FS의 마운트 여부·사용량(df)·multipath 경로 상태

변경(파괴 가능 — 서버 측 검증 통과분만 도달):
- `pv-create <dev>` / `vg-create <vg> <dev>` / `lv-create <vg> <lv> <size>`
- `vg-activate <vg>` / `vg-deactivate <vg>` — 페일오버 인수/해제 시 사용(`vgchange -ay/-an`)
- `mkfs <ext4|xfs> <dev>` — AIX: `crfs`(JFS2)
- `fs-mount <dev|vg/lv> <mountpoint>` / `fs-umount <mountpoint>` — 멱등(vip-up과 동일 원칙)
- `fs-check <dev>` — **읽기 전용 진단만**(`xfs_repair -n` / `fsck -n`). 실제 repair 서브커맨드는 두되
  승인 게이트 통과 시에만 서버가 호출

원칙:
- multipath 디바이스(`/dev/mapper/<wwid>`)를 1급 시민으로 취급
- **fstab 등록 금지(noauto 원칙)** — OS 부팅이 임의로 마운트하지 못하게 한다(§6 복구 설계의 전제)

### 3.2 백엔드 — `domain/storage/` (신규 도메인, dir-sync 골격 준용)

엔티티 (Flyway `V22__shared_storage.sql`):
- `StorageDevice` — 발견/등록된 LUN. **WWID로 식별**(경로 `/dev/sdX`는 저장하지 않고 조회 시 해석).
  노드별 가시성, 크기, multipath 경로 수, 상태
- `StorageVolume` — VG/LV 구성(디바이스 FK, vg명, lv명, 크기)
- `SharedFilesystem` — fstype, mountpoint, cluster FK, 상태(마운트 위치·건강)
- `StorageJob` — 비동기 작업(mkfs 등 장시간 작업) 큐·이력. SyncJob/SyncHistory 패턴 준용

서비스/컨트롤러:
- `StorageController` — 스캔 트리거, 인벤토리 CRUD, 마법사 단계 API, 잡 상태 폴링
- `StorageService` — 오케스트레이션. **서버 측 인자 검증 필수**: 에이전트 화이트리스트는
  첫 토큰만 검사하므로 디바이스 경로 정규식(`/dev/mapper/...` 등)·fstype enum·마운트포인트
  검증을 여기서 강제(에이전트는 root 실행)
- 수동 등록 경로: 스캔 없이 디바이스 경로/WWID 직접 지정 가능(FC 장비 없는 개발 환경용)
- `MountReconciler` — §6 참조 (VipReconciler 판박이)

파괴적 작업(mkfs, lv 삭제 등)은 확인 게이트 + RBAC 제한 + "등록된 디스크만 조작" 원칙.

### 3.3 페일오버/페일백 통합

`FailoverOrchestrator` 체인 확장 — 클러스터에 `SharedFilesystem`이 연결된 경우:

```
페일오버: fence(우회 불가) → 구 active umount(best-effort)
          → 신 노드 vgchange -ay + mount → VIP 인수 → role 커밋 → svc 시작
페일백:   현 active svc-stop → umount(확인 필수 — best-effort 아님)
          → 복구 노드 mount → VIP → svc-start
```

- 스토리지 연결 클러스터에서는 `fence_method=none` **금지**(설정 저장 시 검증)
- mount 실패 분기: 저널 리플레이는 mount가 자동 수행. mount 실패 시 `fs-check`(읽기 전용 진단)
  자동 실행 → 결과 첨부 알람 → **repair는 AIOps 승인 게이트** 통과 시에만 실행(데이터 파괴 가능)
- `HaSequenceExecutor`에 `MOUNT`/`UMOUNT` action 추가(STARTUP/SHUTDOWN 절차에서 사용)
- 실패 시 롤백은 기존 패턴(승격 노드 standby 복귀) 준용

### 3.4 프론트엔드

- Sidebar '클러스터' 그룹에 **'공유 스토리지'** 항목 추가(`components/Sidebar.jsx`)
- 페이지 ①: 현황 대시보드 — 디바이스/FS 목록, 마운트 위치, 사용량, multipath 상태, 잡 이력
- 페이지 ②: 마법사 — `Storage(스캔/수동등록) → Disk(등록) → Volume(VG/LV) →
  Filesystem(fstype/mountpoint) → Cluster(연결·마운트 정책) → Finish(요약·실행)`
  (PRD 7장에서 Partition 단계 생략, VIP 단계는 기존 클러스터 VIP 재사용이므로 생략)
- 각 변경 단계는 StorageJob 폴링으로 진행 상태 표시, 파괴적 단계는 확인 다이얼로그

## 4. 데이터 무결성 — 핵심 리스크

ext4/XFS는 클러스터 파일시스템이 아니다. **이중 마운트 = 즉시 파손.** 방어선:

1. fence 게이트 우회 불가(ssh-soft + witness: 도달 불가 + 메트릭 신선 → 인수 중단)
2. fstab 미등록 — 부팅이 임의 마운트 불가
3. MountReconciler — standby 마운트 드리프트 자동 해제 + 알람
4. 페일백 시 umount 확인 필수 후 mount
5. (S4) SCSI-3 Persistent Reservation(`sg_persist`) 디스크 수준 펜싱 — 근본 해결, 하드닝 단계

## 5. 장애 시나리오별 동작

| 시나리오 | 동작 |
|---|---|
| Active 전원단절/커널패닉 | 기존 감지 → 페일오버 체인. 신 노드 mount 시 저널 리플레이 자동. mount 실패 시 진단→승인 게이트 repair |
| Active 프로세스만 다운 | 기존 프로세스다운 페일오버 → umount 정상 수행 가능 |
| FC 경로 장애(링크 다운/전경로 소실) | **신규 감지 트리거 `storage-lost`**: collect.sh에 마운트·multipath 상태 추가 → 감지 엔진이 페일오버 트리거 |
| 네트워크 분리(split-brain) | FenceService witness가 인수 중단(기존) |
| FS 손상(리플레이 실패) | 자동 진단(읽기 전용) → 알람 → 승인 후 repair. 복구 불가 시 한계: 백업은 v2.0 스코프 |

## 6. 노드 파손 → 복구(재참여) 설계

원칙: **마운트 상태는 노드가 스스로 결정하지 않는다 — 항상 관리서버가 선언한다.**

- 에이전트 기동 시 자기 노드의 Nemesis 관리 FS 마운트 현황을 보고 → 서버가 role 대조,
  standby인데 마운트돼 있으면 umount 지시
- `MountReconciler`(주기 감시, VipReconciler 패턴):
  standby에 마운트 존재 → 자동 해제 + 알람 / active에 마운트 부재 → 복원
- 재참여 후 자동 페일백: 기존 페일백 체인에 §3.3 스토리지 단계 삽입
- OS 재설치 수준 파손: 에이전트 재설치 + 노드 재등록 → `vgscan`으로 LVM 메타데이터
  자동 인식(메타데이터는 디스크에 있음) → DB 매핑은 WWID로 자동 재결합.
  **WWID 기반 식별은 S0 스키마부터 반영**(나중에 고치기 어려움)

## 7. 단계 계획 (각각 독립 배포·검증)

| 단계 | 내용 | 검증 |
|---|---|---|
| **S0 조회** | storage.sh 조회 명령 + 화이트리스트 등록, WWID 기반 스키마(V22), 인벤토리 API, 수동 등록 경로, UI 목록 | 파괴 위험 0. 에이전트 재배포 포함 e2e |
| **S1 생성** | LVM+ext4/XFS 마법사, StorageJob 비동기 모델, 확인 게이트, fstab 미등록 원칙 | 공유 loop device로 로컬 검증 |
| **S2 HA 통합** | 클러스터 연결·마운트 정책, 페일오버/페일백 스토리지 단계, MountReconciler, mount 실패 분기(진단/승인 repair), `MOUNT/UMOUNT` HaSequence action | bot 하니스: 강제 파손→페일오버→재참여→페일백 e2e |
| **S3 모니터링** | collect.sh 마운트/사용량/multipath, `storage-lost` 감지 트리거, 대시보드·알람 | 경로 차단 시뮬레이션 |
| **S4 하드닝** | SCSI-3 PR 펜싱, 리사이즈, AIX(JFS2) 검증(장비 확보된 일정에) | AIX 장비 |

## 8. 검증 전략

- 스캔 이후 전체 체인(등록→LVM→mkfs→mount→페일오버)은 전송 방식 무관 —
  **두 bot 노드(동일 호스트 컨테이너)에 같은 host loop device를 노출**해 공유 LUN을 재현
- FC 스캔 경로만 실 HBA 의존 → 장비 확보 시 검증(그 전까지 수동 등록 경로로 대체)
- AIX: OS 분기 코드만 구현, 이번 릴리스에서 테스트하지 않음(사용자 결정)
- 페일오버 e2e는 기존 bot-02 하니스 재사용

## 9. 한계(정직 고지)

- v1에는 스냅샷/백업이 없어 FS 복구 불가 파손의 최후 수단이 없다 → 외부 백업 병행 필수 명기
- ssh-soft 펜싱은 소프트웨어 협조 기반. 디스크 수준 강제 격리는 S4의 SCSI-3 PR 전까지 미완
- AIX 경로는 미검증 상태로 출고됨(코드 리뷰 수준의 보증만)
