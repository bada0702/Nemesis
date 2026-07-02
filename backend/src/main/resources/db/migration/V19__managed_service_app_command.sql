-- 수동 등록 앱 서비스(예: npm run dev)를 명령/작업경로/포트로 관리하기 위한 컬럼.
-- 모두 nullable: 기존 systemd/프로세스 매칭 서비스는 영향 없음.
ALTER TABLE managed_services ADD COLUMN IF NOT EXISTS start_command TEXT;
ALTER TABLE managed_services ADD COLUMN IF NOT EXISTS work_dir      TEXT;
ALTER TABLE managed_services ADD COLUMN IF NOT EXISTS port          INTEGER;
