-- Add the former frontend position options to Roles & Access.
-- Safe to run repeatedly and preserves existing roles with the same name.
INSERT INTO roles (roleName)
SELECT seed.roleName
FROM (
  SELECT 'Intern' AS roleName UNION ALL
  SELECT 'Junior Developer' UNION ALL
  SELECT 'Senior Developer' UNION ALL
  SELECT 'Team Lead' UNION ALL
  SELECT 'Project Manager' UNION ALL
  SELECT 'HR Executive' UNION ALL
  SELECT 'Accountant' UNION ALL
  SELECT 'Sales Executive' UNION ALL
  SELECT 'Admin Staff' UNION ALL
  SELECT 'Office Boy'
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM roles existing
  WHERE LOWER(TRIM(existing.roleName)) = LOWER(seed.roleName)
);
