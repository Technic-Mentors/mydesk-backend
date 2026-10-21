import pool from "../database/db";

export type Notice = { userId: number; recipientRole?: string; title: string; message: string; type: string; module: string; referenceId: number; targetUrl: string; dedupeKey: string };

let dismissalsTableReady: Promise<void> | null = null;

export const ensureNotificationDismissalsTable = (): Promise<void> => {
  if (!dismissalsTableReady) {
    dismissalsTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS notification_dismissals (
        userId INT NOT NULL,
        dismissalKey VARCHAR(255) NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (userId, dismissalKey)
      )
    `).then(() => undefined).catch((error) => {
      dismissalsTableReady = null;
      throw error;
    });
  }
  return dismissalsTableReady;
};

export const wasNotificationDismissed = async (userId: number, key: string): Promise<boolean> => {
  await ensureNotificationDismissalsTable();
  const [rows]: any = await pool.query(
    "SELECT 1 FROM notification_dismissals WHERE userId=? AND dismissalKey=? LIMIT 1",
    [userId, key],
  );
  return rows.length > 0;
};

export async function createNotification(notice: Notice): Promise<void> {
  if (!/^\/(?!\/)[^\\]*$/.test(notice.targetUrl) || /[\u0000-\u001f]/.test(notice.targetUrl)) throw new Error("Invalid notification target URL");
  if (await wasNotificationDismissed(notice.userId, `dedupe:${notice.dedupeKey}`)) return;
  const [users]: any = await pool.query("SELECT role FROM tbl_users WHERE id=?", [notice.userId]);
  if (!users.length) throw new Error("Notification recipient not found");
  await pool.query(
    `INSERT INTO notifications (userId,recipientRole,referenceId,type,title,message,module,targetUrl,dedupeKey,isRead,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,false,NOW(),NOW()) ON DUPLICATE KEY UPDATE id=id`,
    [notice.userId, notice.recipientRole || users[0].role, notice.referenceId, notice.type, notice.title, notice.message, notice.module, notice.targetUrl, notice.dedupeKey],
  );
}

export async function notifyUser(userId: number, notice: Omit<Notice, "userId">): Promise<void> {
  await createNotification({ ...notice, userId });
}

export async function adminRecipients(module: string): Promise<Array<{ id: number; email: string; name: string; role: string }>> {
  // The same module grants used by backend route authorization determine recipients.
  const [rows]: any = await pool.query(
    `SELECT DISTINCT u.id,u.email,u.name,u.role FROM tbl_users u
     LEFT JOIN access_control ac ON ac.roleId=u.roleId AND ac.status=1
     LEFT JOIN modules m ON m.id=ac.moduleId
     WHERE u.status='Active' AND u.loginStatus='Y' AND (LOWER(u.role)='admin' OR (LOWER(u.role)<>'user' AND m.moduleName=?))`,
    [module],
  );
  return rows;
}

export async function notifyAdmins(notice: Omit<Notice, "userId">, excludeUserId?: number): Promise<void> {
  const recipients = (await adminRecipients(notice.module)).filter((user) => user.id !== excludeUserId);
  const results = await Promise.allSettled(recipients.map((user) => notifyUser(user.id, {
    ...notice, recipientRole: user.role, dedupeKey: `${notice.dedupeKey}:u${user.id}`,
  })));
  for (const result of results) if (result.status === "rejected") console.error("Admin notification failed:", result.reason);
}

export async function markAsRead(id: number, userId: number): Promise<void> {
  await pool.query("UPDATE notifications SET isRead=true,readAt=NOW(),updatedAt=NOW() WHERE id=? AND userId=?", [id,userId]);
}

export async function markAllAsRead(userId: number): Promise<void> {
  await pool.query("UPDATE notifications SET isRead=true,readAt=NOW(),updatedAt=NOW() WHERE userId=? AND isRead=false", [userId]);
}


export const wasFollowUpDismissedToday = async (userId: number, followUpId: number): Promise<boolean> => {
  await ensureNotificationDismissalsTable();
  const [rows]: any = await pool.query(
    `SELECT 1 FROM notification_dismissals
     WHERE userId=? AND dismissalKey=CONCAT('legacy:followup:', ?, ':', DATE_FORMAT(CURDATE(), '%Y-%m-%d')) LIMIT 1`,
    [userId, followUpId],
  );
  return rows.length > 0;
};
