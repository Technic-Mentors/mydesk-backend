import pool from "../database/db";
import { MODULE } from "../permissionModel";
import { adminRecipients, notifyAdmins, notifyUser } from "./notificationService";
import { queueEmail } from "./emailService";

async function person(id: number): Promise<{ id: number; name: string; email: string; role: string } | undefined> {
  const [rows]: any = await pool.query("SELECT id,name,email,role FROM tbl_users WHERE id=?", [id]);
  return rows[0];
}

async function emailAdmins(title: string, message: string, url: string, key: string, exclude?: number) {
  for (const admin of await adminRecipients(MODULE.Attendance)) {
    if (admin.id !== exclude) await queueEmail(admin.email,title,`Hello ${admin.name}, ${message}`,url,`${key}:u${admin.id}`);
  }
}

const actionTime = () => new Intl.DateTimeFormat("en-GB", {
  timeZone:"Asia/Karachi", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit",
}).format(new Date());

const attendanceStatusLabel = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  const leaveNames: Record<string, string> = {
    leave: "Full Day", "full day": "Full Day", "half leave": "Half Day",
    "short leave": "Short Leave", "sick leave": "Sick Leave",
    "casual leave": "Casual Leave", "annual leave": "Annual Leave",
    "family responsibility": "Family Responsibility",
  };
  if (leaveNames[normalized]) return leaveNames[normalized] + " (Leave)";
  return status.trim().replace(/^./, (letter) => letter.toUpperCase());
};

export async function adminAttendanceRecorded(
  userId: number,
  attendanceId: number,
  date: string,
  status: string,
  clockIn?: string | null,
  clockOut?: string | null,
): Promise<void> {
  const user = await person(userId);
  if (!user) return;
  const title = "Attendance recorded by administration";
  const details = "Your attendance for " + date + " was recorded as " + attendanceStatusLabel(status) +
    (clockIn ? ". Clock in: " + clockIn : "") +
    (clockOut ? ". Clock out: " + clockOut : "") + ".";
  const targetUrl = "/user/reports?tab=ATTENDANCE_REPORT";
  const key = "attendance:" + attendanceId + ":admin-created";
  await queueEmail(user.email, title, "Hello " + user.name + ", " + details, targetUrl, key + ":email");
  await notifyUser(userId, {
    title,
    message: details,
    type: "attendance",
    module: MODULE.Attendance,
    referenceId: attendanceId,
    targetUrl,
    dedupeKey: key + ":user:" + userId,
  });
}

export async function adminAttendanceUpdated(
  userId: number,
  attendanceId: number,
  date: string,
  status: string,
  clockIn?: string | null,
  clockOut?: string | null,
): Promise<void> {
  const user = await person(userId);
  if (!user) return;
  const title = "Attendance updated by administration";
  const details = "Your attendance for " + date + " was updated to " + attendanceStatusLabel(status) +
    (clockIn ? ". Clock in: " + clockIn : "") +
    (clockOut ? ". Clock out: " + clockOut : "") + ".";
  const targetUrl = "/user/reports?tab=ATTENDANCE_REPORT";
  const key = "attendance:" + attendanceId + ":admin-updated:" + Date.now();
  await queueEmail(user.email, title, "Hello " + user.name + ", " + details, targetUrl, key + ":email");
  await notifyUser(userId, {
    title, message: details, type: "attendance", module: MODULE.Attendance,
    referenceId: attendanceId, targetUrl, dedupeKey: key + ":user:" + userId,
  });
}

export async function wfhRequested(userId: number, requestId: number, fromDate: string, toDate: string, reason?: string) {
  const user = await person(userId); if (!user) return;
  const title = "Work from home request";
  const message = `${user.name} requested remote work from ${fromDate} to ${toDate}${reason ? `. Reason: ${reason}` : ""}. Status: Pending. Submitted: ${actionTime()}.`;
  const key = `wfh:${requestId}:requested`;
  await notifyAdmins({title,message,type:"remote",module:MODULE.Attendance,referenceId:requestId,targetUrl:`/attendance?tab=REMOTE&recordId=${requestId}`,dedupeKey:key},userId);
  await queueEmail(user.email,title,`Hello ${user.name}, your work from home request for ${fromDate} to ${toDate} was submitted at ${actionTime()}. Status: Pending.${reason ? ` Reason: ${reason}.` : ""}`,"/wfh/request",`${key}:employee`);
  await emailAdmins(title,message,"/attendance?tab=REMOTE",key,userId);
}

export async function leaveRequested(userId: number, leaveId: number, description: string, fromDate: string, toDate: string) {
  const user = await person(userId); if (!user) return;
  const title = "Leave request";
  const message = `${user.name} requested ${description} leave from ${fromDate} to ${toDate}. Status: Pending. Submitted: ${actionTime()}.`;
  const key = `leave:${leaveId}:requested`;
  await notifyAdmins({title,message,type:"leave",module:MODULE.Attendance,referenceId:leaveId,targetUrl:`/attendance?tab=LEAVE&recordId=${leaveId}`,dedupeKey:key},userId);
  await emailAdmins(title,message,"/attendance?tab=LEAVE",key,userId);
  await queueEmail(user.email,title,`Hello ${user.name}, your ${description} leave request for ${fromDate} to ${toDate} was submitted at ${actionTime()}. Status: Pending.`,"/users/leaveRequests",`${key}:employee`);
}

export async function decisionEvent(kind: "leave" | "remote", userId: number, recordId: number, status: "Approved" | "Rejected", reason?: string) {
  const user = await person(userId); if (!user) return;
  const [records]: any = await pool.query(kind === "leave"
    ? "SELECT DATE_FORMAT(fromDate,'%Y-%m-%d') AS fromDate,DATE_FORMAT(toDate,'%Y-%m-%d') AS toDate FROM leaves WHERE id=?"
    : "SELECT DATE_FORMAT(remoteFromDate,'%Y-%m-%d') AS fromDate,DATE_FORMAT(remoteToDate,'%Y-%m-%d') AS toDate FROM attendance WHERE id=?", [recordId]);
  const dates = records[0] ? ` for ${records[0].fromDate} to ${records[0].toDate}` : "";
  const title = `${kind === "leave" ? "Leave" : "Work from home"} ${status.toLowerCase()}`;
  const message = `Your ${kind === "leave" ? "leave" : "work from home"} request${dates} was ${status.toLowerCase()} at ${actionTime()}${reason ? `: ${reason}` : ""}.`;
  const url = `${kind === "leave" ? "/users/leaveRequests" : "/wfh/request"}?recordId=${recordId}`;
  const key = `${kind}:${recordId}:${status.toLowerCase()}`;
  // Queue SMTP delivery first so an in-app notification failure cannot suppress the employee email.
  await queueEmail(user.email,title,`Hello ${user.name}, ${message}`,url,`${key}:email`);
  await notifyUser(userId,{title,message,type:kind,module:MODULE.Attendance,referenceId:recordId,targetUrl:url,dedupeKey:`${key}:u${userId}`});
}

export async function nonCriticalNotification(task: () => Promise<void>): Promise<void> {
  try { await task(); } catch (error) { console.error("Notification delivery failed after business action:", error); }
}
