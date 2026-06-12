# 서비스 카탈로그 + HA 지정 — 설계

날짜: 2026-06-12
상태: 승인됨 (사용자 확인)

## 배경

Nemesis 차세대 HA 비전(클러스터 생성 → 노드 등록 → 서비스 자동 스캔 → HA 정책 → AI 장애 판단)에서
끊겨 있는 "서비스 중심" 운영 흐름의 토대. 현재는 SW/DB/Docker 스캔이 각각 노드 단위로 흩어져 있고,
서비스별 HA 대상 지정·기동 순서·AI 권고가 붙을 데이터 모델이 없다.

## 결정 사항 (사용자 선택)

1. **서비스 단위 = 클러스터 논리 서비스.** "Oracle DB"는 클러스터에 1개 등록되고
   각 노드의 설치 인스턴스가 자동 연결된다.
2. **스캔 흐름 = 스캔 → 검토 → 일괄 등록.** 전체 노드 스캔 후 같은 서비스는 자동 병합해
   제안하고, 관리자가 체크해 등록한다.
3. **기존 페이지 통합.** 전체 서비스 = 카탈로그 메인. DB/Application 메뉴는 타입 필터 뷰.
   기존 Db.jsx/Sw.jsx는 제거, sw_process 데이터는 마이그레이션.

## 데이터 모델

```sql
managed_services (
    id               UUID PK DEFAULT uuid_generate_v4(),
    cluster_group_id UUID NOT NULL FK→cluster_groups ON DELETE CASCADE,
    name             VARCHAR(200) NOT NULL,   -- 프로세스 매칭 패턴 (예: mysqld, ora_pmon)
    display_name     VARCHAR(200) NOT NULL,   -- 표시명 (예: MySQL, Oracle DB)
    type             VARCHAR(20)  NOT NULL,   -- WEB / WAS / DB / SW / CONTAINER
    ha_managed       BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (cluster_group_id, name)
)
```

- 노드별 인스턴스 상태는 **저장하지 않는다**. 조회 시 MetricsCacheService의 프로세스
  목록과 `name` 패턴을 매칭해 노드별 RUNNING/STOPPED·PID를 실시간 계산
  (기존 SwScanService/DbScanController와 동일 메커니즘 — 동기화 불일치 원천 차단).
- Flyway V9: 테이블 생성 + 기존 `sw_process` → (cluster_id, name) 그룹핑 이관
  (타입은 SQL CASE로 추론, 매핑 불가 시 'SW').

## API (`/api/clusters/{id}/services`)

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET    | `/`        | 카탈로그 + 노드별 실시간 인스턴스 상태 |
| POST   | `/scan`    | 전체 노드 스캔 → displayName 기준 병합 제안 (`proposals`/`unknown`, 등록 여부 표시) |
| POST   | `/`        | 일괄 등록 `{items:[{name,displayName,type,haManaged}]}` (중복은 skip) |
| PUT    | `/{sid}`   | displayName / type / haManaged 수정 |
| DELETE | `/{sid}`   | 삭제 |

GET 응답 항목: `{id, name, displayName, type, haManaged,
instances:[{nodeId, hostname, state, pid}], runningCount, nodeCount}`

알려진 SW 카탈로그(패턴→표시명·타입): 기존 SwScanService.KNOWN_SW + DbScanController.KNOWN_DB
통합. WEB(nginx/httpd), WAS(tomcat/weblogic/jboss), DB(oracle/mysql/postgres/...),
SW(kafka/zookeeper/haproxy/keepalived/...).

## 프론트엔드

- `pages/ServiceCatalog.jsx`: 클러스터 선택 → 서비스 목록(타입 배지, 노드별 ● 상태,
  HA ★ 토글, PID) + "자동 스캔"(검토 모달 → 일괄 등록) + 수동 추가.
- 라우트: `/services`(전체) — `?type=DB` 등 쿼리 파라미터로 필터 프리셋.
  사이드바: DB → `/services?type=DB`, Application → `/services?type=APP`(WEB+WAS+SW).
- 기존 `Db.jsx`/`Sw.jsx`/`Services.jsx` 제거. 컨테이너 메뉴는 현행 유지
  (명령 채널 기반, CONTAINER 타입은 v1 수동 등록만).

## 범위 제외 (후속)

- 노드×서비스 매트릭스 대시보드
- AI 권고 승인 워크플로 (ha_managed 서비스가 분석 대상)
- 기동 순서 편집기 (ha_managed 서비스가 순서 항목)
- 클러스터 운영 정책(Active-Active) 필드
- 서비스 기동/중지 제어 버튼(에이전트 svc-* 연동)

## 검증 기준

- `gradle test` 통과 (신규 ServiceCatalogService 단위테스트 포함)
- `vite build` 통과
- 브라우저: 스캔 → 검토 모달 → 등록 → 카탈로그 표시 → HA 토글 → 새로고침 후 유지
