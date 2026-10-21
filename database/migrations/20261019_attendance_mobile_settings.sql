CREATE TABLE IF NOT EXISTS attendance_mobile_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  allowClockIn TINYINT(1) NOT NULL DEFAULT 1,
  allowClockOut TINYINT(1) NOT NULL DEFAULT 1
);

INSERT IGNORE INTO attendance_mobile_settings (id, allowClockIn, allowClockOut)
VALUES (1, 1, 1);
