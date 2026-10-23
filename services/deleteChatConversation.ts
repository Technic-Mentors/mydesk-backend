import pool from "../database/db";
import { removeChatFile } from "./chatFiles";

// The chat schema cascades from conversations to participants, messages,
// reactions, stored file blobs, and typing state.
export async function deleteChatConversation(conversationId: number): Promise<void> {
  const connection = await pool.getConnection();
  let files: string[] = [];
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.query(
      "SELECT id FROM chat_conversations WHERE id=? FOR UPDATE",
      [conversationId],
    );
    if (!rows.length) {
      await connection.rollback();
      return;
    }
    const [attachments]: any = await connection.query(
      "SELECT file_path FROM chat_messages WHERE conversation_id=? AND file_path IS NOT NULL",
      [conversationId],
    );
    files = attachments.map((item: { file_path: string }) => item.file_path);
    await connection.query("DELETE FROM chat_conversations WHERE id=?", [conversationId]);
    await connection.query(
      "DELETE FROM notifications WHERE module='Chat' AND referenceId=?",
      [conversationId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const removed = await Promise.allSettled(files.map((file) => removeChatFile(file)));
  removed.forEach((result) => {
    if (result.status === "rejected") console.error("Could not remove chat file:", result.reason);
  });
}

export async function deleteProjectChat(projectId: number): Promise<void> {
  const [chats]: any = await pool.query(
    "SELECT id FROM chat_conversations WHERE project_id=?",
    [projectId],
  );
  for (const chat of chats) await deleteChatConversation(Number(chat.id));
}