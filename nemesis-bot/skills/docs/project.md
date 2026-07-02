# project — 프로젝트 일정 관리

## 설명
외부 프로젝트 관리 API와 연동하여 프로젝트 및 작업(태스크)을 조회·생성·수정·삭제합니다.

## API 엔드포인트
`https://chojungwon.iptime.org/project/api/ai-api.php`
인증: `X-AI-API-Key` 헤더

## 도구 목록
- `list_projects` — 전체 프로젝트 목록 조회 (GET ?resource=projects)
- `list_project_tasks` — 작업 목록 조회, projectId/date 필터 가능
- `add_project_task` — 작업 생성 (projectId, name 필수)
- `update_project_task` — 작업 수정 (id 필수, progress 0~100)
- `delete_project_task` — 작업 삭제 (id 필수)
- `get_project_tasks_detail` — 작업일지용 상세 조회

## 파라미터 규칙 (중요)
- 필드명은 camelCase: `projectId`, `startDate`, `endDate` (snake_case 금지)
- 수정·삭제 시 `id` 사용 (task_id 금지)
- 작업 이름 필드: `name` (task_name 금지)

## 사용 순서
1. 작업 추가: `list_projects()` → projectId 확인 → `add_project_task(projectId, name, ...)`
2. 작업 수정: `list_project_tasks()` → id 확인 → `update_project_task(id, ...)`

## 제약사항
- DELETE는 Body에 `{"id": N}` JSON 포함
- 날짜 형식: `YYYY-MM-DD`
- tasks_detail 리소스는 비표준 — 오류 발생 시 tasks로 대체

## 실패 경험 기록
| 날짜 | 오류 | 원인 | 해결책 |
|------|------|------|--------|
| 2026-05-27 | FunctionDeclaration ValidationError | parameters를 `{"key": "TYPE"}` 형식으로 정의 | JSON Schema 형식(`{"type":"object","properties":{...}}`)으로 변경 |
| 2026-05-27 | `get_projects` AttributeError | langgraph_tools가 존재하지 않는 메서드 호출 | skills/project.py에 alias 메서드 추가 |
