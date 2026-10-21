import fs from "fs";
import path from "path";
import pool from "../database/db";

const apply = async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../database/migrations/20261005_password_reset.sql"),
    "utf8"
  );
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    if (statement.startsWith("ALTER TABLE")) {
      const [columns]: any = await pool.query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_users' AND COLUMN_NAME = 'auth_version'"
      );
      if (columns.length) continue;
    }
    await pool.query(statement);
  }
  await pool.end();
  process.stdout.write("Password reset schema ready.\n");
};

apply().catch((error) => {
  process.stderr.write(`Password reset migration failed: ${error.code || error.message}\n`);
  process.exitCode = 1;
  pool.end();
});
