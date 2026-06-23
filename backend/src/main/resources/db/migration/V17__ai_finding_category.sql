-- SP5: finding을 반응형/예측형으로 구분
ALTER TABLE ai_findings ADD COLUMN category VARCHAR(10) NOT NULL DEFAULT 'REACTIVE';
