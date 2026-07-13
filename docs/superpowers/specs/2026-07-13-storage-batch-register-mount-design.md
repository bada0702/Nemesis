# 공유 스토리지 등록 UX 개편 — 양쪽 노드 스캔 비교 + 체크박스 일괄 등록(mount 포함)

날짜: 2026-07-13
관련: [2026-07-07-nemesis-share-shared-storage-design.md](2026-07-07-nemesis-share-shared-storage-design.md)(원 설계, S0/S1 범위)

## 배경

기존 `/storage` 화면은 "노드 하나 선택 → FC 스캔 → 발견된 디스크마다 개별 등록 폼"이었다.
등록은 WWID/라벨/크기/경로수 메타데이터만 DB에 저장할 뿐, 실제 마운트는 원 설계 문서의
S2(HA 통합) 단계로 미뤄져 있었다.

이번 변경은 두 가지를 동시에 한다:
1. 스캔 화면을 이중화 노드(active/standby) 양쪽에서 동시에 스캔해 좌우로 비교하고,
   체크박스로 여러 디스크를 선택해 한 번에 등록하는 방식으로 바꾼다.
2. 등록 시 실제로 LVM 생성 + `mkfs` + `mount`까지 수행한다(원래 S2로 미뤘던 실행 단계를
   이번에 앞당김). Mount는 **active 노드에만** 실행한다 — ext4/xfs는 클러스터 파일시스템이
   아니므로 이중 마운트는 즉시 데이터 파손으로 이어진다([[2026-07-07 설계 문서]] §5 위험 경고 참조).

파티션 관리(LUN을 여러 조각으로 나누는 기능)는 이번에도 v1 제외를 유지한다 — 스캔된 LUN
전체를 LVM PV 하나로 써서 LV 1개(`-l 100%FREE`)를 만든다.

## 확정 결정

| 항목 | 결정 |
|---|---|
| mkfs/mount 실행 시점 | 등록 시 즉시 실행(메타데이터만 저장하는 방식 아님) |
| mount 대상 | active 노드에만. standby는 손대지 않음(이중 마운트 방지) |
| 파티션 분할 | 없음 — LUN 전체 = LV 1개 (원 결정 유지) |
| fstype | 화면에서 ext4/xfs 중 선택 |
| 마운트 경로 | 고정 베이스(`/nemesis/share/`) + 사용자 입력 디렉토리명 |
| 다중 선택 시 입력 | 디스크마다 개별로 디렉토리명·fstype 입력(공통값 아님) |
| 등록 가능 조건 | 양쪽 노드에서 동시에 보이는 WWID만 선택 가능(편측만 보이면 경고, 비활성화) |
| 노드가 1개뿐인 클러스터 | 좌우 비교 불가 → 단일 컬럼 폴백, 그 노드에서 보이면 바로 선택 가능 |
| 수동 등록(WWID 직접 입력) | 스캔 등록과 동일하게 mount까지 실행(활성 노드 선택 필수로 변경) |
| 실패 시 롤백 | 없음 — `fs-create`는 멱등이라 재시도로 이어서 진행(vip-up과 동일 원칙) |

## 화면 흐름

```
[클러스터 카드]
  "FC 스캔" 버튼 1개 (기존 노드 선택 드롭다운 제거)
        │
        ▼  active/standby 양쪽 노드에 동시 scan 요청(Promise.all, 기존 /scan API 재사용)
  ┌─────────────────────────┬─────────────────────────┐
  │ active (예: bot)         │ standby (예: albot-02)   │
  │ ☐ wwid1  200G  2경로     │ ☐ wwid1  200G  2경로     │  ← 같은 wwid는 같은 행에 정렬
  │ ☐ wwid2  100G  1경로     │ ☐ wwid2  100G  1경로     │
  │ ⚠ wwid3  50G  (편측만)  │ —                        │  ← 선택 불가, 경고 표시
  └─────────────────────────┴─────────────────────────┘
        │ 체크박스 선택(양쪽에 다 보이는 wwid만 활성화)
        ▼
  선택된 디스크마다 입력 행:
  [wwid1] 디렉토리명 [____] fstype [ext4 ▾]  (용량 200G 표시)
  [wwid2] 디렉토리명 [____] fstype [ext4 ▾]  (용량 100G 표시)
        │
        ▼ "일괄 등록" — 디스크마다 순차 처리, 항목별 성공/실패 표시
  ✅ wwid1 → /nemesis/share/app1 등록 완료
  ❌ wwid2 → mkfs 실패: ...
```

이미 등록된 WWID(`alreadyRegistered`)는 기존과 동일하게 체크박스가 비활성화된다.

## 백엔드 변경

### agent/storage.sh (신규 서브커맨드)

기존 `scan-fc`/`disk-list`(S0, 읽기 전용)는 그대로 둔다. 아래를 추가한다.

```
fs-create <wwid> <fstype> <mountpoint>
```

동작(멱등, `control.sh vip-up`과 동일한 원칙 — 이미 끝난 단계는 건너뛰고 이어서 진행):
1. wwid로 현재 디바이스 경로를 다시 조회한다(재스캔 이후 디바이스명이 바뀔 수 있어
   이름이 아니라 wwid로 재확인).
2. 이미 마운트돼 있으면 그대로 성공 반환.
3. `pvcreate` → `vgcreate` → `lvcreate -l 100%FREE` → `mkfs.<fstype>` →
   `mkdir -p <mountpoint>` → `mount`.
4. VG/LV 이름은 별도 컬럼 없이 mountpoint 마지막 세그먼트에서 규칙적으로 파생한다
   (`vg_<seg>` / `lv_<seg>`).

새 서브커맨드 자체는 이미 화이트리스트에 있는 `storage.sh` 안에 추가하는 것이라
`nemesis-agent.py`의 `ALLOWED_SCRIPTS`는 안 건드리지만, 스크립트 내용이 바뀌므로
**에이전트 재배포가 필요**하다.

### DB 마이그레이션 (V23)

`storage_devices`에 컬럼 추가:
- `mount_path` varchar
- `fstype` varchar

### StorageController / StorageService

- 기존 `POST /scan?nodeId=`는 변경 없음 — 프론트가 active/standby 각각에 호출해서
  화면에서 합친다.
- 신규 `POST /devices/batch`:
  - 요청: `[{wwid, dirName, fstype, activeNodeId}, ...]`
  - 항목별 순차 처리(하나 실패해도 나머지는 계속 진행). 각 항목마다:
    1. `dirName` 검증: `^[a-z0-9][a-z0-9_-]{0,62}$`
    2. `fstype` 검증: `ext4|xfs`만 허용
    3. `wwid` 검증: 기존 `WWID_PATTERN` 재사용
    4. `mountPath`(`/nemesis/share/<dirName>`) 중복 검증: 같은 클러스터 안에 이미 등록된
       디바이스의 `mountPath`와 겹치면 거부(서로 다른 wwid가 같은 경로에 mount되는 사고 방지)
    5. activeNodeId에 `storage.sh fs-create <wwid> <fstype> /nemesis/share/<dirName>` 실행
    6. 성공 시 `StorageDevice` 저장(`mountPath`, `fstype` 포함), 실패 시 해당 항목만 에러 기록
  - 응답: 항목별 성공/실패 배열
- 기존 단건 `POST /devices`(수동 등록)도 동일하게 `fs-create`를 태우도록 바꾼다
  (활성 노드 선택 필수로 변경).

## 프론트엔드 변경 (`frontend/src/pages/storage/Storage.jsx`)

- 노드 선택 드롭다운 제거, "FC 스캔" 버튼 하나로 양쪽 노드 동시 스캔.
- 스캔 결과를 wwid 기준으로 좌우 정렬해 테이블 형태로 표시, 편측에만 있는 wwid는
  경고 아이콘 + 선택 비활성.
- 체크박스 선택 시 선택된 디스크 수만큼 입력 행(디렉토리명 입력창 + fstype 드롭다운)이 생성.
- "일괄 등록" 클릭 시 `/devices/batch` 호출, 응답의 항목별 결과를 인라인으로 표시.
- 노드가 1개뿐인 클러스터는 좌우 비교 없이 단일 컬럼으로 폴백.

## 테스트 계획

- `StorageServiceTest`: `dirName`/`fstype` 검증 유닛테스트, 배치 부분 실패 처리
  (`AgentCommandClient`는 Mockito 스텁).
- `StorageControllerRbacTest`: 신규 `/devices/batch`도 OPERATOR 이상만 허용하는지 확인
  (기존 패턴 재사용).
- `agent/storage.sh fs-create`: 자동화 유닛테스트 없음(쉘 스크립트, `control.sh`와 동일) —
  개발 검증은 원 설계 문서 결정대로 bot/albot-02 컨테이너에 host loop device를 공유시켜
  실제 FC 없이 재현하고, 실행 후 `mount`/`lsblk`로 직접 확인.
- 프론트: snap chromium 기반 수동 e2e로 좌우 스캔·체크박스·배치 등록 흐름 확인.

## 범위 밖 (이번에 안 하는 것)

- 파티션 분할(LUN을 여러 LV로 나누기) — 여전히 v1 제외.
- Standby RO 마운트 — 여전히 v1 제외.
- `MountReconciler`, 페일오버 체인에 umount/mount 단계 통합, `storage-lost` 감지 트리거 —
  원 설계 문서의 S2/S3 범위 그대로 남겨둠(이번 변경은 "최초 등록 시 mount"까지만 다루고,
  페일오버 시 자동 마운트 인수는 별도 작업).
