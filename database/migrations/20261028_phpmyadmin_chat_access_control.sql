-- Run in phpMyAdmin after selecting the MyDesk database.
-- Add Chat to Access Control and grant it to current positions by default.
INSERT INTO modules (moduleName)
SELECT 'Chat'
WHERE NOT EXISTS (SELECT 1 FROM modules WHERE moduleName = 'Chat');

INSERT INTO access_control (roleId, moduleId, status)
SELECT r.id, m.id, 1
FROM roles r
CROSS JOIN modules m
LEFT JOIN access_control ac ON ac.roleId = r.id AND ac.moduleId = m.id
WHERE m.moduleName = 'Chat' AND ac.roleId IS NULL;

-- Verify the Chat grant for each position.
SELECT r.id, r.roleName, ac.status
FROM roles r
JOIN access_control ac ON ac.roleId = r.id
JOIN modules m ON m.id = ac.moduleId
WHERE m.moduleName = 'Chat'
ORDER BY r.roleName;