-- 장애 예측(SP5 추세 기반 predict) 기능을 시스템 설정 화면에서 껐다 켤 수 있도록 컬럼 추가.
-- 반응형 능동 모니터링(monitor.enabled)과 별개로, 예측 스캔만 독립적으로 on/off 한다.
ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS ai_predict_enabled BOOLEAN NOT NULL DEFAULT FALSE;
