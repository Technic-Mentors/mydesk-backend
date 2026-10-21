import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
(async()=>{
 const [docs]:any=await pool.query("SELECT pd.id,pd.employee_id,pd.document_key FROM payroll_documents pd WHERE pd.pdf IS NOT NULL ORDER BY pd.id");
 const [users]:any=await pool.query("SELECT id,role,auth_version FROM tbl_users WHERE status='Active' AND loginStatus='Y' AND role IN ('admin','user')");
 const admin=users.find((u:any)=>u.role==='admin');
 const own=docs.find((d:any)=>d.employee_id&&users.some((u:any)=>u.id===d.employee_id&&u.role==='user'));
 const other=users.find((u:any)=>u.role==='user'&&u.id!==own?.employee_id);
 const summary=docs.find((d:any)=>d.document_key==='summary');
 assert(admin&&own&&other&&summary,'Need live documents and two active employees for secure download check');
 const token=(u:any)=>jwt.sign({id:u.id,role:u.role,authVersion:Number(u.auth_version)||0},getJwtSecret(),{expiresIn:'5m'});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const address=server.address();assert(address&&typeof address!=='string');const root=`http://127.0.0.1:${address.port}`;
  const get=(path:string,u?:any)=>fetch(root+path,{headers:u?{Authorization:`Bearer ${token(u)}`}:{}});
  const ownUser=users.find((u:any)=>u.id===own.employee_id);
  const ownPdf=await get(`/api/payroll/documents/${own.id}/download`,ownUser);assert.equal(ownPdf.status,200);assert.equal(Buffer.from(await ownPdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  assert.equal((await get(`/api/payroll/documents/${own.id}/download`,other)).status,403);
  assert.equal((await get(`/api/payroll/documents/${summary.id}/download`,ownUser)).status,403);
  assert.equal((await get(`/api/payroll/documents/${summary.id}/download`)).status,401);
  const adminPdf=await get(`/api/payroll/documents/${summary.id}/download`,admin);assert.equal(adminPdf.status,200);assert.equal(Buffer.from(await adminPdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  const list=await get('/api/payroll/documents',ownUser);assert.equal(list.status,200);const data:any=await list.json();assert.ok(data.documents.every((d:any)=>d.employee_id===own.employee_id));
  console.log('Live PDF access: owner and Admin download, cross-employee and summary access denied');
 }finally{await new Promise<void>(r=>server.close(()=>r()))}
 await pool.end();
})().catch(e=>{console.error(e);process.exitCode=1});
