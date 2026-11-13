-- Apply once, before deploying F1, or let DbService's idempotent startup
-- migration apply the equivalent changes. Do not run both manually.
-- No merchant data is deleted by this migration. All times are UTC.
ALTER TABLE store_connections
  ADD COLUMN installed_at DATETIME(3) NULL,
  ADD COLUMN uninstalled_at DATETIME(3) NULL,
  ADD COLUMN redact_requested_at DATETIME(3) NULL;
UPDATE store_connections SET installed_at = created_at WHERE installed_at IS NULL;
-- Historical uninstall times are unknown: start a full retention period now.
UPDATE store_connections SET uninstalled_at = UTC_TIMESTAMP(3), access_token = NULL
  WHERE active = FALSE AND uninstalled_at IS NULL;
ALTER TABLE store_connections MODIFY installed_at DATETIME(3) NOT NULL;
CREATE INDEX idx_conn_cleanup ON store_connections (active, uninstalled_at);
