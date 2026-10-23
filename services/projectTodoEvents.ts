import crypto from "crypto";
import pool from "../database/db";
import { MODULE } from "../permissionModel";
import { adminRecipients, notifyUser } from "./notificationService";
import { queueEmail } from "./emailService";

type Person = { id: number; name: string; email: string; role: string };

async function person(id: number): Promise<Person | undefined> {
  const [rows]: any = await pool.query("SELECT id,name,email,role FROM tbl_users WHERE id=? AND status='Active'", [id]);
  return rows[0];
}

const projectUrl = (person: Person, projectId: number) => person.role.toLowerCase() === "user"
  ? `/users/assignedprojects?projectId=${projectId}` : `/projects?tab=DETAILS&projectId=${projectId}`;
const todoUrl = (person: Person, todoId: number) => person.role.toLowerCase() === "user"
  ? `/users/todo?todoId=${todoId}` : `/performance?tab=TODO&todoId=${todoId}`;

async function send(userId: number, details: { title: string; message: string; type: string; module: string; referenceId: number; key: string; url: (user: Person) => string; email: boolean }) {
  const user = await person(userId); if (!user) return;
  if (!["admin","user"].includes(user.role.toLowerCase()) &&
      !(await adminRecipients(details.module)).some((recipient) => recipient.id === user.id)) return;
  const targetUrl = details.url(user);
  await notifyUser(user.id, { title:details.title, message:details.message, type:details.type, module:details.module,
    referenceId:details.referenceId, targetUrl, dedupeKey:`${details.key}:u${user.id}` });
  if (details.email) await queueEmail(user.email,details.title,`Hello ${user.name}, ${details.message}`,targetUrl,`${details.key}:email:u${user.id}`);
}

export async function projectAssignmentEvent(assignmentId: number, projectId: number, employeeId: number, action: "assigned" | "removed", actorId?: number) {
  if (actorId === employeeId) return;
  const [rows]: any = await pool.query("SELECT projectName FROM projects WHERE id=?", [projectId]);
  if (!rows.length) return;
  const title = action === "assigned" ? "Project assigned" : "Project assignment removed";
  const message = action === "assigned"
    ? `You have been assigned to project "${rows[0].projectName}".`
    : `You have been removed from project "${rows[0].projectName}".`;
  await send(employeeId,{title,message,type:"project",module:MODULE.Projects,referenceId:projectId,
    key:`project-assignment:${assignmentId}:${action}:${employeeId}:${projectId}`,url:(user)=>projectUrl(user,projectId),email:true});
}

export async function projectStatusEvent(projectId: number, previous: string, current: string, actorId?: number) {
  if (previous === current) return;
  const [projects]: any = await pool.query("SELECT projectName,DATE_FORMAT(updated_at,'%Y%m%d%H%i%s') AS version FROM projects WHERE id=?", [projectId]);
  if (!projects.length) return;
  const [assignments]: any = await pool.query("SELECT DISTINCT employee_id FROM assignedprojects WHERE projectId=? AND assignStatus='Y'", [projectId]);
  const managers = await adminRecipients(MODULE.Projects);
  const recipients = new Set<number>([...assignments.map((row: any) => Number(row.employee_id)),...managers.map((user) => user.id)]);
  recipients.delete(Number(actorId));
  const title = "Project status changed";
  const label = (status: string) => status === "Working" ? "In Progress" : status;
  const message = `Project "${projects[0].projectName}" status changed from ${label(previous)} to ${label(current)}.`;
  const important = ["Working","In Progress","On Hold","Completed","Cancelled"].includes(current);
  const key = `project:${projectId}:status:${previous}:${current}:${projects[0].version}`;
  await Promise.allSettled([...recipients].map((userId) => send(userId,{title,message,type:"project",module:MODULE.Projects,
    referenceId:projectId,key,url:(user)=>projectUrl(user,projectId),email:important}))).then((results) => {
    for (const result of results) if (result.status === "rejected") console.error("Project status notification failed:",result.reason);
  });
}

export async function projectChangeEvent(projectId: number, changes: string[], actorId?: number, created = false): Promise<void> {
  if (!changes.length) return;
  const [projects]: any = await pool.query("SELECT projectName FROM projects WHERE id=?", [projectId]);
  if (!projects.length) return;
  const [assignments]: any = await pool.query(
    "SELECT DISTINCT employee_id FROM assignedprojects WHERE projectId=? AND assignStatus='Y'", [projectId]);
  const managers = await adminRecipients(MODULE.Projects);
  const recipients = new Set<number>([
    ...assignments.map((row: any) => Number(row.employee_id)),
    ...managers.map((user) => user.id),
  ]);
  if (actorId) recipients.add(Number(actorId));
  const title = created ? "Project created" : "Project updated";
  const message = `Project "${projects[0].projectName}" ${created ? "created" : "updated"}: ${changes.join("; ")}.`;
  const key = `project:${projectId}:change:${crypto.randomUUID()}`;
  const results = await Promise.allSettled([...recipients].map((userId) => send(userId, {
    title, message, type: "project", module: MODULE.Projects, referenceId: projectId,
    key, url: (user) => projectUrl(user, projectId), email: false,
  })));
  for (const result of results) if (result.status === "rejected") console.error("Project update notification failed:", result.reason);
}

export async function todoAssignmentEvent(todoId: number, employeeId: number, actorId?: number) {
  if (employeeId === actorId) return;
  const [rows]: any = await pool.query("SELECT task,DATE_FORMAT(deadline,'%Y-%m-%d') AS deadline,DATE_FORMAT(updated_at,'%Y%m%d%H%i%s') AS version FROM todo WHERE id=?", [todoId]);
  if (!rows.length) return;
  const title = "Todo assigned";
  const message = `You have been assigned a new Todo: "${rows[0].task}". Due: ${rows[0].deadline}.`;
  await send(employeeId,{title,message,type:"todo",module:MODULE.Performance,referenceId:todoId,
    key:`todo:${todoId}:assigned:${employeeId}:${rows[0].version}`,url:(user)=>todoUrl(user,todoId),email:true});
}

export async function todoStatusEvent(todoId: number, previous: string, current: string, actorId?: number) {
  if (previous === current) return;
  const [rows]: any = await pool.query("SELECT task,employee_id,created_by,DATE_FORMAT(updated_at,'%Y%m%d%H%i%s') AS version FROM todo WHERE id=?", [todoId]);
  if (!rows.length) return;
  const todo = rows[0];
  const title = "Todo status changed";
  const message = `Todo "${todo.task}" status changed from ${previous} to ${current}${previous === "Completed" && current !== "Completed" ? " (reopened)" : ""}.`;
  const recipients = new Set<number>([Number(todo.employee_id),Number(todo.created_by)]);
  recipients.delete(Number(actorId));
  await Promise.allSettled([...recipients].map((userId) => send(userId,{title,message,type:"todo",module:MODULE.Performance,
    referenceId:todoId,key:`todo:${todoId}:status:${previous}:${current}:${todo.version}`,
    url:(user)=>todoUrl(user,todoId),email:false}))).then((results) => {
    for (const result of results) if (result.status === "rejected") console.error("Todo status notification failed:",result.reason);
  });
}

export async function todoDueDateEvent(todoId: number, oldDate: string, newDate: string, employeeId: number, actorId?: number) {
  if (oldDate === newDate || employeeId === actorId) return;
  const [rows]: any = await pool.query("SELECT task,DATE_FORMAT(updated_at,'%Y%m%d%H%i%s') AS version FROM todo WHERE id=?", [todoId]);
  if (!rows.length) return;
  const title = "Todo due date changed";
  const message = `Todo "${rows[0].task}" due date changed from ${oldDate} to ${newDate}.`;
  await send(employeeId,{title,message,type:"todo",module:MODULE.Performance,referenceId:todoId,
    key:`todo:${todoId}:due:${oldDate}:${newDate}:${rows[0].version}`,url:(user)=>todoUrl(user,todoId),email:true});
}

export async function processOverdueTodos(today: string, onlyTodoId?: number): Promise<void> {
  const [rows]: any = await pool.query(
    `SELECT id,task,employee_id,created_by,DATE_FORMAT(deadline,'%Y-%m-%d') AS deadline
     FROM todo WHERE todoStatus='Y' AND completionStatus<>'Completed' AND deadline < ?
     AND (? IS NULL OR id=?)`, [today,onlyTodoId ?? null,onlyTodoId ?? null]);
  const managers = new Set((await adminRecipients(MODULE.Performance)).map((user) => user.id));
  for (const todo of rows) {
    const recipients = new Set<number>([Number(todo.employee_id)]);
    if (todo.created_by !== todo.employee_id && managers.has(Number(todo.created_by))) recipients.add(Number(todo.created_by));
    const results = await Promise.allSettled([...recipients].map((userId) => send(userId,{title:"Todo overdue",
      message:`Todo "${todo.task}" was due on ${todo.deadline} and is overdue.`,type:"todo",module:MODULE.Performance,
      referenceId:todo.id,key:`todo:${todo.id}:overdue:${todo.deadline}`,
      url:(user)=>todoUrl(user,todo.id),email:false})));
    for (const result of results) if (result.status === "rejected") console.error("Overdue Todo notification failed:",result.reason);
  }
}
