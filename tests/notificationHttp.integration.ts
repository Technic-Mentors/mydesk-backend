import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
import { createNotification } from "../services/notificationService";

async function main() {
  const [users]: any = await pool.query("SELECT id,role,auth_version FROM tbl_users WHERE status='Active' AND loginStatus='Y' AND role IN ('admin','user')");
  const admin = users.find((user: any) => user.role === "admin");
  const employee = users.find((user: any) => user.role === "user");
  assert(admin && employee, "active admin and employee accounts are required");
  const token = (user: any) => jwt.sign({ id:user.id, role:user.role, authVersion:Number(user.auth_version) || 0 },getJwtSecret(),{ expiresIn:"5m" });
  const key = `http-notification-test:${Date.now()}:${Math.random()}`;
  const server = app.listen(0,"127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening",resolve));
    await createNotification({ userId:employee.id,title:"Test",message:"Scope test",type:"attendance",module:"Attendance",referenceId:1,targetUrl:"/users/attendance",dedupeKey:key });
    const [rows]: any = await pool.query("SELECT id FROM notifications WHERE dedupeKey=?",[key]);
    const id = rows[0].id;
    const address = server.address(); assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const request = (path: string, user?: any, method = "GET") => fetch(url+path,{ method,headers:user ? { Authorization:`Bearer ${token(user)}` } : {} });
    assert.equal((await request("/api/getNotifications")).status,401);
    const own = await request("/api/getNotifications",employee);
    assert.equal(own.status,200);
    assert((await own.json()).some((notice: any) => notice.id === id && notice.recipientRole === "user"));
    const other = await request("/api/getNotifications",admin);
    assert(!(await other.json()).some((notice: any) => notice.id === id));
    assert.equal((await request(`/api/markRead/${id}`,admin,"PATCH")).status,404);
    assert.equal((await request(`/api/markRead/${id}`,employee,"PATCH")).status,200);
    const [read]: any = await pool.query("SELECT isRead,readAt FROM notifications WHERE id=?",[id]);
    assert.equal(read[0].isRead,1); assert(read[0].readAt);
    console.log("Notification HTTP auth, recipient scope, and mark-as-read passed");
  } finally {
    await pool.query("DELETE FROM notifications WHERE dedupeKey=?",[key]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
