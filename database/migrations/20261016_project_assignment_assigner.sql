-- Existing assignments predate assigner tracking, so their value remains NULL.
ALTER TABLE assignedprojects
  ADD COLUMN assigned_by INT NULL AFTER assignStatus;
