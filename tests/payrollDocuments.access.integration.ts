import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
(async()=>{
 const [users]:any=await pool.query("SELECT id,role,auth_version FROM tbl_users WHERE status='Active' AND loginStatus='Y' AND role IN ('admin','user')");
 const admin=users.find((u:any)=>u.role==='admin'), employee=users.find((u:any)=>u.role==='user');assert(admin&&employee);
 const token=(u:any)=>jwt.sign({id:u.id,role:u.role,authVersion:Number(u.auth_version)||0},getJwtSecret(),{expiresIn:'5m'});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const a=server.address();assert(a&&typeof a!=='string');const base=`http://127.0.0.1:${a.port}`;
  const status=async(path:string,u?:any,method='GET')=>{const r=await fetch(base+path,{method,headers:u?{Authorization:`Bearer ${token(u)}`}:{}});await r.arrayBuffer();return r.status};
  assert.equal(await status('/api/payroll/documents'),401);
  assert.equal(await status('/api/payroll/documents',employee),200);
  assert.equal(await status('/api/payroll/documents',admin),200);
  assert.equal(await status('/api/payroll/documents/99999999/download',employee),404);
  assert.equal(await status('/api/payroll/cycles/99999999/retry-delivery',employee,'POST'),403);
  assert.equal(await status('/api/payroll/documents/99999999/resend',employee,'POST'),403);
  assert.equal(await status('/api/payroll/cycles/99999999/resend-summary',employee,'POST'),403);
 }finally{await new Promise<void>(r=>server.close(()=>r()))}
 /* Download endpoint was removed: payslips are delivered only by email. */
 await pool.end();
 console.log('Payroll documents: anonymous blocked, employee list scoped, PDF download endpoint removed');
})().catch(e=>{console.error(e);process.exitCode=1});
