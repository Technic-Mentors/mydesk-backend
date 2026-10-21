import assert from "node:assert/strict";
import pool from "../database/db";
import { emailTemplate } from "../services/emailService";
import { createNotification, markAllAsRead, markAsRead } from "../services/notificationService";

async function main() {
  const html = emailTemplate("<Approval>", "A & B <script>", "/users/attendance");
  assert(html.includes("&lt;Approval&gt;"));
  assert(html.includes("A &amp; B &lt;script&gt;"));
  assert(!html.includes("<script>"));
  assert(!emailTemplate("Title", "Message", "//evil.example").includes("evil.example"));

  const key = `notification-test:${Date.now()}:${Math.random()}`;
  const [users]: any = await pool.query("SELECT id FROM tbl_users ORDER BY id LIMIT 1");
  assert(users.length, "a test database user is required");
  const userId = users[0].id;
  try {
    const notice = { userId, title: "Test", message: "Test message", type: "attendance", module: "Attendance", referenceId: 1, targetUrl: "/attendance", dedupeKey: key };
    await createNotification(notice);
    await createNotification(notice);
    const [rows]: any = await pool.query("SELECT id,isRead,readAt,recipientRole,targetUrl FROM notifications WHERE dedupeKey=?", [key]);
    assert.equal(rows.length, 1, "a retry must not add another notification");
    assert.equal(rows[0].isRead, 0);
    assert(rows[0].recipientRole);
    assert.equal(rows[0].targetUrl, "/attendance");
    await markAsRead(rows[0].id, userId);
    const [readRows]: any = await pool.query("SELECT isRead,readAt FROM notifications WHERE dedupeKey=?", [key]);
    assert.equal(readRows[0].isRead, 1);
    assert(readRows[0].readAt);
    await markAllAsRead(userId);
    console.log("Notification deduplication, read state, and HTML escaping passed");
  } finally {
    await pool.query("DELETE FROM notifications WHERE dedupeKey=?", [key]);
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
