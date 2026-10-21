import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import puppeteer from "puppeteer";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
(async()=>{
 const [users]:any=await pool.query("SELECT id,role,name,email,auth_version FROM tbl_users WHERE status='Active' AND loginStatus='Y' AND role IN ('admin','user')");
 const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox"]});
 const results:any[]=[];
 try{for(const role of ['admin','user']){
  const u=users.find((v:any)=>v.role===role);assert(u,`active ${role} required`);
  const token=jwt.sign({id:u.id,role:u.role,authVersion:Number(u.auth_version)||0},getJwtSecret(),{expiresIn:'10m'});
  const user={id:u.id,userId:u.id,role:u.role,name:u.name,email:u.email,token,permissions:role==='admin'?['Payroll','Reports']:[]};
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(String(e?.message||e)));
  await page.evaluateOnNewDocument((payload:any)=>{localStorage.setItem('mydesk-remember-me','true');localStorage.setItem('token',payload.token);localStorage.setItem('persist:root',JSON.stringify({currentUser:JSON.stringify(payload.user),permissions:JSON.stringify(payload.user.permissions),error:JSON.stringify(''),_persist:JSON.stringify({version:-1,rehydrated:true})}))},{token,user});
  await page.setRequestInterception(true);
  page.on('request',r=>{if(r.url().includes('/api/payroll/documents')&&!r.url().includes('/download')){const doc={id:9001,salary_cycle_id:7001,employee_id:role==='admin'?u.id:u.id,document_key:'employee:'+u.id,generated_at:new Date().toISOString(),email_status:'Sent',email_sent_at:null,email_error:null,year:2026,month:'October',employee_name:'Example Employee with a Very Long Name',available:1};r.respond({status:200,contentType:'application/json',body:JSON.stringify({documents:role==='admin'?[{...doc,id:9002,employee_id:null,document_key:'summary'},doc]:[doc],adminDeliveries:[]})})}else r.continue()});
  for(const width of [1920,1366,1024,768,430,390,375]){
   await page.setViewport({width,height:900,deviceScaleFactor:1});
   await page.goto(`http://127.0.0.1:5173${role==='admin'?'/payroll?tab=SALARY_CYCLE':'/user/salarydetail?cycleId=7001'}`,{waitUntil:'domcontentloaded',timeout:30000});
   if(role==='admin'){await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent?.includes('Payslips & Summary')),{timeout:15000});await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Payslips & Summary'));b?.click()})}
   await page.waitForFunction(()=>document.body.textContent?.includes('Example Employee with a Very Long Name'),{timeout:15000});
   const info=await page.evaluate(()=>{const panel=[...document.querySelectorAll('h2')].find(h=>h.textContent?.includes('Payroll PDFs')||h.textContent?.includes('My Payslips'))?.closest('div.w-full');const rect=panel?.getBoundingClientRect();return {panelLeft:rect?.left||0,panelRight:rect?.right||0,overflow:document.documentElement.scrollWidth-window.innerWidth,buttons:[...panel!.querySelectorAll('button')].filter(b=>b.textContent?.includes('Download')).length}});
   assert(info.panelLeft>=0&&info.panelRight<=width+1,`${role} panel clipped at ${width}: ${JSON.stringify(info)}`);
   assert(info.overflow<=1,`${role} horizontal overflow at ${width}: ${JSON.stringify(info)}`);
   assert(info.buttons>0,`${role} download missing at ${width}`);
   results.push({role,width,...info});
  }
  assert.equal(errors.length,0,`${role} page errors: ${errors.join('; ')}`);await page.close();
 }}finally{await browser.close();await pool.end()}
 console.log(JSON.stringify(results));
 console.log('Payroll document UI: seven viewport widths, employee/Admin panels, download controls passed');
})().catch(e=>{console.error(e);process.exitCode=1});







