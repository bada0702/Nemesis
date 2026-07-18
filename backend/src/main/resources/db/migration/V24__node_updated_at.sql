-- 노드 역할 변경 등 메타 갱신 시각을 추적해 메타데이터 동기화 버전 계산에 사용한다.
ALTER TABLE nodes
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
