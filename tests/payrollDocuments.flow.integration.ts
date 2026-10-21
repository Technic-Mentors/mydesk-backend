import assert from "node:assert/strict";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
dotenv.config();
const source=process.env.DB_NAME!;
if(!/^[A-Za-z0-9_]+$/.test(source)) throw new Error("Unsafe source database name");
const schema=`payroll_flow_test_${process.pid}`;
const client=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:source});
(async()=>{
 await client.query(`CREATE DATABASE \`${schema}\``);
 let testPool:any;
 try{
  for(const table of ["tbl_users","salarycycle","payroll_run_items","employee_lifeline","employee_accounts","business_variables","notifications","access_control","modules","payroll_documents","payroll_admin_deliveries","payroll_processing_settings","calendarsession","configempsalaries","withdrawals","attendance","leaves","holidays","loan","overtime","invoice_sequence"])
   await client.query(`CREATE TABLE \`${schema}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);
  await client.query(`INSERT INTO \`${schema}\`.payroll_processing_settings (id,rule_mode,cutoff_day) VALUES (1,'AFTER_MONTH_END',25)`);
  process.env.DB_NAME=schema;
  testPool=require("../database/db").default;
  const email=require("../services/emailService");
  const sent:any[]=[];let fail=false;
  email.sendAttachmentEmail=async(recipient:string,subject:string,message:string,url:string,attachments:any[])=>{
   if(fail&&subject.includes("November")&&(recipient==="employee3@example.invalid"||recipient==="admin@example.invalid"))throw new Error("Simulated SMTP failure");
   sent.push({recipient,subject,message,url,attachments});
  };
  const {processPayrollDocuments}=require("../services/payrollDocuments");
  await testPool.query("INSERT INTO tbl_users (id,email,password,name,role,status,loginStatus) VALUES (1,'admin@example.invalid','x','Admin','admin','Active','Y'),(2,'employee2@example.invalid','x','Employee Two','user','Active','Y'),(3,'employee3@example.invalid','x','Employee Three','user','Active','Y')");
  await testPool.query("INSERT INTO employee_lifeline (employee_id,employee_name,email,contact,position,date) VALUES (2,'Employee Two','employee2@example.invalid','0','Engineer','2025-01-01'),(3,'Employee Three','employee3@example.invalid','0','Designer','2025-01-01')");
  await testPool.query("INSERT INTO business_variables (name,email,contact,address,is_deleted) VALUES ('Technic Mentors','office@example.invalid','0000','Test address',0)");
  const seed=async(id:number,month:string)=>{
   await testPool.query("INSERT INTO salarycycle (id,calendar_session_id,session_name,year,month,status,run_date) VALUES (?,?,?,2026,?,'Completed',NOW())",[id,id,'2026',month]);
   for(const employee of [2,3]){
    await testPool.query("INSERT INTO payroll_run_items (calendar_session_id,employee_id,salary_config_id,paid_days,gross_salary,loan_deduction,overtime_amount,net_salary,scheduled_basic,scheduled_allowances,absence_deduction,working_days,overtime_hours,loan_balance_after) VALUES (?,?,1,25,50000,2000,500,48000,48000,3000,1000,31,2,8000)",[id,employee]);
    await testPool.query("INSERT INTO employee_accounts (employee_id,refNo,payment_date,balance,payment_method,debit,credit) VALUES (?,?,CURDATE(),48000,'Cash',48000,0)",[employee,`SALARY-${month}-2026-${employee}`]);
   }
  };
  await seed(1,'October');await processPayrollDocuments(1,1);
  const [docs1]:any=await testPool.query("SELECT document_key,email_status FROM payroll_documents WHERE salary_cycle_id=1");
  assert.equal(docs1.length,3);assert.ok(docs1.every((d:any)=>d.email_status==='Sent'));assert.equal(sent.length,3);
  assert.ok(sent.filter(m=>m.recipient.startsWith('employee')).every(m=>m.attachments.length===1&&m.attachments[0].filename.startsWith('Payslip-')));
  assert.equal(sent.find(m=>m.recipient==='admin@example.invalid').attachments.length,3);
  await processPayrollDocuments(1,1);assert.equal(sent.length,3,'repeat must not resend');
  await testPool.query("UPDATE payroll_documents SET email_status='Sending',email_claimed_at=DATE_SUB(NOW(),INTERVAL 20 MINUTE),email_sent_at=NULL WHERE salary_cycle_id=1 AND document_key='employee:2'");
  const sentBeforeRecovery=sent.length;
  const {recoverPayrollDocuments}=require('../services/payrollDocuments');
  await recoverPayrollDocuments();
  const [interrupted]:any=await testPool.query("SELECT email_status,email_error FROM payroll_documents WHERE salary_cycle_id=1 AND document_key='employee:2'");
  assert.equal(interrupted[0].email_status,'Failed');assert.match(interrupted[0].email_error,/unconfirmed/);assert.equal(sent.length,sentBeforeRecovery,'recovery must not resend unconfirmed email');
  const [interruptedDoc]:any=await testPool.query("SELECT id FROM payroll_documents WHERE salary_cycle_id=1 AND document_key='employee:2'");
  const {resendEmployeePayslip}=require('../services/payrollDocuments');
  await resendEmployeePayslip(interruptedDoc[0].id);
  assert.equal(sent.length,sentBeforeRecovery+1,'explicit retry sends only interrupted email');
  const {resendAdminPayrollSummary}=require('../services/payrollDocuments');
  const beforeAdminResend=sent.length;
  await resendAdminPayrollSummary(1,1);
  assert.equal(sent.length,beforeAdminResend+1,'explicit Admin resend sends one summary');
  assert.equal(sent[sent.length-1].recipient,'admin@example.invalid');
  const [notes1]:any=await testPool.query("SELECT userId,type FROM notifications");assert.ok(notes1.some((n:any)=>n.userId===2&&n.type==='PAYSLIP_SENT'));assert.ok(notes1.some((n:any)=>n.userId===1&&n.type==='PAYROLL_SUMMARY_SENT'));assert.ok(notes1.some((n:any)=>n.userId===2&&n.type==='LOAN_DEDUCTED'));
  await seed(2,'November');fail=true;await processPayrollDocuments(2,1);
  const [failed]:any=await testPool.query("SELECT document_key,email_status FROM payroll_documents WHERE salary_cycle_id=2");
  assert.equal(failed.find((d:any)=>d.document_key==='employee:3').email_status,'Failed');
  assert.equal(failed.find((d:any)=>d.document_key==='summary').email_status,'Failed');
  const [adminFailure]:any=await testPool.query("SELECT status FROM payroll_admin_deliveries WHERE salary_cycle_id=2 AND recipient_id=1");assert.equal(adminFailure[0].status,'Failed');
  const [falseNotice]:any=await testPool.query("SELECT type FROM notifications WHERE userId=3 AND referenceId=2 AND type='PAYSLIP_SENT'");assert.equal(falseNotice.length,0);
  fail=false;await processPayrollDocuments(2,1,true);
  const [recovered]:any=await testPool.query("SELECT email_status FROM payroll_documents WHERE salary_cycle_id=2");assert.ok(recovered.every((d:any)=>d.email_status==='Sent'));
  const count=sent.length;await processPayrollDocuments(2,1,true);assert.equal(sent.length,count,'retry must not resend sent mail');
  await testPool.query("INSERT INTO calendarsession (id,year,month,calendarStatus,session_name) VALUES (3,2025,'October','Active','2025')");
  for(const employee of [2,3]) await testPool.query("INSERT INTO configempsalaries (employee_id,salary_amount,emp_of_mon_allowance,transport_allowance,medical_allowance,total_salary,config_date,effective_from,salary_month,attendance_base,status) VALUES (?,1000,100,0,0,1100,'2025-10-01','2025-10-01','October','N','ACTIVE')",[employee]);
  const {runSalaryCycle}=require("../controllers/salaryCycle.controller");
  let responseCode=200,responseBody:any;
  await runSalaryCycle({body:{year:2025,month:'October'},user:{id:1,role:'admin'}} as any,{status(n:number){responseCode=n;return this},json(body:any){responseBody=body;return this}} as any);
  assert.equal(responseCode,200,JSON.stringify(responseBody));
  assert.equal(responseBody.processedEmployees,2);
  const actualId=responseBody.salaryCycleId;
  let complete=false;
  for(let i=0;i<120;i++){
    const [progress]:any=await testPool.query("SELECT COUNT(*) AS n FROM payroll_documents WHERE salary_cycle_id=? AND email_status='Sent'",[actualId]);
    const [mail]:any=await testPool.query("SELECT COUNT(*) AS n FROM payroll_admin_deliveries WHERE salary_cycle_id=? AND status='Sent'",[actualId]);
    if(progress[0].n===3&&mail[0].n===1){complete=true;break}
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(complete,'Salary Cycle post-commit PDFs and delivery did not complete');
  const [cycleRows]:any=await testPool.query("SELECT status FROM salarycycle WHERE id=?",[actualId]);assert.equal(cycleRows[0].status,'Completed');
  const [payRows]:any=await testPool.query("SELECT COUNT(*) AS n FROM payroll_run_items WHERE calendar_session_id=3");assert.equal(payRows[0].n,2);
  const [sequence]:any=await testPool.query("SELECT employee_acc_no FROM invoice_sequence WHERE id=1");assert.equal(sequence[0].employee_acc_no,2);
  const mailBeforeDuplicate=sent.length;
  let duplicateCode=200;
  await runSalaryCycle({body:{year:2025,month:'October'},user:{id:1,role:'admin'}} as any,{status(n:number){duplicateCode=n;return this},json(){return this}} as any);
  assert.equal(duplicateCode,409);assert.equal(sent.length,mailBeforeDuplicate);
  console.log('Isolated full chain: Salary Cycle commit, snapshots, PDFs, employee emails, Admin email and notifications passed');  console.log('Isolated payroll flow: PDFs, employee/Admin mail attachments, notifications, SMTP failures, retry and dedupe passed');
 } finally {if(testPool)await testPool.end();process.env.DB_NAME=source;await client.query(`DROP DATABASE \`${schema}\``);await client.end()}
})().catch(e=>{console.error(e);process.exitCode=1});

