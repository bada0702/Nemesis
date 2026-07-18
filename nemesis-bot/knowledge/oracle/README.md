# Oracle 지식 도메인 (스켈레톤 — 아직 비어 있음)

이 디렉토리는 향후 Oracle DB/RAC 환경 장애 지식을 담기 위한 자리다. **현재는 비어 있고,
지식 로더는 이 도메인을 주입하지 않는다** (`knowledge_base.DEFAULT_DOMAINS = ("linux", "docker")`).

## 왜 지금 비어 있나
Oracle 지식이 실제로 소비되려면, 에이전트가 Oracle 노드의 텔레메트리(리스너/ASM/RAC 상태 등)를
수집해 조사관에게 전달하는 배선이 선행돼야 한다. 현재 에이전트는 Linux/Docker만 관측하므로
Oracle 지식을 채워도 트리거될 신호가 없다(관측 없으면 소비 불가 — 설계 전제 2).

## 채우는 조건
1. Oracle 노드 텔레메트리 수집(lsnrctl/srvctl/asmcmd 등, 별도 스코프).
2. `knowledge_base.DEFAULT_DOMAINS` 에 `"oracle"` 추가(또는 도메인 선택 로직 도입).
3. 파일 수가 커지면 상시 주입 대신 규칙 매칭 도입 검토(Phase 2).

## 향후 파일(예정)
- `listener.md` — 리스너 다운/등록 실패(TNS-12541 등)
- `asm.md` — ASM 디스크그룹 마운트/리밸런스
- `rac.md` — RAC 인스턴스/노드 이빅션, 인터커넥트
- `backup.md` — RMAN 백업/복구 실패

## 파일 형식
`../linux/*.md` 와 동일: YAML frontmatter(`fault_type`, `os`, `target_sw: oracle`, `severity`,
`related`) + 온톨로지 본문(증상→원인→진단→조치→주의).
