-- Adds the configured short-leave duration expected by the backend.
-- The value is stored in minutes; 120 matches the backend default.
ALTER TABLE attendance_rules
  ADD COLUMN shortLeaveThreshold INT NOT NULL DEFAULT 120;
