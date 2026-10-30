-- Departments used by employee records and the Administration & Settings list.
CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  departmentName VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_departments_departmentName (departmentName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO departments (departmentName)
SELECT DISTINCT TRIM(department)
FROM tbl_users
WHERE department IS NOT NULL AND TRIM(department) <> '';
