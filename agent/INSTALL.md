# Nemesis 에이전트 설치 가이드

## 에이전트 파일 목록

| 파일 | 설명 |
|------|------|
| `nemesis-agent.py` | 메인 데몬 — 메트릭 Push, 명령 수신(17001), 피어 하트비트(17000) |
| `install.sh` | 설치 스크립트 (파일 복사 + 권한 설정) |
| `collect.sh` | Linux 메트릭 수집 (CPU/메모리/디스크/네트워크/프로세스) |
| `collect_aix.sh` | AIX 메트릭 수집 (vmstat/svmon/netstat 기반) |
| `control.sh` | HA 실행 디스패처 — VIP 이동 · GPFS · 서비스 기동/종료 |
| `healing/heal_oracle.sh` | Oracle DB 자동 복구 (리스너·인스턴스·락 정리) |
| `healing/heal_tomcat.sh` | Tomcat 자동 복구 |
| `healing/heal_nginx.sh` | Nginx 자동 복구 |

설치 후 위치: `/opt/nemesis-agent/`  
설정 디렉터리: `/etc/nemesis/`

---

## 사전 요구사항

| 항목 | 최소 버전 |
|------|----------|
| Python | 3.8 이상 |
| OS | Linux (RHEL/CentOS/Ubuntu) 또는 AIX 7.1 이상 |
| 네트워크 | 관리 서버 → 에이전트 17001/TCP, 에이전트 ↔ 에이전트 17000/TCP |

표준 라이브러리만 사용하므로 별도 pip 설치 불필요.

---

## 설치 절차

### 1. 에이전트 파일 전송

관리 서버 또는 배포 서버에서 대상 노드로 파일을 복사합니다.

```sh
# 에이전트 파일 전체를 대상 노드로 전송
scp -r agent/ root@<대상노드IP>:/tmp/nemesis-agent/
```

### 2. 설치 스크립트 실행

```sh
ssh root@<대상노드IP>
cd /tmp/nemesis-agent
chmod +x install.sh
./install.sh
```

설치 스크립트가 수행하는 작업:
- `/opt/nemesis-agent/` 디렉터리 생성
- `nemesis-agent.py`, `control.sh` 복사 및 실행 권한 설정
- OS 자동 감지: Linux → `collect.sh`, AIX → `collect_aix.sh`
- `healing/` 스크립트 복사

### 3. 에이전트 시작

```sh
python3 /opt/nemesis-agent/nemesis-agent.py start \
  --server https://<관리서버IP>:18080 \
  --key <API_KEY>
```

> API 키는 Nemesis 관리 콘솔 → **설정 > 에이전트 키** 에서 발급합니다.

### 4. 백그라운드 실행 (nohup)

```sh
nohup python3 /opt/nemesis-agent/nemesis-agent.py start \
  --server https://<관리서버IP>:18080 \
  --key <API_KEY> \
  > /var/log/nemesis-agent.log 2>&1 &

echo $! > /var/run/nemesis-agent.pid
```

### 5. systemd 서비스 등록 (권장)

```ini
# /etc/systemd/system/nemesis-agent.service
[Unit]
Description=Nemesis Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/nemesis-agent/nemesis-agent.py start \
  --server https://<관리서버IP>:18080 \
  --key <API_KEY>
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload
systemctl enable --now nemesis-agent
systemctl status nemesis-agent
```

---

## 방화벽 설정

```sh
# 관리 서버 → 에이전트: 명령 채널 (VIP 이동 / Self-Healing)
firewall-cmd --permanent --add-port=17001/tcp

# 에이전트 ↔ 에이전트: 노드 간 직접 하트비트 (관리 서버 단절 시 자율 페일오버)
firewall-cmd --permanent --add-port=17000/tcp

firewall-cmd --reload
```

iptables 환경:

```sh
iptables -I INPUT -p tcp --dport 17001 -j ACCEPT
iptables -I INPUT -p tcp --dport 17000 -j ACCEPT
```

---

## 환경변수 (선택)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `NEMESIS_CONTROL_PORT` | `17001` | 관리 서버 → 에이전트 명령 수신 포트 |
| `NEMESIS_HEARTBEAT_PORT` | `17000` | 노드 간 직접 하트비트 포트 |
| `NEMESIS_SERVICE_IP` | 자동 감지 | 에이전트가 관리 서버에 등록하는 자신의 IP (NIC가 여러 개일 때 명시 권장) |
| `NEMESIS_HEARTBEAT_IP` | 자동 감지 | 피어 하트비트용 IP (`NEMESIS_SERVICE_IP`와 다른 인터페이스 사용 시) |
| `NEMESIS_NET_IF` | `en0` (AIX) | AIX 네트워크 인터페이스 이름 |

NIC가 여러 개이거나 관리 서버가 localhost인 환경에서는 반드시 `NEMESIS_SERVICE_IP`를 지정합니다:

```sh
export NEMESIS_SERVICE_IP=192.168.1.10
python3 /opt/nemesis-agent/nemesis-agent.py start \
  --server https://<관리서버IP>:18080 \
  --key <API_KEY>
```

---

## AIX 설치 시 추가 사항

AIX는 `collect_aix.sh`가 자동 선택됩니다. 네트워크 인터페이스가 `en0`이 아닌 경우:

```sh
export NEMESIS_NET_IF=en1
```

AIX에서 `date +%s`가 지원되지 않는 버전은 Python 단 타임스탬프가 대신 사용됩니다.

---

## Self-Healing 스크립트 설정

`healing/` 스크립트는 에이전트가 관리 서버 명령을 받아 자동으로 실행합니다.  
환경에 맞게 아래 변수를 설정하거나 스크립트를 직접 수정합니다.

### heal_oracle.sh

```sh
export ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1
export ORACLE_SID=ORCL
export ORA_OWNER=oracle   # Oracle 프로세스 소유 OS 유저 (기본: oracle)
```

### heal_tomcat.sh / heal_nginx.sh

별도 환경변수 없음 — systemd 서비스명(`tomcat`, `nginx`)을 사용합니다.  
서비스명이 다를 경우 스크립트 내 `SVC_NAME` 변수를 수정합니다.

---

## 동작 확인

```sh
# 에이전트 로그 확인
journalctl -u nemesis-agent -f

# 메트릭 수집 테스트 (직접 실행)
sh /opt/nemesis-agent/collect.sh | python3 -m json.tool

# control.sh 동작 확인
/opt/nemesis-agent/control.sh svc-status nginx
```

관리 콘솔에서 해당 노드가 **온라인** 상태로 표시되면 설치 완료입니다.

---

## 포트 요약

| 포트 | 방향 | 용도 |
|------|------|------|
| 18080/TCP | 에이전트 → 관리 서버 | 메트릭 Push / 등록 |
| 17001/TCP | 관리 서버 → 에이전트 | VIP 이동 · Self-Healing 명령 |
| 17000/TCP | 에이전트 ↔ 에이전트 | 노드 간 직접 하트비트 (자율 페일오버) |
