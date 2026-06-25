-- SP6: AI 조치 제안 가드레일. 사이드카 자기신고를 신뢰하지 않고 서버가 권위적으로 재판정한 결과.
ALTER TABLE ai_proposals ADD COLUMN max_risk_level  VARCHAR(10);
ALTER TABLE ai_proposals ADD COLUMN requires_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_proposals ADD COLUMN blocked         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_proposals ADD COLUMN blocked_reason  TEXT;
