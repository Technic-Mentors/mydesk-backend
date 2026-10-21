import pool from "../database/db";

// The project record has no owner column, so a workspace admin owns the chat.
export async function syncProjectChat(projectId: number, actorId?: number) {
  const [projects]: any = await pool.query("SELECT id,projectName,projectStatus FROM projects WHERE id=?", [projectId]);
  if (!projects.length) return;
  if (projects[0].projectStatus !== "Y") {
    await pool.query("UPDATE chat_conversations SET archived_at=COALESCE(archived_at,NOW()) WHERE project_id=?", [projectId]);
    return;
  }
  const [owners]: any = await pool.query("SELECT id FROM tbl_users WHERE LOWER(role)='admin' AND status='Active' AND loginStatus='Y' ORDER BY id LIMIT 1");
  const ownerId = Number(owners[0]?.id || actorId);
  if (!ownerId) return;
  const [assigned]: any = await pool.query(`SELECT DISTINCT ap.employee_id AS id FROM assignedprojects ap
    JOIN tbl_users u ON u.id=ap.employee_id AND u.status='Active' AND u.loginStatus='Y'
    WHERE ap.projectId=? AND ap.assignStatus='Y'`, [projectId]);
  const desired = new Set<number>([ownerId, ...assigned.map((row: { id: number }) => Number(row.id))]);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`INSERT INTO chat_conversations (type,name,project_id,created_by)
      VALUES ('project',?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),archived_at=NULL`,
      [projects[0].projectName, projectId, ownerId]);
    const [chats]: any = await connection.query("SELECT id,created_by FROM chat_conversations WHERE project_id=? FOR UPDATE", [projectId]);
    const chatId = Number(chats[0].id);
    desired.add(Number(chats[0].created_by));
    const [current]: any = await connection.query("SELECT user_id FROM chat_participants WHERE conversation_id=?", [chatId]);
    const currentIds = new Set<number>(current.map((row: { user_id: number }) => Number(row.user_id)));
    for (const userId of desired) if (!currentIds.has(userId)) {
      await connection.query("INSERT INTO chat_participants (conversation_id,user_id,is_admin) VALUES (?,?,?)", [chatId,userId,userId === Number(chats[0].created_by)]);
    }
    for (const userId of currentIds) if (!desired.has(userId)) {
      await connection.query("DELETE FROM chat_participants WHERE conversation_id=? AND user_id=?", [chatId,userId]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function syncProjectChatSafely(projectId: number, actorId?: number) {
  try { await syncProjectChat(projectId, actorId); }
  catch (error) { console.error("Project chat sync failed:", error); }
}
