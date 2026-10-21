import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import * as email from "../services/emailService";
import { getJwtSecret } from "../config/jwtSecret";
import { processOverdueTodos } from "../services/projectTodoEvents";

async function main() {
  const [users]: any = await pool.query("SELECT id,role,auth_version FROM tbl_users WHERE status='Active' AND loginStatus='Y' AND role IN ('admin','user')");
  const admin=users.find((user: any)=>user.role==='admin');
  const employee=users.find((user: any)=>user.role==='user');
  assert(admin && employee,"active admin and employee required");
  const token=jwt.sign({id:admin.id,role:admin.role,authVersion:Number(admin.auth_version)||0},getJwtSecret(),{expiresIn:"5m"});
  const projectName=`Notification test project ${Date.now()}`;
  const task=`Notification test Todo ${Date.now()}`;
  const future=new Date(Date.now()+40*86400000).toISOString().slice(0,10);
  const later=new Date(Date.now()+42*86400000).toISOString().slice(0,10);
  const latest=new Date(Date.now()+45*86400000).toISOString().slice(0,10);
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const today=new Date().toISOString().slice(0,10);
  let projectId=0;
  let todoId=0;
  const deliveries: string[]=[];
  const originalEmail=email.queueEmail;
  (email as any).queueEmail=async (_recipient:string,_subject:string,_message:string,_url:string,key:string) => {
    deliveries.push(key);
    if (key.startsWith("todo:") && key.includes(":assigned:")) throw new Error("Simulated SMTP failure");
  };
  const server=app.listen(0,"127.0.0.1");
  try {
    await new Promise<void>((resolve)=>server.once("listening",resolve));
    const address=server.address(); assert(address && typeof address!=="string");
    const base=`http://127.0.0.1:${address.port}`;
    const request=async (path:string,method:string,body:object) => {
      const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await response.json();
      return {status:response.status,data};
    };
    const createdProject=await request("/api/admin/addProject","POST",{projectName,projectCategory:"Notification Test",description:"Temporary integration test",startDate:future,completionStatus:"New"});
    assert.equal(createdProject.status,201,JSON.stringify(createdProject.data));
    const [projectRows]: any=await pool.query("SELECT id FROM projects WHERE projectName=?",[projectName]);
    projectId=projectRows[0].id;
    const assignments=await Promise.all([
      request("/api/admin/assignProject","POST",{employee_id:employee.id,projectId}),
      request("/api/admin/assignProject","POST",{employee_id:employee.id,projectId}),
    ]);
    const assigned=assignments.find((result)=>result.status===201);
    assert(assigned,"one concurrent project assignment should succeed");
    assert(assignments.some((result)=>[400,409].includes(result.status)),"other concurrent assignment should be rejected");
    const repeat=await request("/api/admin/assignProject","POST",{employee_id:employee.id,projectId});
    assert.equal(repeat.status,400);
    const changedProject=await request(`/api/admin/updateProjectStatus/${projectId}`,"PATCH",{completionStatus:"Completed"});
    assert.equal(changedProject.status,200,JSON.stringify(changedProject.data));
    const unchangedProject=await request(`/api/admin/updateProjectStatus/${projectId}`,"PATCH",{completionStatus:"Completed"});
    assert.equal(unchangedProject.status,200);
    assert.equal(deliveries.length,2,"repeating an unchanged status must not queue another email");
    const editedProject=await request(`/api/admin/updateProject/${projectId}`,"PUT",{projectName,projectCategory:"Notification Test",description:"Temporary integration test",startDate:future,completionStatus:"Working"});
    assert.equal(editedProject.status,200,JSON.stringify(editedProject.data));
    const removedAssignment=await request(`/api/admin/unassignProject/${assigned.data.id}`,"PATCH",{});
    assert.equal(removedAssignment.status,200,JSON.stringify(removedAssignment.data));
    const createdTodos=await Promise.all([
      request("/api/admin/createTodo","POST",{employee_id:employee.id,task,note:"Temporary",startDate:future,endDate:later,deadline:later,completionStatus:"Pending"}),
      request("/api/admin/createTodo","POST",{employee_id:employee.id,task,note:"Temporary",startDate:future,endDate:later,deadline:later,completionStatus:"Pending"}),
    ]);
    assert(createdTodos.some((result)=>result.status===201),"one concurrent Todo should succeed");
    assert(createdTodos.some((result)=>[400,409].includes(result.status)),"other concurrent Todo should be rejected");
    const [todoRows]: any=await pool.query("SELECT id FROM todo WHERE task=?",[task]);
    todoId=todoRows[0].id;
    const updatedTodo=await request(`/api/admin/updateTodo/${todoId}`,"PUT",{employee_id:employee.id,task,note:"Temporary",startDate:future,endDate:later,deadline:latest,completionStatus:"Completed"});
    assert.equal(updatedTodo.status,200,JSON.stringify(updatedTodo.data));
    const [notices]: any=await pool.query("SELECT type,message,targetUrl FROM notifications WHERE (module='Projects' AND referenceId=?) OR (module='Performance' AND referenceId=?)",[projectId,todoId]);
    assert(notices.some((notice: any)=>notice.message.includes("assigned to project") && notice.targetUrl.includes(`projectId=${projectId}`)));
    assert(notices.some((notice: any)=>notice.message.includes("removed from project")));
    assert(notices.some((notice: any)=>notice.message.includes("status changed") && notice.type==="project"));
    assert(notices.some((notice: any)=>notice.message.includes("assigned a new Todo") && notice.targetUrl.includes(`todoId=${todoId}`)));
    assert(notices.some((notice: any)=>notice.message.includes("status changed") && notice.type==="todo"));
    assert(notices.some((notice: any)=>notice.message.includes("due date changed")));
    assert.equal(deliveries.length,6,"assignment, two project status changes, removal, Todo assignment, and due change should queue email once");
    await pool.query("UPDATE todo SET deadline=?,completionStatus='Pending' WHERE id=?",[yesterday,todoId]);
    await processOverdueTodos(today,todoId);
    await processOverdueTodos(today,todoId);
    const [overdue]: any=await pool.query("SELECT userId FROM notifications WHERE module='Performance' AND referenceId=? AND dedupeKey LIKE ?",[todoId,`todo:${todoId}:overdue:%`]);
    assert.equal(overdue.length,2,"employee and creator should each receive one overdue notice");
    console.log("Project/Todo HTTP actions, email queuing, status/due notices, failed duplicate assignment, and overdue deduplication passed (outbound email stubbed)");
  } finally {
    (email as any).queueEmail=originalEmail;
    if (todoId) {
      await pool.query("DELETE FROM notifications WHERE module='Performance' AND referenceId=?",[todoId]);
      await pool.query("DELETE FROM todo WHERE id=?",[todoId]);
    }
    if (projectId) {
      await pool.query("DELETE FROM notifications WHERE module='Projects' AND referenceId=?",[projectId]);
      await pool.query("DELETE FROM assignedprojects WHERE projectId=?",[projectId]);
      await pool.query("DELETE FROM projects WHERE id=?",[projectId]);
    }
    await new Promise<void>((resolve)=>server.close(()=>resolve()));
    await pool.end();
  }
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
