import fs from "fs/promises";
import pool from "../database/db";
import { chatFilePath, chatUploadDir, legacyChatFileName, readChatFile } from "./chatFiles";

export async function migrateLegacyChatFiles() {
  let lastId = 0;
  let migrated = 0;
  await fs.mkdir(chatUploadDir, { recursive: true });
  while (true) {
    const [rows]: any = await pool.query(`SELECT f.message_id,m.file_name,m.file_path,m.deleted_at,f.data
      FROM chat_files f JOIN chat_messages m ON m.id=f.message_id
      WHERE f.message_id>? ORDER BY f.message_id LIMIT 10`, [lastId]);
    if (!rows.length) break;
    for (const row of rows) {
      lastId = Number(row.message_id);
      if (!row.file_name || row.deleted_at) {
        await pool.query("DELETE FROM chat_files WHERE message_id=?", [lastId]);
        continue;
      }
      const storedName = row.file_path || legacyChatFileName(lastId, row.file_name);
      const data = Buffer.from(row.data);
      let existing: Buffer | null = null;
      try { existing = await readChatFile(storedName); }
      catch (error: any) { if (error?.code !== "ENOENT") throw error; }
      if (existing && !existing.equals(data)) throw new Error(`Chat file ${lastId} differs from its database copy`);
      if (!existing) await fs.writeFile(chatFilePath(storedName), data, { flag: "wx" });
      await pool.query("UPDATE chat_messages SET file_path=? WHERE id=?", [storedName, lastId]);
      await pool.query("DELETE FROM chat_files WHERE message_id=?", [lastId]);
      migrated++;
    }
  }
  if (migrated) console.log(`Moved ${migrated} chat attachments to ${chatUploadDir}`);
}
