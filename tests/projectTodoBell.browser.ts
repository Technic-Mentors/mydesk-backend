import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import puppeteer from "puppeteer";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
import { createNotification } from "../services/notificationService";

async function main() {
  const [rows]: any = await pool.query(
    `SELECT u.id,u.name,u.email,u.role,u.auth_version,ap.projectId,t.id AS todoId
     FROM tbl_users u JOIN assignedprojects ap ON ap.employee_id=u.id AND ap.assignStatus='Y'
     JOIN todo t ON t.employee_id=u.id AND t.todoStatus='Y'
     WHERE u.role='user' AND u.status='Active' AND u.loginStatus='Y' LIMIT 1`);
  assert(rows.length,"an active employee with a project and Todo is required");
  const user=rows[0];
  const [admins]: any = await pool.query("SELECT id,name,email,role,auth_version FROM tbl_users WHERE role='admin' AND status='Active' AND loginStatus='Y' LIMIT 1");
  assert(admins.length,"active admin required");
  const admin=admins[0];
  const token=jwt.sign({id:user.id,role:user.role,authVersion:Number(user.auth_version)||0},getJwtSecret(),{expiresIn:"5m"});
  const key=`project-todo-browser:${Date.now()}:${Math.random()}`;
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",args:["--no-sandbox","--disable-setuid-sandbox"]});
  try {
    await createNotification({userId:user.id,title:"Project link test",message:"Open assigned project",type:"project",module:"Projects",referenceId:user.projectId,targetUrl:`/users/assignedprojects?projectId=${user.projectId}`,dedupeKey:`${key}:project`});
    await createNotification({userId:user.id,title:"Todo link test",message:"Open assigned Todo",type:"todo",module:"Performance",referenceId:user.todoId,targetUrl:`/users/todo?todoId=${user.todoId}`,dedupeKey:`${key}:todo`});
    const page=await browser.newPage();
    await page.goto("http://localhost:5173/login",{waitUntil:"networkidle0"});
    await page.evaluate((account) => {
      sessionStorage.setItem("persist:root",JSON.stringify({currentUser:JSON.stringify(account),permissions:JSON.stringify([]),error:JSON.stringify(""),_persist:JSON.stringify({version:-1,rehydrated:true})}));
      sessionStorage.setItem("token",account.token);
    },{id:user.id,userId:user.id,name:user.name,email:user.email,role:user.role,token,permissions:[]});
    await page.evaluateOnNewDocument(() => {
      const NativeAudioContext=window.AudioContext;
      (window as any).__projectTodoSounds=0;
      (window as any).AudioContext=class extends NativeAudioContext {
        createOscillator() {
          const oscillator=super.createOscillator();
          const start=oscillator.start.bind(oscillator);
          oscillator.start=(...args: Parameters<OscillatorNode["start"]>) => {
            (window as any).__projectTodoSounds+=1;
            return start(...args);
          };
          return oscillator;
        }
      };
    });
    await page.goto("http://localhost:5173/users/attendance",{waitUntil:"domcontentloaded"});
    await page.waitForSelector('[aria-label="Notifications"]',{timeout:15000});
    await page.click('[aria-label="Notifications"]');
    await page.waitForFunction(() => document.body.innerText.includes("Project link test"),{timeout:10000});
    await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Project link test"))?.click());
    await page.waitForFunction(() => location.pathname === "/users/assignedprojects" && document.body.innerText.includes("VIEW PROJECT DETAILS"),{timeout:15000});
    await page.click('[aria-label="Close form"]');
    await page.click('[aria-label="Notifications"]');
    await page.waitForFunction(() => document.body.innerText.includes("Todo link test"),{timeout:10000});
    await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Todo link test"))?.click());
    await page.waitForFunction(() => location.pathname === "/users/todo" && document.body.innerText.includes("VIEW TODO DETAILS"),{timeout:15000});
    for (let attempt=0;attempt<50;attempt++) {
      const [saved]: any = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE dedupeKey IN (?,?) AND isRead=1",[`${key}:project`,`${key}:todo`]);
      if (saved[0].n===2) break;
      await new Promise((resolve)=>setTimeout(resolve,50));
    }
    const [saved]: any = await pool.query("SELECT COUNT(*) AS n FROM notifications WHERE dedupeKey IN (?,?) AND isRead=1",[`${key}:project`,`${key}:todo`]);
    assert.equal(saved[0].n,2);
    assert.equal(await page.evaluate(() => (window as any).__projectTodoSounds),0,"old notifications must not ring on initial load");
    await createNotification({userId:user.id,title:"New project sound test",message:"New project event",type:"project",module:"Projects",referenceId:user.projectId,targetUrl:`/users/assignedprojects?projectId=${user.projectId}`,dedupeKey:`${key}:sound`});
    await page.waitForFunction(() => (window as any).__projectTodoSounds===1,{timeout:25000});
    await page.reload({waitUntil:"domcontentloaded"});
    await page.waitForSelector('[aria-label="Notifications"]',{timeout:15000});
    await new Promise((resolve)=>setTimeout(resolve,2000));
    assert.equal(await page.evaluate(() => (window as any).__projectTodoSounds),0,"refresh must not replay the Project sound");
    await createNotification({userId:admin.id,title:"Manager project link test",message:"Open project details",type:"project",module:"Projects",referenceId:user.projectId,targetUrl:`/projects?tab=DETAILS&projectId=${user.projectId}`,dedupeKey:`${key}:admin`});
    const adminToken=jwt.sign({id:admin.id,role:admin.role,authVersion:Number(admin.auth_version)||0},getJwtSecret(),{expiresIn:"5m"});
    const adminPage=await browser.newPage();
    await adminPage.goto("http://localhost:5173/login",{waitUntil:"networkidle0"});
    await adminPage.evaluate((account) => {
      sessionStorage.setItem("persist:root",JSON.stringify({currentUser:JSON.stringify(account),permissions:JSON.stringify([]),error:JSON.stringify(""),_persist:JSON.stringify({version:-1,rehydrated:true})}));
      sessionStorage.setItem("token",account.token);
    },{id:admin.id,userId:admin.id,name:admin.name,email:admin.email,role:admin.role,token:adminToken,permissions:[]});
    await adminPage.goto("http://localhost:5173/projects?tab=DETAILS",{waitUntil:"domcontentloaded"});
    await adminPage.waitForSelector('[aria-label="Notifications"]',{timeout:15000});
    await adminPage.click('[aria-label="Notifications"]');
    await adminPage.waitForFunction(() => document.body.innerText.includes("Manager project link test"),{timeout:10000});
    await adminPage.evaluate(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Manager project link test"))?.click());
    await adminPage.waitForFunction(() => location.pathname === "/projects" && document.body.innerText.includes("VIEW PROJECT DETAILS"),{timeout:15000});
    console.log("Employee Project/Todo and manager Project detail links, read state, one new Project sound, and refresh silence passed");
  } finally {
    await browser.close();
    await pool.query("DELETE FROM notifications WHERE dedupeKey IN (?,?,?,?)",[`${key}:project`,`${key}:todo`,`${key}:sound`,`${key}:admin`]);
    await pool.end();
  }
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
