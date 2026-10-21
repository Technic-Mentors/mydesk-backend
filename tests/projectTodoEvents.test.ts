import assert from "node:assert/strict";
import pool from "../database/db";
import * as notifications from "../services/notificationService";
import * as email from "../services/emailService";
import { processOverdueTodos, projectAssignmentEvent, projectStatusEvent, todoAssignmentEvent, todoDueDateEvent, todoStatusEvent } from "../services/projectTodoEvents";

async function main() {
  const originalQuery = pool.query;
  const originalNotify = notifications.notifyUser;
  const originalAdmins = notifications.adminRecipients;
  const originalEmail = email.queueEmail;
  const notices: Array<{userId:number; message:string; targetUrl:string; key:string}> = [];
  const mails: Array<{recipient:string; message:string; key:string}> = [];
  (pool as any).query = async (sql: string, values?: any[]) => {
    if (sql.includes("FROM tbl_users")) return [[{id:values?.[0],name:values?.[0] === 1 ? "Manager" : "Employee",email:`${values?.[0]}@example.invalid`,role:values?.[0] === 1 ? "admin" : values?.[0] === 3 ? "restricted" : "user"}]];
    if (sql.includes("FROM projects")) return [[{projectName:"MyDesk",version:"20261007110000"}]];
    if (sql.includes("FROM assignedprojects")) return [[{employee_id:2}]];
    if (sql.includes("FROM todo WHERE todoStatus")) return [[{id:20,task:"Review Attendance Module",employee_id:2,created_by:1,deadline:"2026-10-06"}]];
    if (sql.includes("FROM todo WHERE id")) return [[{task:"Review Attendance Module",employee_id:2,created_by:1,deadline:"2026-10-10",version:"20261007110000"}]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  (notifications as any).notifyUser = async (userId: number, notice: any) => { notices.push({userId,message:notice.message,targetUrl:notice.targetUrl,key:notice.dedupeKey}); };
  (notifications as any).adminRecipients = async () => [{id:1,name:"Manager",email:"1@example.invalid",role:"admin"}];
  (email as any).queueEmail = async (recipient:string,_title:string,message:string,_url:string,key:string) => { mails.push({recipient,message,key}); };
  try {
    await projectAssignmentEvent(5,10,2,"assigned",1);
    await projectAssignmentEvent(5,10,2,"removed",1);
    await projectStatusEvent(10,"Working","Completed",1);
    await projectStatusEvent(10,"New","Working",2);
    await todoAssignmentEvent(20,2,1);
    await todoStatusEvent(20,"Pending","Completed",2);
    await todoStatusEvent(20,"Completed","Pending",2);
    await todoDueDateEvent(20,"2026-10-08","2026-10-10",2,1);
    await processOverdueTodos("2026-10-07");
    const beforeSelf = notices.length;
    await todoAssignmentEvent(20,2,2);
    await projectAssignmentEvent(6,10,3,"assigned",1);
    assert.equal(notices.length,beforeSelf,"self-assignment and inaccessible restricted roles must not receive notices");
    assert.equal(notices.length,10);
    assert.equal(mails.length,6);
    assert(notices.some((item) => item.message.includes('Project "MyDesk" status changed from In Progress to Completed')));
    assert(notices.some((item) => item.userId===1 && item.message.includes('Project "MyDesk" status changed from New to In Progress')));
    assert(notices.some((item) => item.message.includes("reopened")));
    assert(notices.some((item) => item.message.includes("is overdue") && item.userId === 2));
    assert(notices.some((item) => item.message.includes("is overdue") && item.userId === 1));
    assert(notices.some((item) => item.targetUrl === "/users/assignedprojects?projectId=10"));
    assert(notices.some((item) => item.targetUrl === "/performance?tab=TODO&todoId=20"));
    assert(mails.every((item) => item.recipient.endsWith("@example.invalid")));
    console.log("Project assignment/removal/status and Todo assignment/status/due/overdue recipient tests passed; no email sent");
  } finally {
    (pool as any).query = originalQuery;
    (notifications as any).notifyUser = originalNotify;
    (notifications as any).adminRecipients = originalAdmins;
    (email as any).queueEmail = originalEmail;
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode=1; });
