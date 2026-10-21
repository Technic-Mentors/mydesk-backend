import assert from "node:assert/strict";
import net from "node:net";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";

async function main() {
  const suffix = `${Date.now()}${Math.floor(Math.random()*10000)}`;
  const email = `credential-test-${suffix}@example.invalid`;
  const messages:string[] = [];
  const smtp = net.createServer((socket) => {
    socket.write("220 localhost ESMTP test\r\n");
    let buffer="",mail="",data=false;
    socket.on("data",(chunk) => {
      buffer += chunk.toString();
      let end:number;
      while ((end=buffer.indexOf("\r\n"))>=0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if (data) {
          if (line===".") {messages.push(mail);mail="";data=false;socket.write("250 Queued\r\n");}
          else mail += `${line}\n`;
        } else if (/^EHLO |^HELO /i.test(line)) socket.write("250-localhost\r\n250 OK\r\n");
        else if (line==="DATA") {data=true;socket.write("354 End data\r\n");}
        else if (line==="QUIT") {socket.write("221 Bye\r\n");socket.end();}
        else socket.write("250 OK\r\n");
      }
    });
  });
  const prior={host:process.env.SMTP_HOST,port:process.env.SMTP_PORT,from:process.env.SMTP_FROM_EMAIL,user:process.env.SMTP_USERNAME,tls:process.env.SMTP_USE_TLS};
  let userId:number|undefined;
  let promotionId:number|undefined;
  let rejectedPromotionId:number|undefined;
  let resignationId:number|undefined;
  let http:ReturnType<typeof app.listen>|undefined;
  try {
    await new Promise<void>((resolve)=>smtp.listen(0,"127.0.0.1",resolve));
    const smtpAddress=smtp.address();assert(smtpAddress && typeof smtpAddress!=="string");
    process.env.SMTP_HOST="127.0.0.1";process.env.SMTP_PORT=String(smtpAddress.port);process.env.SMTP_FROM_EMAIL="MyDesk <mydesk@example.invalid>";process.env.SMTP_USE_TLS="false";delete process.env.SMTP_USERNAME;
    const [admins]:any=await pool.query("SELECT id,role,auth_version FROM tbl_users WHERE role='admin' AND status='Active' AND loginStatus='Y' LIMIT 1");
    assert(admins[0],"Active admin required");
    const adminToken=jwt.sign({id:admins[0].id,role:"admin",authVersion:Number(admins[0].auth_version)||0},getJwtSecret(),{expiresIn:"5m"});
    http=app.listen(0,"127.0.0.1");await new Promise<void>((resolve)=>http!.once("listening",resolve));
    const address=http.address();assert(address && typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
    const create=await fetch(`${base}/api/admin/addUser`,{method:"POST",headers:{Authorization:adminToken,"Content-Type":"application/json"},body:JSON.stringify({name:"Credential Test",email,contact:suffix.slice(-11).padStart(11,"7"),cnic:`9${suffix.slice(-12).padStart(12,"0")}`,address:"Test",date:"2026-01-01",role:"user",position:"Intern",department:"Engineering",reportingManager:"Test Manager"})});
    const created:any=await create.json();assert.equal(create.status,201,JSON.stringify(created));userId=created.userId;
    const [rows]:any=await pool.query("SELECT password,must_change_password,department,reporting_manager FROM tbl_users WHERE id=?",[userId]);
    assert.equal(rows[0].must_change_password,1);assert(rows[0].password.startsWith("$2"));assert.equal(rows[0].department,"Engineering");
    for (let attempt = 0; messages.length === 0 && attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(messages.length,1,"one welcome email");
    const mail=messages[0].replace(/=\n/g,"");
    const match=mail.match(/Temporary password:\s*([A-Za-z0-9_-]{24})/);
    assert(match,"temporary password was delivered");
    const temporary=match[1];assert(await bcrypt.compare(temporary,rows[0].password));
    assert(!JSON.stringify(created).includes(temporary));
    const login=await fetch(`${base}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:temporary})});
    const session:any=await login.json();assert.equal(login.status,200);assert.equal(session.mustChangePassword,true);
    assert.equal((await fetch(`${base}/api/user/dashboard`,{headers:{Authorization:session.token}})).status,403);
    const nextPassword="NewSecurePass9!";
    const change=await fetch(`${base}/api/changePassword`,{method:"PUT",headers:{Authorization:session.token,"Content-Type":"application/json"},body:JSON.stringify({currentPassword:temporary,newPassword:nextPassword,confirmPassword:nextPassword})});
    const changedSession:any=await change.json();assert.equal(change.status,200,JSON.stringify(changedSession));
    const [changed]:any=await pool.query("SELECT password,must_change_password FROM tbl_users WHERE id=?",[userId]);assert.equal(changed[0].must_change_password,0);assert(await bcrypt.compare(nextPassword,changed[0].password));
    assert.equal((await fetch(`${base}/api/user/dashboard`,{headers:{Authorization:session.token}})).status,403,"old token invalidated");
    assert.equal(typeof changedSession.token,"string","password change returns a new session token");
    assert.equal((await fetch(`${base}/api/user/dashboard`,{headers:{Authorization:changedSession.token}})).status,200,"new token opens the dashboard");
    const loginAgain=await fetch(`${base}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:nextPassword})});
    const newSession:any=await loginAgain.json();assert.equal(newSession.mustChangePassword,false);
    assert.equal((await fetch(`${base}/api/user/dashboard`,{headers:{Authorization:newSession.token}})).status,200);
    const requestReset=await fetch(`${base}/api/forgot-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
    assert.equal(requestReset.status,200);
    const resetMessage=messages.find((mail)=>mail.includes("Subject: Reset Your MyDesk Password"));
    assert(resetMessage,"reset link email delivered");
    const resetMail=resetMessage.replace(/=\n/g,"").replace(/=3D/g,"=");
    const tokenMatch=resetMail.match(/#token=([a-f0-9]{64})/);assert(tokenMatch,"reset link has token");
    const token=tokenMatch[1];
    const [storedTokens]:any=await pool.query("SELECT token_hash FROM password_reset_tokens WHERE user_id=? AND used_at IS NULL",[userId]);
    assert.equal(storedTokens.length,1);assert.notEqual(storedTokens[0].token_hash,token);
    const resetBody={token,password:"ResetSecurePass9!",confirmPassword:"ResetSecurePass9!"};
    const reset=await fetch(`${base}/api/reset-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(resetBody)});
    assert.equal(reset.status,200,await reset.text());
    assert.equal((await fetch(`${base}/api/reset-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(resetBody)})).status,400,"reset token is single-use");
    const afterResetLogin=await fetch(`${base}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:"ResetSecurePass9!"})});
    const afterResetSession:any=await afterResetLogin.json();assert.equal(afterResetLogin.status,200);
    const submitResignation=await fetch(`${base}/api/user/addResignation`,{method:"POST",headers:{Authorization:afterResetSession.token,"Content-Type":"application/json"},
      body:JSON.stringify({id:userId,designation:"Intern",note:"Test request",resignation_date:"2026-10-31"})});
    assert.equal(submitResignation.status,200,await submitResignation.text());
    const [resignations]:any=await pool.query("SELECT id FROM resignation WHERE employee_id=?",[userId]);resignationId=resignations[0].id;
    const [managerNotice]:any=await pool.query("SELECT id FROM notifications WHERE referenceId=? AND userId=? AND title='Resignation submitted'",[resignationId,admins[0].id]);
    assert.equal(managerNotice.length,1);
    const decision=await fetch(`${base}/api/updateResignation/${resignationId}`,{method:"PUT",headers:{Authorization:adminToken,"Content-Type":"application/json"},
      body:JSON.stringify({designation:"Intern",note:"Test request",resignation_date:"2026-10-31",approval_status:"REJECTED"})});
    assert.equal(decision.status,200,await decision.text());
    const [decisionEmails]:any=await pool.query("SELECT id FROM notification_email_outbox WHERE dedupeKey=?",[`resignation:${resignationId}:decision:REJECTED:email:${userId}`]);
    assert.equal(decisionEmails.length,1);
    const [promotionInsert]:any=await pool.query("INSERT INTO promotion (employee_id,employee_name,current_designation,requested_designation,note,date,approval) VALUES (?,?,?,?,?,CURRENT_DATE,'PENDING')",[userId,"Credential Test","Intern","Junior Developer","Test approval"]);
    promotionId=promotionInsert.insertId;
    const promotion=await fetch(`${base}/api/admin/updatePromotion/${promotionId}`,{method:"PUT",headers:{Authorization:adminToken,"Content-Type":"application/json"},
      body:JSON.stringify({current_designation:"Intern",requested_designation:"Junior Developer",note:"Test approval",date:"2026-10-07",approval:"ACCEPTED"})});
    assert.equal(promotion.status,200,await promotion.text());
    const [promotionEmails]:any=await pool.query("SELECT id FROM notification_email_outbox WHERE dedupeKey=?",[`promotion:${promotionId}:approved:email:${userId}`]);
    assert.equal(promotionEmails.length,1);
    const [approvalNotices]:any=await pool.query("SELECT id FROM notifications WHERE userId=? AND type='promotion' AND referenceId=? AND title='Promotion approved'",[userId,promotionId]);
    assert.equal(approvalNotices.length,1);
    const [rejectedInsert]:any=await pool.query("INSERT INTO promotion (employee_id,employee_name,current_designation,requested_designation,note,date,approval) VALUES (?,?,?,?,?,CURRENT_DATE,'PENDING')",[userId,"Credential Test","Junior Developer","Senior Developer","Test rejection"]);
    rejectedPromotionId=rejectedInsert.insertId;
    const rejection=await fetch(`${base}/api/admin/updatePromotion/${rejectedPromotionId}`,{method:"PUT",headers:{Authorization:adminToken,"Content-Type":"application/json"},
      body:JSON.stringify({current_designation:"Junior Developer",requested_designation:"Senior Developer",note:"Test rejection",date:"2026-10-08",approval:"REJECTED"})});
    assert.equal(rejection.status,200,await rejection.text());
    const [rejectionNotices]:any=await pool.query("SELECT id FROM notifications WHERE userId=? AND type='promotion' AND referenceId=? AND title='Promotion rejected'",[userId,rejectedPromotionId]);
    assert.equal(rejectionNotices.length,1);
    const [rejectionEmails]:any=await pool.query("SELECT id FROM notification_email_outbox WHERE dedupeKey=?",[`promotion:${rejectedPromotionId}:rejected:email:${userId}`]);
    assert.equal(rejectionEmails.length,1);
    for (let attempt=0; attempt<100 && !messages.some((mail)=>mail.includes("Subject: Promotion rejected")); attempt++)
      await new Promise((resolve)=>setTimeout(resolve,50));
    assert(messages.some((mail)=>mail.includes("Subject: Promotion approved")),"approval email delivered");
    assert(messages.some((mail)=>mail.includes("Subject: Promotion rejected")),"rejection email delivered");
    const adminReset=await fetch(`${base}/api/employees/${userId}/reset-password`,{method:"POST",headers:{Authorization:adminToken}});
    assert.equal(adminReset.status,200,await adminReset.text());
    const adminResetMessage=messages.find((mail)=>mail.includes("Subject: Your MyDesk Password Was Reset"));
    assert(adminResetMessage,"admin temporary password delivered");
    const [adminResetRow]:any=await pool.query("SELECT must_change_password FROM tbl_users WHERE id=?",[userId]);
    assert.equal(adminResetRow[0].must_change_password,1);
    const adminTemp=adminResetMessage.replace(/=\n/g,"").match(/Temporary password:\s*([A-Za-z0-9_-]{24})/);
    assert(adminTemp);
    const adminLogin=await fetch(`${base}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:adminTemp[1]})});
    const adminSession:any=await adminLogin.json();assert.equal(adminSession.mustChangePassword,true);
    const employeeEdit=await fetch(`${base}/api/admin/updateUser/${userId}`,{method:"PUT",headers:{Authorization:adminToken,"Content-Type":"application/json"},
      body:JSON.stringify({date:"2026-02-01",department:"Operations",reportingManager:"New Manager",position:"Senior Developer"})});
    assert.equal(employeeEdit.status,200,await employeeEdit.text());
    const [updatedInfo]:any=await pool.query("SELECT department,reporting_manager,DATE_FORMAT(date,'%Y-%m-%d') AS date FROM tbl_users WHERE id=?",[userId]);
    assert.deepEqual([updatedInfo[0].department,updatedInfo[0].reporting_manager,updatedInfo[0].date],["Operations","New Manager","2026-02-01"]);
    const [lifeline]:any=await pool.query("SELECT position FROM employee_lifeline WHERE employee_id=? ORDER BY id DESC LIMIT 1",[userId]);
    assert.equal(lifeline[0].position,"Senior Developer");
    const [infoNotices]:any=await pool.query("SELECT message FROM notifications WHERE userId=? AND title='Employee information updated'",[userId]);
    assert.equal(infoNotices.length,1);assert(infoNotices[0].message.includes("Department"));assert(infoNotices[0].message.includes("Designation"));
    const [infoEmails]:any=await pool.query("SELECT id FROM notification_email_outbox WHERE dedupeKey LIKE ?",[`employee:${userId}:information:%`]);
    assert.equal(infoEmails.length,1);
    console.log("Welcome, first-login gate, reset links, admin reset, employee updates, promotion and resignation passed");
  } finally {
    if (userId) {
      if (promotionId) await pool.query("DELETE FROM promotion WHERE id=?",[promotionId]);
      if (rejectedPromotionId) await pool.query("DELETE FROM promotion WHERE id=?",[rejectedPromotionId]);
      if (resignationId) await pool.query("DELETE FROM resignation WHERE id=?",[resignationId]);
      await pool.query("DELETE FROM notifications WHERE referenceId=? AND type='resignation'",[resignationId || 0]);
      await pool.query("DELETE FROM notification_email_outbox WHERE dedupeKey LIKE ?",[`resignation:${resignationId || 0}:%`]);
      await pool.query("DELETE FROM notification_email_outbox WHERE dedupeKey LIKE ?",[`promotion:${promotionId || 0}:%`]);
      await pool.query("DELETE FROM notification_email_outbox WHERE dedupeKey LIKE ?",[`promotion:${rejectedPromotionId || 0}:%`]);
      await pool.query("DELETE FROM notifications WHERE userId=?",[userId]);
      await pool.query("DELETE FROM notification_email_outbox WHERE dedupeKey LIKE ?",[`employee:${userId}:%`]);
      await pool.query("DELETE FROM password_reset_tokens WHERE user_id=?",[userId]);
      await pool.query("DELETE FROM employee_lifeline WHERE employee_id=?",[userId]);
      await pool.query("DELETE FROM tbl_users WHERE id=?",[userId]);
    }
    if (http) await new Promise<void>((resolve)=>http!.close(()=>resolve()));
    await new Promise<void>((resolve)=>smtp.close(()=>resolve()));
    for (const [name,value] of Object.entries({SMTP_HOST:prior.host,SMTP_PORT:prior.port,SMTP_FROM_EMAIL:prior.from,SMTP_USERNAME:prior.user,SMTP_USE_TLS:prior.tls})) {if(value===undefined) delete process.env[name];else process.env[name]=value;}
    await pool.end();
  }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
