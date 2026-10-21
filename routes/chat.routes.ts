import { Router, Response } from "express";
import asyncHandler from "express-async-handler";
import multer from "multer";
import pool from "../database/db";
import { authenticateToken, AuthenticatedRequest } from "../middleware/middleware";
import { notifyUser } from "../services/notificationService";
import { readChatFile, removeChatFile, writeChatFile } from "../services/chatFiles";

const router = Router();
router.use(authenticateToken);
const handle = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  asyncHandler(async (req, res) => { await fn(req as AuthenticatedRequest, res); });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const id = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const me = (req: AuthenticatedRequest) => req.user!.id;
const fail = (res: Response, status: number, message: string) => res.status(status).json({ message });
const directHasAdmin = `EXISTS (SELECT 1 FROM chat_participants peer
  JOIN tbl_users account ON account.id=peer.user_id
  WHERE peer.conversation_id=c.id AND LOWER(account.role)='admin')`;
async function member(conversationId: number, userId: number) {
  const [rows]: any = await pool.query(`SELECT p.* FROM chat_participants p
    JOIN chat_conversations c ON c.id=p.conversation_id AND c.archived_at IS NULL
    WHERE p.conversation_id=? AND p.user_id=? AND (c.type<>'direct' OR ${directHasAdmin})`, [conversationId, userId]);
  return rows[0];
}
async function message(messageId: number) {
  const [rows]: any = await pool.query("SELECT * FROM chat_messages WHERE id=?", [messageId]);
  return rows[0];
}
async function fileBytes(item: any): Promise<Buffer | null> {
  if (item.file_path) {
    try { return await readChatFile(item.file_path); }
    catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  }
  const [legacy]: any = await pool.query("SELECT data FROM chat_files WHERE message_id=?", [item.id]);
  return legacy[0]?.data || null;
}
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

router.get("/contacts", handle(async (req: AuthenticatedRequest, res) => {
  const [rows]: any = await pool.query(`SELECT u.id,u.name,u.email,u.image,u.role,p.last_seen,
    (p.last_seen>DATE_SUB(NOW(),INTERVAL 40 SECOND)) AS online
    FROM tbl_users u LEFT JOIN chat_presence p ON p.user_id=u.id
    WHERE u.id<>? AND u.status='Active' AND u.loginStatus='Y' ORDER BY u.name`, [me(req)]);
  res.json(rows);
}));

router.post("/presence", handle(async (req: AuthenticatedRequest, res) => {
  await pool.query(`INSERT INTO chat_presence (user_id,last_seen) VALUES (?,NOW())
    ON DUPLICATE KEY UPDATE last_seen=NOW()`, [me(req)]);
  await pool.query(`UPDATE chat_participants p SET delivered_id=GREATEST(delivered_id,
    COALESCE((SELECT MAX(m.id) FROM chat_messages m WHERE m.conversation_id=p.conversation_id),0))
    WHERE p.user_id=?`, [me(req)]);
  res.json({ ok: true });
}));

router.get("/conversations", handle(async (req: AuthenticatedRequest, res) => {
  const [rows]: any = await pool.query(`
    SELECT c.id,c.type,c.name,c.project_id,c.created_by,c.created_at,p.read_id,p.cleared_id,p.pinned_at,p.muted,
      (SELECT MAX(m.id) FROM chat_messages m WHERE m.conversation_id=c.id) AS last_id,
      (SELECT m.content FROM chat_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT m.created_at FROM chat_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
      (SELECT m.file_name FROM chat_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_file_name,
      (SELECT u.name FROM chat_messages m JOIN tbl_users u ON u.id=m.sender_id WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_name,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id=c.id AND m.id>GREATEST(p.read_id,p.cleared_id) AND m.sender_id<>? AND m.deleted_at IS NULL) AS unread
    FROM chat_conversations c JOIN chat_participants p ON p.conversation_id=c.id
    WHERE p.user_id=? AND c.archived_at IS NULL AND (c.type<>'direct' OR ${directHasAdmin})
    ORDER BY p.pinned_at DESC,last_id DESC,c.created_at DESC`, [me(req), me(req)]);
  if (!rows.length) return res.json([]);
  const [people]: any = await pool.query(`SELECT p.conversation_id,u.id,u.name,u.image,p.read_id,p.delivered_id,p.is_admin,s.last_seen,
    (s.last_seen>DATE_SUB(NOW(),INTERVAL 40 SECOND)) AS online
    FROM chat_participants p JOIN tbl_users u ON u.id=p.user_id LEFT JOIN chat_presence s ON s.user_id=u.id
    WHERE p.conversation_id IN (?)`, [rows.map((row: any) => row.id)]);
  res.json(rows.map((row: any) => ({ ...row, participants: people.filter((p: any) => p.conversation_id === row.id) })));
}));

router.patch("/conversations/:id/preferences", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  if (!await member(conversationId, me(req))) return fail(res, 403, "Conversation unavailable");
  if (typeof req.body?.pinned === "boolean") await pool.query("UPDATE chat_participants SET pinned_at=? WHERE conversation_id=? AND user_id=?", [req.body.pinned ? new Date() : null,conversationId,me(req)]);
  if (typeof req.body?.muted === "boolean") await pool.query("UPDATE chat_participants SET muted=? WHERE conversation_id=? AND user_id=?", [req.body.muted,conversationId,me(req)]);
  res.json({ ok: true });
}));

router.post("/conversations", handle(async (req: AuthenticatedRequest, res) => {
  const group = req.body?.type === "group";
  const others = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(id).filter((n: number) => n && n !== me(req)))];
  if (others.length < (group ? 2 : 1) || (!group && others.length !== 1) || others.length > 49) return fail(res, 400, "Select valid participants");
  const [users]: any = await pool.query("SELECT id,role FROM tbl_users WHERE id IN (?) AND status='Active' AND loginStatus='Y'", [others]);
  if (users.length !== others.length) return fail(res, 400, "A selected user is unavailable");
  if (!group && req.user?.role?.toLowerCase() !== "admin" && users[0].role?.toLowerCase() !== "admin")
    return fail(res, 403, "Employees can start direct chats with administrators only");
  const name = clean(req.body?.name, 120);
  if (group && !name) return fail(res, 400, "Group name is required");
  if (!group) {
    const [existing]: any = await pool.query(`SELECT c.id FROM chat_conversations c
      JOIN chat_participants a ON a.conversation_id=c.id AND a.user_id=?
      JOIN chat_participants b ON b.conversation_id=c.id AND b.user_id=?
      WHERE c.type='direct' AND (SELECT COUNT(*) FROM chat_participants WHERE conversation_id=c.id)=2 LIMIT 1`, [me(req), others[0]]);
    if (existing.length) return res.json({ id: existing[0].id });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result]: any = await conn.query("INSERT INTO chat_conversations (type,name,created_by) VALUES (?,?,?)", [group ? "group" : "direct", group ? name : null, me(req)]);
    for (const userId of [me(req), ...others]) await conn.query("INSERT INTO chat_participants (conversation_id,user_id,is_admin) VALUES (?,?,?)", [result.insertId, userId, userId === me(req)]);
    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}));

router.patch("/conversations/:id", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  const participant = await member(conversationId, me(req));
  const [groups]: any = await pool.query("SELECT type FROM chat_conversations WHERE id=?", [conversationId]);
  if (!participant?.is_admin || groups[0]?.type !== "group") return fail(res, 403, "Group unavailable");
  const name = clean(req.body?.name, 120);
  if (!name) return fail(res, 400, "Group name is required");
  await pool.query("UPDATE chat_conversations SET name=? WHERE id=?", [name, conversationId]);
  res.json({ ok: true });
}));

router.post("/conversations/:id/participants", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  const participant = await member(conversationId, me(req));
  const [groups]: any = await pool.query("SELECT type FROM chat_conversations WHERE id=?", [conversationId]);
  if (!participant?.is_admin || groups[0]?.type !== "group") return fail(res, 403, "Group unavailable");
  const userId = id(req.body?.userId);
  const [users]: any = await pool.query("SELECT id FROM tbl_users WHERE id=? AND status='Active' AND loginStatus='Y'", [userId]);
  if (!users.length) return fail(res, 400, "User unavailable");
  const [count]: any = await pool.query("SELECT COUNT(*) AS n FROM chat_participants WHERE conversation_id=?", [conversationId]);
  if (count[0].n >= 50) return fail(res, 400, "Group is full");
  await pool.query("INSERT IGNORE INTO chat_participants (conversation_id,user_id) VALUES (?,?)", [conversationId, userId]);
  res.json({ ok: true });
}));

router.delete("/conversations/:id/participants/:userId", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  const targetId = id(req.params.userId);
  const participant = await member(conversationId, me(req));
  const [groups]: any = await pool.query("SELECT type FROM chat_conversations WHERE id=?", [conversationId]);
  if (!participant || groups[0]?.type !== "group" || (targetId !== me(req) && !participant.is_admin)) return fail(res, 403, "Group unavailable");
  const [admins]: any = await pool.query("SELECT COUNT(*) AS n FROM chat_participants WHERE conversation_id=? AND is_admin=1", [conversationId]);
  if (targetId === me(req) && participant.is_admin && admins[0].n === 1) return fail(res, 400, "Assign another admin before leaving or delete the group");
  await pool.query("DELETE FROM chat_participants WHERE conversation_id=? AND user_id=?", [conversationId, targetId]);
  res.json({ ok: true });
}));

router.delete("/conversations/:id/group", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  const participant = await member(conversationId, me(req));
  const [groups]: any = await pool.query("SELECT type FROM chat_conversations WHERE id=?", [conversationId]);
  if (!participant?.is_admin || groups[0]?.type !== "group") return fail(res, 403, "Group unavailable");
  const [files]: any = await pool.query("SELECT file_path FROM chat_messages WHERE conversation_id=? AND file_path IS NOT NULL", [conversationId]);
  await pool.query("DELETE FROM chat_conversations WHERE id=?", [conversationId]);
  const removed = await Promise.allSettled(files.map((file: { file_path: string }) => removeChatFile(file.file_path)));
  removed.forEach((result) => { if (result.status === "rejected") console.error("Could not remove chat file:", result.reason); });
  res.json({ ok: true });
}));

router.get("/conversations/:id/messages", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  if (!await member(conversationId, me(req))) return fail(res, 403, "Conversation unavailable");
  const before = id(req.query.before) || Number.MAX_SAFE_INTEGER;
  const [rows]: any = await pool.query(`SELECT m.*,u.name AS sender_name,
    (SELECT content FROM chat_messages WHERE id=m.reply_to_id) AS reply_content
    FROM chat_messages m JOIN tbl_users u ON u.id=m.sender_id
    JOIN chat_participants p ON p.conversation_id=m.conversation_id AND p.user_id=?
    WHERE m.conversation_id=? AND m.id>p.cleared_id AND m.id<? ORDER BY m.id DESC LIMIT 50`, [me(req), conversationId, before]);
  const messages = rows.reverse();
  const [reactions]: any = messages.length ? await pool.query("SELECT message_id,user_id,emoji FROM chat_reactions WHERE message_id IN (?)", [messages.map((m: any) => m.id)]) : [[]];
  res.json(messages.map((m: any) => ({ ...m, reactions: reactions.filter((r: any) => r.message_id === m.id), file_path: undefined })));
}));

router.get("/conversations/:id/info", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  const participant = await member(conversationId, me(req));
  if (!participant) return fail(res, 403, "Conversation unavailable");
  const [files]: any = await pool.query(`SELECT id,file_name,file_type,file_size,created_at FROM chat_messages
    WHERE conversation_id=? AND id>? AND file_name IS NOT NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 40`, [conversationId,participant.cleared_id]);
  const [pinned]: any = await pool.query(`SELECT m.id,m.content,m.file_name,m.created_at,u.name AS sender_name FROM chat_messages m
    JOIN tbl_users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.id>? AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL ORDER BY m.pinned_at DESC LIMIT 40`, [conversationId,participant.cleared_id]);
  res.json({ files,pinned });
}));

router.get("/conversations/:id/search", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  const participant = await member(conversationId, me(req));
  if (!participant) return fail(res, 403, "Conversation unavailable");
  const query = clean(req.query.q, 120);
  if (!query) return res.json([]);
  const [rows]: any = await pool.query(`SELECT m.id,m.content,m.created_at,u.name AS sender_name
    FROM chat_messages m JOIN tbl_users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.id>? AND m.deleted_at IS NULL AND m.content LIKE ?
    ORDER BY m.id DESC LIMIT 30`, [conversationId,participant.cleared_id,`%${query}%`]);
  res.json(rows);
}));

router.get("/conversations/:id/typing", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  if (!await member(conversationId, me(req))) return fail(res, 403, "Conversation unavailable");
  const [rows]: any = await pool.query(`SELECT u.id,u.name FROM chat_typing t
    JOIN tbl_users u ON u.id=t.user_id
    JOIN chat_participants p ON p.conversation_id=t.conversation_id AND p.user_id=t.user_id
    WHERE t.conversation_id=? AND t.user_id<>? AND t.expires_at>NOW()`, [conversationId, me(req)]);
  res.json(rows);
}));

router.post("/conversations/:id/typing", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  if (!await member(conversationId, me(req))) return fail(res, 403, "Conversation unavailable");
  if (req.body?.typing === true) {
    await pool.query(`INSERT INTO chat_typing (conversation_id,user_id,expires_at)
      VALUES (?,?,DATE_ADD(NOW(),INTERVAL 4 SECOND))
      ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)`, [conversationId, me(req)]);
  } else {
    await pool.query("DELETE FROM chat_typing WHERE conversation_id=? AND user_id=?", [conversationId, me(req)]);
  }
  res.json({ ok: true });
}));

router.post("/conversations/:id/messages", upload.single("file"), handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  const file = req.file;
  if (!await member(conversationId, me(req))) return fail(res, 403, "Conversation unavailable");
  const content = clean(req.body?.content, 5000);
  const reply = id(req.body?.replyToId);
  if ((!content && !file) || (reply && (await message(reply))?.conversation_id !== conversationId)) return fail(res, 400, "Invalid message or reply");
  const conn = await pool.getConnection();
  let storedName: string | null = null;
  let newId = 0;
  try {
    await conn.beginTransaction();
    if (file) storedName = await writeChatFile(file.buffer, file.originalname);
    const [result]: any = await conn.query("INSERT INTO chat_messages (conversation_id,sender_id,content,reply_to_id,file_name,file_type,file_size,file_path) VALUES (?,?,?,?,?,?,?,?)", [conversationId, me(req), content || null, reply || null, file?.originalname || null, file?.mimetype || null, file?.size || null, storedName]);
    newId = Number(result.insertId);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    if (storedName) await removeChatFile(storedName);
    throw error;
  } finally { conn.release(); }
  const [recipients]: any = await pool.query("SELECT user_id FROM chat_participants WHERE conversation_id=? AND user_id<>? AND muted=0", [conversationId, me(req)]);
  await Promise.allSettled(recipients.map((recipient: { user_id: number }) => notifyUser(recipient.user_id, {
    title: `New message from ${req.user!.name}`,
    message: (content || (file ? "Sent an attachment" : "New message")).slice(0, 120),
    type: "chat", module: "Chat", referenceId: conversationId, targetUrl: `/chat?conversationId=${conversationId}`,
    dedupeKey: `chat:${newId}:u${recipient.user_id}`,
  })));
  res.status(201).json({ id: newId });
}));

router.post("/messages/:id/pin", handle(async (req: AuthenticatedRequest, res) => {
  const item = await message(id(req.params.id));
  const participant = item && await member(item.conversation_id, me(req));
  if (!item || item.deleted_at || !participant || Number(participant.cleared_id) >= item.id) return fail(res, 403, "Message unavailable");
  await pool.query("UPDATE chat_messages SET pinned_at=? WHERE id=?", [req.body?.pinned === true ? new Date() : null,item.id]);
  res.json({ ok: true });
}));

router.post("/messages/:id/forward", handle(async (req: AuthenticatedRequest, res) => {
  const item = await message(id(req.params.id));
  const destinationId = id(req.body?.conversationId);
  const source = item && await member(item.conversation_id, me(req));
  if (!item || item.deleted_at || !source || Number(source.cleared_id) >= item.id || !await member(destinationId, me(req))) return fail(res, 403, "Conversation unavailable");
  const attachment = item.file_name ? await fileBytes(item) : null;
  if (item.file_name && !attachment) return fail(res, 404, "File unavailable");
  const connection = await pool.getConnection();
  let newId = 0;
  let storedName: string | null = null;
  try {
    await connection.beginTransaction();
    if (attachment) storedName = await writeChatFile(attachment, item.file_name);
    const [result]: any = await connection.query(`INSERT INTO chat_messages
      (conversation_id,sender_id,content,file_name,file_type,file_size,file_path) VALUES (?,?,?,?,?,?,?)`,
      [destinationId,me(req),item.content,item.file_name,item.file_type,item.file_size,storedName]);
    newId = Number(result.insertId);
    await connection.commit();
  } catch (error) { await connection.rollback(); if (storedName) await removeChatFile(storedName); throw error; }
  finally { connection.release(); }
  const [recipients]: any = await pool.query("SELECT user_id FROM chat_participants WHERE conversation_id=? AND user_id<>? AND muted=0", [destinationId,me(req)]);
  await Promise.allSettled(recipients.map((recipient: { user_id: number }) => notifyUser(recipient.user_id, {
    title: `New message from ${req.user!.name}`,message: (item.content || "Forwarded an attachment").slice(0,120),
    type:"chat",module:"Chat",referenceId:destinationId,targetUrl:`/chat?conversationId=${destinationId}`,dedupeKey:`chat:${newId}:u${recipient.user_id}`,
  })));
  res.status(201).json({ id: newId });
}));

router.get("/messages/:id/file", handle(async (req: AuthenticatedRequest, res) => {
  const item = await message(id(req.params.id));
  const participant = item && await member(item.conversation_id, me(req));
  if (!item?.file_name || item.deleted_at || !participant || Number(participant.cleared_id) >= item.id) return fail(res, 404, "File unavailable");
  const data = await fileBytes(item);
  if (!data) return fail(res, 404, "File unavailable");
  res.attachment(item.file_name);
  res.type(item.file_type || "application/octet-stream");
  res.send(data);
}));

router.patch("/messages/:id", handle(async (req: AuthenticatedRequest, res) => {
  const item = await message(id(req.params.id));
  if (!item || !await member(item.conversation_id, me(req)) || item.sender_id !== me(req) || item.deleted_at) return fail(res, 403, "Message unavailable");
  const content = clean(req.body?.content, 5000);
  if (!content) return fail(res, 400, "Message cannot be empty");
  await pool.query("UPDATE chat_messages SET content=?,edited_at=NOW() WHERE id=?", [content, item.id]);
  res.json({ ok: true });
}));

router.delete("/messages/:id", handle(async (req: AuthenticatedRequest, res) => {
  const item = await message(id(req.params.id));
  if (!item || !await member(item.conversation_id, me(req)) || item.sender_id !== me(req)) return fail(res, 403, "Message unavailable");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM chat_files WHERE message_id=?", [item.id]);
    await connection.query("UPDATE chat_messages SET content=NULL,file_name=NULL,file_path=NULL,deleted_at=COALESCE(deleted_at,NOW()) WHERE id=?", [item.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  if (item.file_path) {
    try { await removeChatFile(item.file_path); }
    catch (error) { console.error("Could not remove chat file:", error); }
  }
  res.json({ ok: true });
}));

router.put("/messages/:id/reactions", handle(async (req: AuthenticatedRequest, res) => {
  const item = await message(id(req.params.id));
  const participant = item && await member(item.conversation_id, me(req));
  if (!item || item.deleted_at || !participant || Number(participant.cleared_id) >= item.id) return fail(res, 403, "Message unavailable");
  const emoji = clean(req.body?.emoji, 16);
  if (!['👍','❤️','😂','😮','😢','🎉'].includes(emoji)) return fail(res, 400, "Invalid reaction");
  const [found]: any = await pool.query("SELECT 1 FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?", [item.id, me(req), emoji]);
  await pool.query(found.length ? "DELETE FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?" : "INSERT INTO chat_reactions (message_id,user_id,emoji) VALUES (?,?,?)", [item.id, me(req), emoji]);
  res.json({ reacted: !found.length });
}));

router.post("/conversations/:id/read", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  if (!await member(conversationId, me(req))) return fail(res, 403, "Conversation unavailable");
  await pool.query("UPDATE chat_participants SET read_id=GREATEST(read_id,COALESCE((SELECT MAX(id) FROM chat_messages WHERE conversation_id=?),0)),delivered_id=GREATEST(delivered_id,COALESCE((SELECT MAX(id) FROM chat_messages WHERE conversation_id=?),0)) WHERE conversation_id=? AND user_id=?", [conversationId, conversationId, conversationId, me(req)]);
  await pool.query("UPDATE notifications SET isRead=1,readAt=COALESCE(readAt,NOW()),updatedAt=NOW() WHERE userId=? AND type='chat' AND referenceId=? AND isRead=0", [me(req), conversationId]);
  res.json({ ok: true });
}));

router.post("/conversations/:id/clear", handle(async (req: AuthenticatedRequest, res) => {
  const conversationId = id(req.params.id);
  if (!await member(conversationId, me(req))) return fail(res, 403, "Conversation unavailable");
  await pool.query("UPDATE chat_participants SET cleared_id=COALESCE((SELECT MAX(id) FROM chat_messages WHERE conversation_id=?),0),read_id=GREATEST(read_id,COALESCE((SELECT MAX(id) FROM chat_messages WHERE conversation_id=?),0)) WHERE conversation_id=? AND user_id=?", [conversationId, conversationId, conversationId, me(req)]);
  res.json({ ok: true });
}));

export default router;
