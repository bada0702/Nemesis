# Nemesis 컨트롤 플레인 이중화 계획 (Docker Swarm)

작성일: 2026-06-22
대상: **Nemesis 관제 서버 자신**의 고가용성 (관리대상 클러스터 HA가 아님 — 그건 `Nemesis_HA_Gap_Analysis_and_Plan.md`)
상태: **설계 초안 / 미착수** (호스트 대수 확정 대기)

---

## 1. 문제 정의
현재 배포는 **단일 호스트**에 컨테이너 4개(`nemesis-server`, `nemesis-frontend`, `postgres`, `bot-02`)가 떠 있다.
- 한 서버에 컨테이너를 2개로 늘려도 **이중화가 아니다.** 호스트(커널 패닉/전원/NIC/디스크)가 단일 장애점(SPOF).
- 메인 호스트가 죽으면 관제 기능 전체가 정지 → 정작 장애 대응 도구가 장애에 취약.

목표: 호스트 1대 장애를 견디는 컨트롤 플레인 이중화.

---

## 2. 핵심 결정 포인트 (미확정 — 여기서 갈림)
**확보 가능한 호스트 대수**가 방향을 가른다:
- **3대 이상 가능 → Docker Swarm** (이 문서)
- **2대뿐 → 제품 방식 active/standby + VIP** (더 단순, 별도 검토)

> Swarm 매니저는 홀수여야 하며, 1대 장애를 견디려면 **매니저 3대(쿼럼)** 필요. 매니저 2대는 1대보다 나쁨(쿼럼 깨지면 클러스터 freeze).

---

## 3. Swarm이 해결하는 것 (stateless)
`nemesis-server`, `frontend`는 무상태 → Swarm이 거의 자동 처리:
- `deploy.replicas: 2` + `max_replicas_per_node: 1` → 노드 죽으면 타 노드 자동 재스케줄
- Routing mesh: 어느 노드로 들어와도 살아있는 replica로 분산 (내장 VIP/LB)
- 헬스체크, 롤링 업데이트, overlay 네트워크 내장

예시:
```yaml
services:
  backend:
    image: registry/nemesis-backend:<tag>
    deploy:
      replicas: 2
      placement: { max_replicas_per_node: 1 }
      restart_policy: { condition: any }
      update_config: { order: start-first }
    healthcheck:
      test: ["CMD","curl","-f","http://localhost:8080/actuator/health"]
```

---

## 4. Swarm이 해결하지 **못**하는 것 — 함정
### 함정 1: Postgres (상태) ★ 작업량의 대부분
Swarm은 postgres 컨테이너를 타 노드로 재스케줄하지만 **데이터 볼륨은 노드 로컬 디스크**. 노드가 죽으면 데이터도 소실. `replicas: 2`는 split-brain.

선택지:
| 방법 | 내용 | 트레이드오프 |
|------|------|------------|
| **Postgres를 Swarm 밖 + Patroni/repmgr** (권장) | 전용 호스트 2~3대 스트리밍 복제, 앱만 Swarm | 가장 견고, 별도 운영 |
| 한 노드 pin(constraint) + replica 별도 | `node.labels.db==primary` 제약 | 그 노드 죽으면 승격 필요 |
| 공유 스토리지(NFS/Ceph) 볼륨 | 볼륨만 떠다님 | DB IO 지연·잠금 → **비권장** |

### 함정 2: 이미지 레지스트리
현재 이미지를 호스트에서 로컬 빌드 → Swarm은 여러 노드가 같은 이미지를 pull 해야 하므로 **사설 레지스트리(또는 외부) 필수**. 없으면 신규 노드에서 이미지 못 찾음.

### 함정 3: 단일 진입점
Routing mesh는 노드 간 VIP일 뿐. 외부 접속용 단일 IP(`:18090`)는 매니저 앞단에 **keepalived VIP 또는 외부 LB** 별도 필요.

---

## 5. 목표 토폴로지 (Swarm 채택 시)
```
keepalived VIP (외부 단일 접속 IP :18090)
        │
 ┌──────┴──────┬─────────────┐
 node1(mgr)   node2(mgr)   node3(mgr)     ← Swarm 쿼럼 3대
 backend×2, frontend×2 (routing mesh 자동 분산/재스케줄)
        │
 ┌──────┴──────┐
 db-host A ──streaming replication──→ db-host B   ← Postgres는 Swarm 밖, Patroni
```

---

## 6. 단계 (착수 시)
1. **호스트 대수 확정** (3대 가능 여부) — 이게 안 되면 Swarm 보류, active/standby로 전환.
2. 사설 레지스트리 구축 + 백엔드/프론트 이미지 푸시 파이프라인.
3. Swarm init + 매니저 3대 조인, overlay 네트워크.
4. backend/frontend 스택 배포(replicas, healthcheck, rolling update).
5. Postgres 복제·failover(Patroni) 별도 구성 + 백엔드 접속 문자열을 복제-aware로.
6. keepalived VIP로 외부 단일 진입점 구성.
7. 노드 강제 다운 시나리오로 failover 검증(앱 재스케줄 + DB 승격 RPO/RTO 측정).

---

## 7. 솔직한 평가
- Swarm의 강점은 stateless 재스케줄·롤링업데이트. **Nemesis HA의 진짜 난이도는 Postgres 상태**이며 Swarm은 이를 풀어주지 않는다.
- 실제 작업량 ≈ Postgres 복제+failover 설계 + 레지스트리 + VIP > Swarm 세팅 자체.
- 노드 3대가 어려우면 **제품 방식(active/standby 2대 + VIP)이 더 단순·빠름.**

## 8. 다음 액션
- [ ] 확보 가능 호스트 대수 확정 (의사결정 게이트)
- [ ] 확정 후 `/plan-eng-review`로 정식 설계 (Patroni vs 수동 승격, RPO 허용범위, VIP 충돌, 복제 지연 처리)
