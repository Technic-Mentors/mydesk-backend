-- Additive migration for configurable employee attendance profiles.
-- Existing attendance_rules and attendance rows are unchanged; NULL/missing
-- employee assignments continue to use the active attendance_rules row.

CREATE TABLE IF NOT EXISTS attendance_profiles (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  startTime TIME NOT NULL,
  endTime TIME NOT NULL,
  lateTime TIME NOT NULL,
  halfLeave TIME NOT NULL,
  offDays VARCHAR(100) NOT NULL,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_profiles_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employee_attendance_profiles (
  userId INT NOT NULL PRIMARY KEY,
  profileId INT NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_employee_attendance_profiles_profile (profileId)
) ENGINE=InnoDB;
