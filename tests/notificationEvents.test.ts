import assert from "node:assert/strict";
import pool from "../database/db";
import * as notices from "../services/notificationService";
import * as emails from "../services/emailService";
import { adminAttendanceRecorded, attendanceEvent, decisionEvent, leaveRequested, nonCriticalNotification, wfhRequested } from "../services/notificationEvents";

async function main() {
  const originalQuery = pool.query;
  const originalAdmins = notices.adminRecipients;
  const originalNotifyAdmins = notices.notifyAdmins;
  const originalNotifyUser = notices.notifyUser;
  const originalQueueEmail = emails.queueEmail;
  const sent: string[] = [];
  const inApp: string[] = [];
  (pool as any).query = async (sql: string, params: any[]) => {
    if (sql.includes("FROM tbl_users WHERE id")) return [[{ id:params[0], name: params[0] === 1 ? "Admin" : "Employee", email: `${params[0]}@example.invalid`, role:params[0] === 1 ? "admin" : "user" }]];
    if (sql.includes("FROM leaves WHERE id") || sql.includes("FROM attendance WHERE id")) return [[{ fromDate:"2026-10-10", toDate:"2026-10-12" }]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  (notices as any).adminRecipients = async () => [{ id:1, email:"1@example.invalid", name:"Admin", role:"admin" }];
  (notices as any).notifyAdmins = async (notice: any) => { inApp.push(`admin:${notice.type}:${notice.targetUrl}`); };
  (notices as any).notifyUser = async (id: number, notice: any) => { inApp.push(`user:${id}:${notice.type}:${notice.targetUrl}`); };
  (emails as any).queueEmail = async (to: string, _title: string, _message: string, _url: string, key: string) => { sent.push(`${to}:${key}`); };
  try {
    await attendanceEvent(2,101,"in",{date:"2026-10-07",time:"09:05",status:"Present"});
    await attendanceEvent(2,101,"out",{date:"2026-10-07",time:"17:10",clockIn:"09:05",worked:"08:05"});
    await attendanceEvent(1,102,"in",{date:"2026-10-07",time:"09:00"});
    await attendanceEvent(1,102,"out",{date:"2026-10-07",time:"17:00"});
    await wfhRequested(2,201,"2026-10-10","2026-10-12","Family need");
    await leaveRequested(2,301,"ANNUAL","2026-10-10","2026-10-12");
    await decisionEvent("leave",2,301,"Approved");
    await decisionEvent("leave",2,301,"Rejected","No coverage");
    await decisionEvent("remote",2,201,"Approved");
    await decisionEvent("remote",2,201,"Rejected","No coverage");
    await adminAttendanceRecorded(2, 401, "2026-10-20", "Present (Remote)", "09:00", null);
    assert(sent.some((x) => x.includes("attendance:401:admin-created:email")));
    assert(inApp.some((x) => x.includes("user:2:attendance:/user/reports?tab=ATTENDANCE_REPORT")));
    assert.equal(inApp.filter((x) => x.startsWith("admin:")).length, 4);
    assert.equal(inApp.filter((x) => x.startsWith("user:")).length, 5);
    assert.equal(sent.length, 15);
    assert(sent.every((x) => x.includes("example.invalid")));
    assert(!inApp.some((x) => x.includes("user:1:attendance")));
    const priorEmailCount = sent.length;
    (notices as any).notifyUser = async () => { throw new Error("In-app notification unavailable"); };
    await assert.rejects(decisionEvent("remote", 2, 202, "Rejected", "No coverage"));
    assert.equal(sent.length, priorEmailCount + 1, "remote rejection email must queue even when in-app notification fails");
    await nonCriticalNotification(async () => { throw new Error("SMTP unavailable"); });
    console.log("Attendance, leave, WFH, decisions, recipient fanout, and noncritical failure passed (no email sent)");
  } finally {
    (pool as any).query = originalQuery;
    (notices as any).adminRecipients = originalAdmins;
    (notices as any).notifyAdmins = originalNotifyAdmins;
    (notices as any).notifyUser = originalNotifyUser;
    (emails as any).queueEmail = originalQueueEmail;
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
