-- 점검 진행률 계산용 시작/종료 시간
ALTER TABLE inspections ADD COLUMN start_time TIMESTAMP WITH TIME ZONE;
ALTER TABLE inspections ADD COLUMN end_time   TIMESTAMP WITH TIME ZONE;
