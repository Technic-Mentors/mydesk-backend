import fs from "node:fs";
import path from "node:path";
import pool from "../database/db";

async function main() {
  const [columns]: any = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='title'",
  );
  const sql = fs.readFileSync(path.join(__dirname,"../database/migrations/notification_foundation.sql"),"utf8");
  const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    if (columns.length && statement.includes("ALTER TABLE notifications")) continue;
    await pool.query(statement);
  }
  console.log("Notification schema ready");
}

main().catch((error) => { console.error("Notification migration failed:",error); process.exitCode=1; })
  .finally(() => pool.end());
