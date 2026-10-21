import fs from "fs";
import path from "path";
import pool from "../db";
import { syncProjectChat } from "../../services/chatProjects";
import { migrateLegacyChatFiles } from "../../services/migrateChatFiles";

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "chat.sql"), "utf8");
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  const columns: Array<[string, string, string]> = [
    ["chat_conversations", "project_id", "INT NULL UNIQUE"],
    ["chat_conversations", "archived_at", "DATETIME NULL"],
    ["chat_participants", "pinned_at", "DATETIME NULL"],
    ["chat_participants", "muted", "BOOLEAN NOT NULL DEFAULT FALSE"],
    ["chat_participants", "delivered_id", "BIGINT NOT NULL DEFAULT 0"],
    ["chat_messages", "file_size", "BIGINT NULL"],
    ["chat_messages", "file_path", "VARCHAR(255) NULL"],
    ["chat_messages", "pinned_at", "DATETIME NULL"],
  ];
  for (const [table, column, definition] of columns) {
    const [existing]: any = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
    if (!existing.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  await pool.query("ALTER TABLE chat_conversations MODIFY COLUMN type ENUM('direct','group','project') NOT NULL");
  await migrateLegacyChatFiles();
  const [projects]: any = await pool.query("SELECT id FROM projects WHERE projectStatus='Y'");
  for (const project of projects) await syncProjectChat(Number(project.id));
  console.log("Chat schema ready");
  await pool.end();
}

main().catch(async (error) => {
  console.error("Chat migration failed:", error.message);
  await pool.end();
  process.exitCode = 1;
});
