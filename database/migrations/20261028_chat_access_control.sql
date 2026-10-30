-- Add Chat to Access Control and preserve its current default availability.
-- Safe to run more than once.
INSERT INTO modules (moduleName)
SELECT 'Chat'
WHERE NOT EXISTS (SELECT 1 FROM modules WHERE moduleName = 'Chat');

-- Existing positions keep the Chat access they currently have (Chat was
-- previously available to all authenticated accounts).
INSERT INTO access_control (roleId, moduleId, status)
SELECT r.id, m.id, 1
FROM roles r
CROSS JOIN modules m
LEFT JOIN access_control ac ON ac.roleId = r.id AND ac.moduleId = m.id
WHERE m.moduleName = 'Chat' AND ac.roleId IS NULL;