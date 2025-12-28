-- Seed data for local development
INSERT OR IGNORE INTO users (id, provider, provider_user_id, email, name, role)
VALUES (1, 'google', 'demo_user', 'demo@example.com', 'Demo User', 'ADMIN');

INSERT INTO sheet_sources (name, spreadsheet_id, sheet_name, range)
VALUES ('Demo Sheet', 'SHEET_ID_PLACEHOLDER', 'Sheet1', 'A2:F100');

INSERT INTO articles (ext_id, title, topic, keywords, target_length, tone, audience, status)
VALUES
('demo_1', 'AI 기반 마케팅 자동화의 혁신', '마케팅 기술', 'AI 마케팅,자동화,개인화,MarTech', 1500, '전문적이면서 접근하기 쉬운', '마케팅 담당자 및 경영진', 'pending'),
('demo_2', '블록체인이 바꿀 공급망 관리의 미래', '블록체인 응용', '블록체인,공급망,투명성,추적성', 2000, '분석적이고 객관적인', '물류 및 공급망 전문가', 'pending');
