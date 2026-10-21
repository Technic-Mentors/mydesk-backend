import pool from "../database/db";
import { MODULE } from "../permissionModel";

// Add missing module definitions without changing existing IDs or role grants.
export async function seedAccessControlModules() {
  const names = [...new Set(Object.values(MODULE))];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const name of names) {
      await connection.query(
        "INSERT INTO modules (moduleName) VALUES (?) ON DUPLICATE KEY UPDATE moduleName = moduleName",
        [name],
      );
    }
    await connection.commit();
    return names.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  seedAccessControlModules()
    .then((count) => console.log(`Access Control module catalog ready: ${count} definitions`))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => pool.end());
}
