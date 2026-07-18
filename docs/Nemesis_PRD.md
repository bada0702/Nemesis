# Nemesis — Product Requirements Document (PRD)
> Version 1.0 | 작성일: 2026-06-06 | 작성자: David Cho

---

## 1. 제품 개요 (Product Overview)

### 1.1 제품명
**Nemesis**
> *Next-generation Enterprise Management for Efficient System Isolation & Self-healing*

### 1.2 한 줄 정의
> 기존 HA 솔루션보다 가볍고, 설치와 운영이 쉬우며, AI가 장애를 조치하고 스스로 복구하는 **차세대 경량 고가용성(HA) 플랫폼**

### 1.3 핵심 가치 제안 (Value Proposition)

| 기존 HA (HACMP / VCS) | Nemesis |
|---|---|
| 커널 레벨 설치, 리부팅 필수 | 애플리케이션 레벨, 리부팅 없음 |
| 장애 감지 후 사람이 복구 | AI가 분석 → 자동 복구 |
| 인프라 레벨(프로세스 생존)만 감지 | 애플리케이션 내부 상태까지 감지 |
| AIX 전용 또는 단일 OS | AIX / Linux 크로스 플랫폼 통합 관제 |
| 고가 라이선스 + 코어별 유지보수 | 오픈 기술 스택 기반 합리적 비용 |
| 별도 모니터링 툴 필요 | 통합 모니터링 대시보드 내장 |

---

## 2. 배경 및 문제 정의 (Background & Problem Statement)

### 2.1 시장 배경
- 금융, 공공, 국방 핵심 시스템은 여전히 **IBM AIX** 기반으로 운영 중
- 현대 인프라는 컨테이너(Docker/Kubernetes) 중심으로 전환되었으나, AIX는 구조적으로 Kubernetes 도입 불가
- 결과적으로 AIX(핵심 업무)와 Linux(주변 업무) 간 **운영 이원화** 발생
- HACMP/VCS 전문 엔지니어 인력은 지속 감소 중

### 2.2 기존 HA의 한계

#### Rule-Based 장애 판단의 맹점
- 하드 장애(프로세스 다운, Ping 단절)만 감지
- **소프트 장애 감지 불가:**
  - 프로세스는 살아있으나 응답 없음 (화이트아웃)
  - 메모리 누수로 인한 성능 저하
  - DB 락 세션 누적
  - WAS 스레드 풀 고갈
  - 아카이브 로그 영역 포화

#### 복구의 한계
- 기존 HA는 Failover(VIP 이동)로 역할 끝
- **장애 난 노드 복구는 100% 사람이 직접 수행**
- 야간/주말 장애 시 대응 공백 발생

#### 운영 복잡성
- HACMP: SMIT 기반 CUI, 설정 변경 시 클러스터 전체 리스크
- VCS: 커널 모듈(LLT/GAB) 설치, OS 패치 시 커널 패닉 가능성
- 모니터링(Prometheus), 시각화(Grafana), HA 제어 도구가 모두 분리

---

## 3. 제품 범위 및 아키텍처 (Scope & Architecture)

### 3.1 지원 환경

| 구분 | 상세 |
|---|---|
| 관리 서버 OS | Linux (RHEL / CentOS / Rocky) |
| 노드 OS | AIX 2대 구성 / Linux 2대 구성 / AIX+Linux 혼합 구성 |
| 클러스터 구성 | Active / Standby (1:1) |
| 클러스터 그룹 수 | 관리 서버 1대당 최대 **10개 클러스터 그룹** 동시 관리 |
| 공유 스토리지 | IBM GPFS (Spectrum Scale) 우선 지원, NFS/SAN 확장 예정 |
| 네트워크 이중화 | VIP (Virtual IP) 기반 서비스 연속성 보장 |

---

### 3.2 멀티 클러스터 그룹 관리 (Multi-Cluster Group Management)

#### 개요

Nemesis 관리 서버 1대로 최대 **10개의 독립 클러스터 그룹**을 동시에 관리한다.
각 클러스터 그룹은 완전히 독립적으로 동작하며, 한 그룹의 Failover가 다른 그룹에 영향을 주지 않는다.

```
Nemesis 관리 서버 (Linux)
│
├── [그룹 01] 민원시스템
│     ├── Node 01 (AIX)   - Active  / VIP: 192.168.1.100
│     └── Node 02 (AIX)   - Standby
│
├── [그룹 02] 인사시스템
│     ├── Node 03 (Linux) - Active  / VIP: 192.168.1.110
│     └── Node 04 (Linux) - Standby
│
├── [그룹 03] 급여시스템
│     ├── Node 05 (AIX)   - Active  / VIP: 192.168.1.120
│     └── Node 06 (Linux) - Standby (혼합 구성)
│
├── [그룹 04~10] ...
│
└── 통합 대시보드에서 전체 그룹 상태 한눈에 확인
```

#### 클러스터 그룹 격리 원칙

| 항목 | 설명 |
|---|---|
| Failover 격리 | 그룹 A Failover가 그룹 B에 영향 없음 |
| VIP 독립 | 각 그룹별 독립 VIP 할당 |
| Runbook 독립 | 그룹별 기동/종료 절차서 별도 관리 |
| AI 판단 독립 | 그룹별 AI Failover / Self-Healing 정책 별도 설정 |
| 메타데이터 격리 | 그룹별 독립 JSON 메타데이터 관리 |

#### 통합 대시보드 구성

```
전체 클러스터 현황 (Overview)
┌──────────────────────────────────────────────────┐
│  그룹 01 민원시스템   [정상] Active: server01      │
│  그룹 02 인사시스템   [정상] Active: server03      │
│  그룹 03 급여시스템   [경고] Active: server05 CPU↑ │
│  그룹 04 웹서비스     [장애] Failover 진행 중...   │
│  ...                                              │
└──────────────────────────────────────────────────┘
  ↓ 그룹 클릭 시 상세 드릴다운
┌──────────────────────────────────────────────────┐
│  그룹 04 웹서비스 상세                             │
│  Active  Node: server07 [Fault]                   │
│  Standby Node: server08 [VIP 인수 완료]            │
│  AI 판단: OOM 지속, 즉시 Failover 승인             │
│  Self-Healing: 장애 노드 복구 시도 중...           │
└──────────────────────────────────────────────────┘
```

#### 권한 관리 (Role-Based Access Control)

| 역할 | 권한 |
|---|---|
| 시스템 관리자 | 전체 클러스터 그룹 접근 / 설정 변경 / Failover 실행 |
| 그룹 운영자 | 담당 클러스터 그룹만 접근 / 모니터링 / Runbook 실행 |
| 읽기 전용 | 전체 그룹 모니터링만 가능 / 제어 불가 |

#### 클러스터 그룹 제한 사항

| 항목 | 값 |
|---|---|
| 관리 서버 1대당 최대 그룹 수 | **10개** |
| 그룹당 노드 수 | Active 1대 + Standby 1대 (1:1 고정, v1.0) |
| 그룹당 서비스 등록 수 | 제한 없음 |
| 그룹 추가/삭제 | Web UI에서 실시간 가능 (클러스터 재시작 불필요) |

### 3.3 네트워크 설계 (Network Design)

#### NIC 구성 (옵션 A — 전용 하트비트 NIC 분리)

| NIC | 용도 | 비고 |
|---|---|---|
| eth0 (또는 en0) | 서비스 네트워크 (VIP 포함, 클라이언트 트래픽) | AIX: en0 / Linux: eth0 |
| eth1 (또는 en1) | 하트비트 전용 네트워크 (노드 간 상태 통신) | 서비스 네트워크와 물리적 분리 권장 |

> 전용 NIC 분리 이유: 서비스 네트워크 장애 시에도 하트비트는 독립 동작, Split-Brain 오판 방지

---

#### 포트 정의

| 구간 | 프로토콜 | 포트 | 방향 | 용도 |
|---|---|---|---|---|
| 에이전트 → 관리 서버 | HTTP | **18080** | Push | 메트릭 / 로그 전송 |
| 에이전트 → 관리 서버 | HTTPS | **18443** | Push | 메트릭 / 로그 전송 (TLS) |
| 관리 서버 → 에이전트 | HTTPS | **17001** | Pull/Push | 제어 명령 (Failover 실행, Self-Healing 명령) |
| 노드 ↔ 노드 | TCP | **17000** | 양방향 | 하트비트 전용 (직접 통신) |
| 관리자 → 관리 서버 | HTTP/HTTPS | **18090** | 단방향 | Web UI 접속 |

```
[방화벽 정책 요약]

관리 서버 (eth0)
  ← 18080 / 18443  : 에이전트 메트릭 수신
  → 17001          : 에이전트 제어 명령 송신
  ← 18090          : 관리자 Web UI 접속 수신

Active Node (eth1 — 하트비트 NIC)
  ↔ 17000          : Standby Node 하트비트 직접 통신

Standby Node (eth1 — 하트비트 NIC)
  ↔ 17000          : Active Node 하트비트 직접 통신
```

---

#### Split-Brain 방지 설계 (옵션 C — 노드 간 직접 하트비트)

관리 서버가 장애 나더라도 노드 간 직접 하트비트(17000)로 상태를 판단한다.

```
정상 상태
  Active  ──[17000 하트비트]──  Standby
  (관리 서버도 정상)

관리 서버 장애 시
  Active  ──[17000 하트비트]──  Standby
  (관리 서버 없어도 하트비트로 서로 생존 확인)
  → 서비스 유지, Failover 보류

Active 장애 + 관리 서버 장애 동시 발생 시 (최악 시나리오)
  Active  ✕  (하트비트 무응답)
  Standby → 하트비트 3회 연속 무응답 확인
           → 자체 판단으로 VIP 인수 및 서비스 기동
           → 복구 후 관리 서버에 상태 보고
```

**하트비트 타이밍 정책**

| 항목 | 값 | 설명 |
|---|---|---|
| 하트비트 전송 주기 | 1초 | 노드 간 17000 포트 TCP |
| 장애 판정 임계값 | 3회 연속 무응답 | 3초 무응답 시 장애로 간주 |
| 핑퐁 방지 유예 시간 | 180초 | 간헐적 불안정 시 Failover 대기 |
| 메트릭 수집 주기 | 3초 | 에이전트 → 관리 서버 Push |

---

#### IP 구성 예시

```
[예시 구성 — AIX 2대]

관리 서버
  eth0 : 192.168.1.10  (서비스망)

Active Node (server01)
  en0  : 192.168.1.101 (서비스망 고정 IP)
  en1  : 10.10.1.1     (하트비트 전용망)
  VIP  : 192.168.1.100 (서비스 가상 IP — 평상시 보유)

Standby Node (server02)
  en0  : 192.168.1.102 (서비스망 고정 IP)
  en1  : 10.10.1.2     (하트비트 전용망)
  VIP  : 192.168.1.100 (Failover 시 인수)

GPFS 공유 스토리지
  192.168.1.200        (스토리지망 또는 서비스망)
```

---

### 3.4 전체 아키텍처

```
┌─────────────────────────────────────────────┐
│              Nemesis 관리 서버 (Linux)         │
│  ┌─────────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Spring Boot │  │ AI Engine│  │ Web UI  │ │
│  │ HA Core     │  │ (LLM)    │  │Dashboard│ │
│  └──────┬──────┘  └────┬─────┘  └─────────┘ │
└─────────┼──────────────┼────────────────────┘
          │ REST API      │ 분석 요청/응답
    ┌─────┴──────────────┴──────┐
    │                            │
┌───▼────────────┐  ┌───────────▼────────────┐
│  Active Node   │  │    Standby Node        │
│  (AIX or Linux)│  │    (AIX or Linux)      │
│  ┌───────────┐ │  │  ┌───────────────────┐ │
│  │Nemesis    │ │  │  │Nemesis            │ │
│  │Agent      │ │  │  │Agent              │ │
│  └───────────┘ │  │  └───────────────────┘ │
│  VIP 보유      │  │  VIP 대기              │
└───────┬────────┘  └──────────┬─────────────┘
        │                       │
        └──────────┬────────────┘
               ┌───▼────────────┐
               │  IBM GPFS      │
               │  공유 스토리지  │
               └────────────────┘
```

### 3.5 컴포넌트 정의

#### Nemesis 관리 서버
- **HA Core**: 클러스터 상태 관리, Failover 제어, VIP 이동 명령
- **AI Engine**: LLM 연동 인터페이스 (OpenAI API / Anthropic API / 온프레미스 LLM)
- **Web UI Dashboard**: 실시간 모니터링, 클러스터 제어, 감사 로그 조회
- **Runbook Engine**: 기동/종료/점검 절차 자동화 실행기

#### Nemesis Agent (각 노드 설치)
- AIX / Linux 표준 Shell Script 기반
- 3초 주기로 메트릭 + 에러 로그 프리뷰 수집 → 관리 서버 REST API Push
- 수집 항목: CPU, Memory, Disk, Network, 프로세스 상태, 애플리케이션 로그 (DB/WAS/Web)
- 관리 서버 장애 시에도 **에이전트 간 직접 통신으로 서비스 계속 유지** (Management Plane / Data Plane 분리)

---

## 4. 핵심 기능 요구사항 (Functional Requirements)

### F-01. 경량 설치 및 배포
- [ ] 관리 서버: `java -jar nemesis-server.jar` 단일 명령으로 기동
- [ ] 에이전트: AIX / Linux 표준 환경에서 커널 모듈 없이 설치
- [ ] 커널 레벨 드라이버 없음, OS 리부팅 없음
- [ ] 신규 노드 추가: 에이전트 기동 후 관리 서버 IP 지정만으로 자동 등록

### F-02. 크로스 플랫폼 통합 관제
- [ ] AIX 2대 클러스터 구성 지원
- [ ] Linux 2대 클러스터 구성 지원
- [ ] AIX + Linux 혼합 클러스터 구성 지원
- [ ] 단일 Web UI에서 모든 구성 통합 관제

### F-03. 통합 시스템 모니터링 (내장)
- [ ] 실시간 CPU / Memory / Disk / Network 대시보드 (Chart.js)
- [ ] 프로세스 상태 모니터링 (DB / WAS / Web 레이어)
- [ ] IBM GPFS 클러스터 노드 디스크 헬스 상태 시각화 (mmgetstate 파싱)
- [ ] 이상 징후 감지 시 즉시 알림 (Telegram / Email)
- [ ] Prometheus / Grafana 별도 구축 불필요

### F-04. AI 장애 조치 (AI Failover)
- [ ] 에이전트 수집 메트릭 + 에러 로그 → LLM 프롬프트 변환 → 판단 요청
- [ ] 하드 장애 + 소프트 장애 통합 감지
  - 프로세스 다운 (하드)
  - 화이트아웃 (프로세스 생존 + 응답 없음)
  - OutOfMemoryError 지속
  - HTTP 503 지속 발생
  - DB 락 누적 + 응답 지연
- [ ] AI 판단 결과: `{ "failover": true/false, "reason": "...", "confidence": 0.0~1.0 }`
- [ ] Failover 실행: VIP 이동 → GPFS 마운트 상태 유지 → Standby 서비스 기동
- [ ] 관리자 긴급 수동 Failover 버튼 제공 (AI 판단 우회)
- [ ] 핑퐁(Ping-Pong) 방지 로직 내장 (간헐적 불안정 시 유예 대기)

### F-05. AI 자율 복구 (AI Self-Healing)
Failover 이후 **장애 노드**를 AI가 분석하여 자동 복구 시도

#### DB 레이어 (Oracle / MySQL)
- [ ] 리스너 상태 확인 및 자동 재기동
- [ ] 락 걸린 세션 감지 및 정리
- [ ] 아카이브 로그 영역 포화 감지 및 정리
- [ ] 파라미터 파일 오류 감지 및 롤백
- [ ] DB 프로세스 재기동 및 정상 확인

#### WAS 레이어 (Tomcat / JBoss / WebLogic)
- [ ] JVM Heap 부족 감지 → JVM 옵션 임시 조정 후 재기동
- [ ] 스레드 풀 고갈 감지 → 설정 파일 수정 후 재기동
- [ ] 설정 파일 오류 감지 → 직전 버전 롤백 후 재기동
- [ ] 좀비 프로세스 제거

#### Web 레이어 (Nginx / Apache)
- [ ] 설정 문법 오류 감지 (nginx -t / apachectl -t) → 직전 버전 롤백
- [ ] 포트 바인딩 오류 감지 및 해소
- [ ] 인증서 만료 임박 감지 및 알림
- [ ] 프로세스 재기동 및 응답 확인

#### Self-Healing 공통 흐름
```
장애 노드 격리
    ↓
AI 로그 분석 (에러 로그 + 시스템 메트릭)
    ↓
원인 분류 (DB / WAS / Web / OS)
    ↓
복구 액션 생성 (Shell 명령 시퀀스)
    ↓
단계별 실행 + 결과 확인
    ↓
복구 성공 → Standby 재편입 대기
복구 실패 → 관리자 알림 + 수동 조치 안내
```

### F-06. Runbook 자동화 엔진
- [ ] JSON 기반 절차서 정의
```json
{
  "service": "민원시스템",
  "startup": ["oracle", "listener", "tomcat1", "tomcat2", "nginx"],
  "shutdown": ["nginx", "tomcat2", "tomcat1", "listener", "oracle"]
}
```
- [ ] 기동 / 종료 / 점검 절차 원클릭 실행
- [ ] 각 단계별 Health Check 자동 수행
- [ ] 실행 이력 감사 로그 저장
  ```
  2026-06-06 09:00:01 | 운영자: 홍길동 | 민원시스템 기동 | 절차서 V1.3 | 결과: 성공
  ```
- [ ] AI 기반 절차서 자동 생성 지원 ("Oracle 이중화 구성해줘" → JSON 생성)

### F-07. 통합 관리 대시보드 (Web UI)

#### 7-1. 클러스터 상태 모니터링
- [ ] 전체 클러스터 그룹 현황 Overview (최대 10개 그룹 카드 형태 표시)
- [ ] 관리 서버 ↔ 노드 간 연결 상태 실시간 표시
- [ ] 하트비트 정상 여부 시각화 (초록 / 노랑 / 빨강)
- [ ] 노드 상태 (Active / Standby / Fault / Recovering) 직관적 표시
- [ ] CPU / Memory / Disk / Network 실시간 차트 (Chart.js)
- [ ] GPFS 클러스터 노드 디스크 헬스 상태 시각화
- [ ] 수동 Failover / Switchback 버튼
- [ ] 에이전트 등록 / 해제
- [ ] 알림 설정 (Telegram / Email)
- [ ] 감사 로그 조회 및 내보내기

#### 7-2. SW 프로세스 모니터링

**SW 등록 방식 (옵션 C — 자동 스캔 + 수동 등록 혼합)**
```
자동 스캔 흐름:
  에이전트가 ps 결과 분석
  → oracle, tomcat, nginx 등 알려진 프로세스 자동 감지
  → 관리 서버로 감지 목록 전송
  → Web UI에서 관리자가 확인 / 수정 / 확정
  → 확정된 SW만 모니터링 대상으로 등록

수동 등록:
  관리자가 Web UI에서 직접 입력
  (프로세스명, 포트, 헬스체크 URL, SW 타입)
```

**SW 타입별 헬스체크 방식**

| SW 타입 | 헬스체크 방식 | 확인 항목 |
|---|---|---|
| DB (Oracle / MySQL) | 프로세스 + 포트 | PID 존재 여부 + DB 리스너 포트 응답 |
| WAS (Tomcat / JBoss) | 프로세스 + 포트 + HTTP | PID + 포트 + HTTP 응답코드 (200) |
| Web (Nginx / Apache) | 프로세스 + 포트 + HTTP | PID + 포트 + HTTP 응답코드 (200) |
| 기타 SW | 프로세스만 | PID 존재 여부 |

**SW 상태 UI 표시**

```
┌─────────────────────────────────────────────────────────┐
│  [그룹 01] 민원시스템 — server01 (Active)                │
│                                                          │
│  SW 프로세스 상태                                        │
│  ┌──────────┬──────────┬──────────┬──────────────────┐  │
│  │ oracle   │ listener │ tomcat   │ nginx            │  │
│  │ ● 정상   │ ● 정상   │ ● 정상   │ ● 정상           │  │
│  │ PID:1234 │ 1521 ✓   │ 8080 ✓   │ 80 ✓ HTTP:200   │  │
│  └──────────┴──────────┴──────────┴──────────────────┘  │
│                                                          │
│  ● 정상  ▲ 경고  ✕ 장애                                 │
└─────────────────────────────────────────────────────────┘
```

**SW 등록 정보 항목**

| 항목 | 설명 | 예시 |
|---|---|---|
| SW명 | 표시 이름 | oracle, tomcat1 |
| SW 타입 | DB / WAS / Web / 기타 | DB |
| 프로세스명 | ps에서 감지할 프로세스 키워드 | ora_pmon |
| 포트 | 헬스체크 포트 (DB/WAS/Web) | 1521 |
| 헬스체크 URL | HTTP 응답 확인 URL (WAS/Web) | http://localhost:8080/health |
| 체크 주기 | 헬스체크 실행 간격 (초) | 10 |
| 장애 판정 임계값 | 연속 실패 횟수 | 3회 |

---

### F-08. WYSIWYG 기동/종료 순서 편집기

#### 개요
드래그앤드롭 방식으로 SW 기동/종료 순서를 시각적으로 편집하고 저장한다.
저장된 순서는 Runbook 엔진이 정상 종료 및 Failover 기동 시 자동으로 사용한다.

#### WYSIWYG 편집기 UI

```
┌─────────────────────────────────────────────────────────┐
│  [민원시스템] 기동/종료 순서 편집                        │
│                                                          │
│  ┌─────────────────┐    ┌─────────────────┐            │
│  │   기동 순서      │    │   종료 순서      │            │
│  │                 │    │                 │            │
│  │  1. ┌────────┐  │    │  1. ┌────────┐  │            │
│  │     │ oracle │  │    │     │ nginx  │  │            │
│  │     └────────┘  │    │     └────────┘  │            │
│  │  2. ┌────────┐  │    │  2. ┌────────┐  │            │
│  │     │listener│  │    │     │tomcat2 │  │            │
│  │     └────────┘  │    │     └────────┘  │            │
│  │  3. ┌────────┐  │    │  3. ┌────────┐  │            │
│  │     │tomcat1 │  │    │     │tomcat1 │  │            │
│  │     └────────┘  │    │     └────────┘  │            │
│  │  4. ┌────────┐  │    │  4. ┌────────┐  │            │
│  │     │tomcat2 │  │    │     │listener│  │            │
│  │     └────────┘  │    │     └────────┘  │            │
│  │  5. ┌────────┐  │    │  5. ┌────────┐  │            │
│  │     │ nginx  │  │    │     │ oracle │  │            │
│  │     └────────┘  │    │     └────────┘  │            │
│  │                 │    │                 │            │
│  │  ↕ 드래그로 순서 변경  │    │  ↕ 드래그로 순서 변경  │  │
│  └─────────────────┘    └─────────────────┘            │
│                                                          │
│  각 단계 옵션:                                           │
│  ┌──────────────────────────────────────────────────┐  │
│  │ oracle │ 기동 후 대기: 10초 │ 실패 시: 중단 ▼    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  [저장]  [기동 실행]  [종료 실행]  [초기화]              │
└─────────────────────────────────────────────────────────┘
```

#### 각 단계 설정 항목

| 항목 | 설명 | 기본값 |
|---|---|---|
| 실행 SW | 해당 단계에서 기동/종료할 SW | - |
| 기동 후 대기 시간 | 다음 단계 진행 전 대기 (초) | 5초 |
| 헬스체크 확인 | 기동 후 정상 응답 확인 여부 | 사용 |
| 실패 시 처리 | 중단 / 다음 단계 진행 / 관리자 확인 | 중단 |

#### 실행 시 진행 상태 UI

```
┌─────────────────────────────────────────────────────────┐
│  [민원시스템] 기동 실행 중...                            │
│                                                          │
│  1. oracle   ✅ 완료 (3.2초)                            │
│  2. listener ✅ 완료 (1.1초)                            │
│  3. tomcat1  🔄 실행 중... (5초 대기)                   │
│  4. tomcat2  ⏳ 대기                                    │
│  5. nginx    ⏳ 대기                                    │
│                                                          │
│  전체 진행률: ██████░░░░ 40%                            │
│                                                          │
│  실행자: 홍길동 | 절차서 V1.3 | 2026-06-06 09:00:01     │
└─────────────────────────────────────────────────────────┘
```

#### Runbook 연동

- [ ] WYSIWYG로 저장된 순서가 JSON Runbook으로 자동 변환
- [ ] 정상 종료 시 종료 순서 자동 적용
- [ ] Failover 발생 시 Standby 노드에서 기동 순서 자동 실행
- [ ] Switchback 시 기동/종료 순서 자동 적용
- [ ] 절차서 버전 관리 (변경 이력 저장)
- [ ] 실행 이력 감사 로그 저장
  ```
  2026-06-06 09:00:01 | 운영자: 홍길동 | 민원시스템 기동
  절차서 V1.3 | 단계: 5/5 | 결과: 성공 | 소요시간: 42초
  ```

---

## 5. 비기능 요구사항 (Non-Functional Requirements)

| 항목 | 요구사항 |
|---|---|
| Failover 완료 시간 | VIP 이동 기준 1초 이내 (GPFS 상시 마운트 구성 시) |
| 에이전트 리소스 점유 | 대상 서버 CPU/Memory 1% 미만 |
| 관리 서버 가용성 | 관리 서버 장애 시에도 노드 서비스 무중단 유지 |
| AI 판단 응답 시간 | LLM 호출 후 판단 결과 반환 10초 이내 |
| 감사 로그 보존 | 최소 1년 이상 보존, 외부 내보내기 지원 |
| 보안 | 관리 서버 ↔ 에이전트 통신 TLS 암호화 |
| 온프레미스 LLM | 인터넷 차단 환경(국방/공공) 대응 온프레미스 LLM 연동 인터페이스 제공 |

---

## 6. 기술 스택 (Tech Stack)

### 6.1 관리 서버 (Nemesis Server)

| 구분 | 기술 | 비고 |
|---|---|---|
| Backend Framework | Java 17 / Spring Boot | REST API, HA Core, AI 엔진 |
| Frontend | React | SPA 구조, Web UI 대시보드 |
| Database | PostgreSQL | 클러스터 설정, 감사 로그, Runbook 이력 영구 저장 |
| 실시간 메트릭 캐시 | In-Memory (Spring Cache) | 노드 메트릭 임시 보관, DB 부하 분산 |
| 메시지 큐 | In-Memory Concurrent Queue | 에이전트 이벤트 처리 |
| AI 연동 | OpenAI API / Anthropic API / 온프레미스 LLM (Ollama / vLLM) | .env로 Provider 전환 |
| 배포 방식 | Docker Compose | 단일 명령 설치/기동 |
| 웹 서버 | Nginx | React 빌드 파일 서빙 + API 리버스 프록시 |

#### 디렉토리 구조
```
nemesis-server/
├── docker-compose.yml       ← 전체 서비스 정의
├── .env                     ← 환경 설정 (IP, DB, AI Key 등)
├── nginx/
│   └── nginx.conf           ← React 서빙 + API 프록시 설정
├── backend/
│   └── nemesis-server.jar   ← Spring Boot 빌드 결과물
├── frontend/
│   └── dist/                ← React 빌드 결과물
└── postgres/
    └── init.sql             ← 초기 DB 스키마
```

#### Docker Compose 구성
```yaml
services:
  nemesis-server:
    image: nemesis-server:latest
    ports:
      - "18080:18080"   # 에이전트 REST API
      - "17001:17001"   # 에이전트 제어 명령
    depends_on:
      - postgres
    env_file:
      - .env

  nemesis-frontend:
    image: nginx:alpine
    ports:
      - "18090:80"      # Web UI
    volumes:
      - ./frontend/dist:/usr/share/nginx/html
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - nemesis-data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql

volumes:
  nemesis-data:
```

#### 환경 설정 파일 (.env)
```env
# 관리 서버
NEMESIS_API_PORT=18080
NEMESIS_CONTROL_PORT=17001
NEMESIS_UI_PORT=18090

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=nemesis
DB_USER=nemesis
DB_PASSWORD=changeme

# AI Provider (openai / anthropic / ollama)
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# 알림
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EMAIL_SMTP_HOST=
EMAIL_SMTP_PORT=587
EMAIL_FROM=
EMAIL_TO=

# 클러스터 설정
MAX_CLUSTER_GROUPS=10
```

#### 설치 명령
```bash
# 1. 패키지 압축 해제
tar -xzf nemesis-server.tar.gz /opt/nemesis/

# 2. 환경 설정
vi /opt/nemesis/.env

# 3. 기동
cd /opt/nemesis
docker compose up -d

# 4. Web UI 접속
# http://{관리서버IP}:18090
```

---

### 6.2 에이전트 (Nemesis Agent — AIX / Linux 공통)

| 구분 | 기술 | 비고 |
|---|---|---|
| 메인 데몬 | Python 3 | HTTP 통신, 하트비트, 메타데이터 캐시 조율 |
| 메트릭 수집 | Shell Script (collect.sh) | vmstat, iostat, netstat, ps — OS 표준 명령 |
| 서비스 제어 | Shell Script (control.sh) | VIP 이동, GPFS 마운트, 서비스 기동/종료 |
| Self-Healing | Shell Script (healing/*.sh) | DB/WAS/Web 레이어별 복구 스크립트 |
| 통신 방식 | REST API HTTPS (curl) | 에이전트 → 관리 서버 Push |
| 하트비트 | TCP Socket (17000) | 노드 간 직접 통신 |
| 메타데이터 캐시 | JSON 파일 (/etc/nemesis/metadata.json) | 관리 서버 장애 시 자율 동작 기준 |
| 인증 | API Key (Bearer Token) | 관리 서버에서 발급, 클러스터 그룹별 독립 |

#### 디렉토리 구조
```
/opt/nemesis-agent/
├── nemesis-agent.py      ← 메인 데몬 (통신/하트비트/조율)
├── collect.sh            ← 메트릭/에러 로그 수집
├── control.sh            ← VIP/GPFS/서비스 제어
├── healing/
│   ├── heal_oracle.sh    ← Oracle 복구
│   ├── heal_tomcat.sh    ← Tomcat/JBoss 복구
│   └── heal_nginx.sh     ← Nginx/Apache 복구
└── /etc/nemesis/
    └── metadata.json     ← 로컬 메타데이터 캐시
```

#### 에이전트 등록 흐름 (API Key 방식)
```
1. 관리자 → Web UI에서 클러스터 그룹 생성
      ↓
2. 관리 서버가 API Key 자동 생성
   nmss-a3f9b2c1-4d7e-4a2f-9b3c-d1e2f3a4b5c6
      ↓
3. 관리자가 해당 API Key를 노드에 전달
      ↓
4. 노드에서 에이전트 기동 시 API Key 입력
   python3 nemesis-agent.py start \
     --server https://192.168.1.10:18080 \
     --key nmss-a3f9b2c1-4d7e-4a2f-9b3c-d1e2f3a4b5c6
      ↓
5. 에이전트 → 관리 서버 등록 요청
   POST /api/agent/register
   {
     "api_key": "nmss-a3f9b2c1-...",
     "hostname": "server01",
     "os": "AIX",
     "version": "1.0.0"
   }
      ↓
6. 관리 서버 Key 검증 → 클러스터 그룹 자동 편입
   이후 모든 통신은 API Key를 Bearer Token으로 사용
```

#### API Key 정책
| 항목 | 정책 |
|---|---|
| 발급 단위 | 클러스터 그룹별 독립 발급 (1 Key = 1 Node) |
| 만료 설정 | 무기한 / 기간제 선택 가능 |
| 폐기/재발급 | 관리자가 Web UI에서 즉시 가능 |
| 통신 암호화 | HTTPS + Bearer Token |

#### 설치 명령
```bash
# 1. 패키지 압축 해제
tar -xzf nemesis-agent.tar.gz /opt/nemesis-agent/

# 2. 에이전트 기동 (API Key는 Web UI에서 발급)
python3 /opt/nemesis-agent/nemesis-agent.py start \
  --server https://{관리서버IP}:18080 \
  --key {API_KEY}

# AIX / Linux 동일한 명령
```

---

## 7. 데이터 모델 (핵심)

### 클러스터 메타데이터
```json
{
  "cluster_id": "cluster-01",
  "name": "민원시스템 클러스터",
  "nodes": [
    {
      "node_id": "node-01",
      "hostname": "server01",
      "os": "AIX",
      "role": "active",
      "vip": "192.168.1.100"
    },
    {
      "node_id": "node-02",
      "hostname": "server02",
      "os": "AIX",
      "role": "standby"
    }
  ],
  "storage": {
    "type": "GPFS",
    "mount_point": "/data"
  },
  "services": ["oracle", "listener", "tomcat", "nginx"],
  "failover_policy": {
    "ai_enabled": true,
    "manual_override": true,
    "pingpong_guard_seconds": 180
  }
}
```

---

## 8. 메타데이터 동기화 설계 (Metadata Sync Design)

### 8.1 동기화 원칙

- **관리 서버 = Single Source of Truth**
- 에이전트는 관리 서버로부터 메타데이터를 수신하여 로컬 JSON 캐시로 보관
- 관리 서버 장애 시 에이전트는 **로컬 캐시 기준으로 자율 동작**

---

### 8.2 동기화 방식 (Push + Pull 혼합)

#### Push — 실시간 반영
```
트리거: 관리자가 Web UI에서 설정 변경 시
        Failover 발생으로 role 변경 시
        Self-Healing 완료로 노드 상태 변경 시

흐름:
  관리 서버
    → HTTP POST /agent/sync (17001 포트)
    → 변경된 메타데이터 JSON 전송
    → 에이전트 수신 후 로컬 캐시 갱신
    → 에이전트 ACK 응답

실패 처리:
  ACK 미수신 시 최대 3회 재전송 (10초 간격)
  3회 모두 실패 시 → 관리자 알림 + Pull 주기에서 자동 보정
```

#### Pull — 정합성 보장
```
주기: 600초 (10분)

흐름:
  에이전트
    → HTTP GET /metadata/latest (18443 포트)
    → 관리 서버로부터 전체 메타데이터 수신
    → 로컬 캐시와 비교 (checksum 기반)
    → 불일치 시 로컬 캐시 갱신

목적:
  Push 실패로 인한 데이터 불일치 자동 보정
  관리 서버 일시 장애 후 복구 시 상태 재동기화
```

---

### 8.3 동기화 흐름 다이어그램

```
[정상 상태 — 설정 변경 시]

관리자 Web UI
  → 설정 변경
  ↓
관리 서버 (Master)
  → Push: HTTP POST /agent/sync (즉시)
  ↓
Active Agent      Standby Agent
  로컬 캐시 갱신    로컬 캐시 갱신
  ACK 응답          ACK 응답

[10분 주기 Pull]

Active Agent      Standby Agent
  GET /metadata/latest (600초 주기)
  ↓
관리 서버
  → checksum 비교 후 변경분만 응답

[관리 서버 장애 시]

관리 서버 ✕
  ↓
Active Agent      Standby Agent
  로컬 캐시 JSON으로 자율 동작
  하트비트(17000) 직접 통신 유지
  ↓
관리 서버 복구
  → 에이전트 Pull 주기(10분)에서 자동 재동기화
  → 또는 관리 서버 재기동 시 즉시 Push
```

---

### 8.4 로컬 캐시 JSON 구조

에이전트가 로컬에 보관하는 캐시 파일 (`/etc/nemesis/metadata.json`)

```json
{
  "sync_version": "20260606-143022",
  "checksum": "sha256:a3f9...",
  "last_synced_at": "2026-06-06T14:30:22+09:00",
  "cluster_id": "cluster-01",
  "my_node_id": "node-01",
  "my_role": "active",
  "peer": {
    "node_id": "node-02",
    "hostname": "server02",
    "heartbeat_ip": "10.10.1.2",
    "heartbeat_port": 17000
  },
  "vip": "192.168.1.100",
  "storage": {
    "type": "GPFS",
    "mount_point": "/data"
  },
  "services": ["oracle", "listener", "tomcat", "nginx"],
  "failover_policy": {
    "ai_enabled": true,
    "manual_override": true,
    "pingpong_guard_seconds": 180,
    "heartbeat_fail_threshold": 3,
    "self_healing_mode": "auto"
  },
  "pull_interval_seconds": 600
}
```

---

### 8.5 동기화 정책 요약

| 항목 | 값 |
|---|---|
| 동기화 주체 | 관리 서버 (Single Source of Truth) |
| Push 트리거 | 설정 변경 / Failover / Self-Healing 완료 |
| Push 포트 | 17001 (관리 서버 → 에이전트) |
| Pull 주기 | 600초 (10분) |
| Pull 포트 | 18443 (에이전트 → 관리 서버) |
| Push 재전송 | 최대 3회 (10초 간격) |
| 정합성 확인 | SHA-256 checksum 비교 |
| 관리 서버 장애 시 | 로컬 캐시 JSON 기준 자율 동작 |
| 캐시 파일 위치 | `/etc/nemesis/metadata.json` |

---

## 10. 제약 사항 및 전제 조건 (Constraints)

- AIX 에이전트는 AIX 표준 명령만 사용 (서드파티 패키지 의존 없음)
- GPFS 연동은 IBM GPFS(Spectrum Scale) 설치된 환경 전제
- AI Self-Healing 실행은 관리자 사전 승인 정책 설정 가능 (자동 / 반자동 / 수동 3단계)
- 온프레미스 LLM 연동 시 모델 성능에 따라 판단 정확도 차이 발생 가능
- 초기 버전(v1.0)은 Active/Standby 1:1 구성만 지원 (N:M은 로드맵)

---

## 9. 성공 지표 (Success Metrics)

| 지표 | 목표 |
|---|---|
| Failover 자동화율 | 전체 장애의 90% 이상 자동 Failover |
| Self-Healing 성공률 | 장애 노드의 70% 이상 무인 자동 복구 |
| MTTR (평균 복구 시간) | 기존 대비 80% 단축 |
| 운영자 야간 호출 감소 | 기존 대비 60% 감소 |
| 설치 소요 시간 | 관리 서버 + 에이전트 2노드 기준 1시간 이내 |

---
