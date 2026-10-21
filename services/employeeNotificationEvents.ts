import pool from "../database/db";
import { MODULE } from "../permissionModel";
import { adminRecipients, notifyUser } from "./notificationService";
import { queueEmail, sendSensitiveEmail } from "./emailService";

const profileUrl = (role: string) => role.toLowerCase() === "user" ? "/user/profile" : "/profile";

async function employee(id: number) {
  const [rows]: any = await pool.query("SELECT id,name,email,role,loginStatus,status FROM tbl_users WHERE id=?",[id]);
  return rows[0] as {id:number;name:string;email:string;role:string;loginStatus:string;status:string} | undefined;
}

export async function employeeNotice(id: number, title: string, message: string, key: string, email = true, url?:string) {
  const user = await employee(id);
  if (!user) return;
  const targetUrl = url || profileUrl(user.role);
  await notifyUser(id,{title,message,type:"employee",module:MODULE.People,referenceId:id,targetUrl,dedupeKey:`${key}:notice:${id}`});
  if (email) await queueEmail(user.email,title,`Hello ${user.name},\n\n${message}`,targetUrl,`${key}:email:${id}`);
}

export async function promotionDecisionNotice(id: number, promotionId: number, approved: boolean, message: string) {
  const user = await employee(id);
  if (!user) return;
  const decision = approved ? "approved" : "rejected";
  const title = approved ? "Promotion approved" : "Promotion rejected";
  const key = `promotion:${promotionId}:${decision}`;
  const targetUrl = "/user/dynamics?tab=PROMOTION";
  await notifyUser(id, { title, message, type: "promotion", module: MODULE.Dynamics,
    referenceId: promotionId, targetUrl, dedupeKey: `${key}:notice:${id}` });
  await queueEmail(user.email, title, `Hello ${user.name},\n\n${message}`, targetUrl, `${key}:email:${id}`);
}

export async function welcomeEmployee(id: number, temporaryPassword: string, details: {designation:string;department?:string;joiningDate:string}) {
  const user = await employee(id);
  if (!user) return;
  await notifyUser(id,{title:"Welcome to MyDesk",message:"Welcome to MyDesk. Your employee account has been created successfully.",
    type:"employee",module:MODULE.People,referenceId:id,targetUrl:profileUrl(user.role),dedupeKey:`employee:${id}:welcome`});
  const message = `Hello ${user.name},\n\nYour MyDesk employee account has been created successfully.\nEmployee ID: ${id}\nDepartment: ${details.department || "Not recorded"}\nDesignation: ${details.designation}\nJoining date: ${details.joiningDate}\nLogin email: ${user.email}\nTemporary password: ${temporaryPassword}\n\nPlease change this temporary password when you first sign in.`;
  try { await sendSensitiveEmail(user.email,"Your MyDesk Account Has Been Created",message,`${process.env.FRONTEND_URL || "http://localhost:5173"}/login`); }
  catch (error) { console.error("Welcome email delivery failed for employee ID",id,(error as Error).message); }
}

export async function adminPasswordResetNotice(id:number) {
  const user = await employee(id);
  if (user?.loginStatus === "Y" && user.status === "Active")
    await employeeNotice(id,"Password reset by administrator","Your MyDesk password has been reset by an administrator. Check your registered email and change your temporary password when you next sign in.",`employee:${id}:admin-reset:${Date.now()}`,false);
}

export async function passwordChangedNotice(id:number, version:number) {
  await employeeNotice(id,"MyDesk Password Changed Successfully","Your MyDesk password was changed successfully. If you did not make this change, please contact your administrator immediately.",`employee:${id}:password-changed:${version}`);
}

export async function resignationSubmitted(id:number, resignationId:number, actorId:number) {
  const user = await employee(id);
  if (!user) return;
  const message = `${user.name} submitted a resignation request.`;
  for (const recipient of await adminRecipients(MODULE.Dynamics)) {
    if (recipient.id === actorId) continue;
    const key = `resignation:${resignationId}:submitted:${recipient.id}`;
    await notifyUser(recipient.id,{title:"Resignation submitted",message,type:"resignation",module:MODULE.Dynamics,
      referenceId:resignationId,targetUrl:"/dynamics?tab=RESIGNATION",dedupeKey:key});
    await queueEmail(recipient.email,"Resignation submitted",message,"/dynamics?tab=RESIGNATION",`${key}:email`);
  }
}
