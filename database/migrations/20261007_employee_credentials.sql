-- Apply once with the existing password reset and notification migrations.
ALTER TABLE tbl_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tbl_users ADD COLUMN department VARCHAR(120) NULL;
ALTER TABLE tbl_users ADD COLUMN reporting_manager VARCHAR(120) NULL;
