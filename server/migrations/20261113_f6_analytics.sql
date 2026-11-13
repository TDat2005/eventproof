-- Existing installations: run once before deploying F6, or let startup apply it.
CREATE INDEX idx_views_daily_tenant_date ON views_daily (tenant_id, date);
