import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import puppeteer from "puppeteer";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
import { createNotification } from "../services/notificationService";

async function main() {
  const [users]: any = await pool.query("SELECT id,name,email,role,auth_version FROM tbl_users WHERE role='user' AND status='Active' AND loginStatus='Y' LIMIT 1");
  assert(users.length,"active employee required");
  const user=users[0];
  const token=jwt.sign({ id:user.id, role:user.role, authVersion:Number(user.auth_version)||0 },getJwtSecret(),{expiresIn:"5m"});
  const key=`browser-notification-test:${Date.now()}:${Math.random()}`;
  const secondKey=`${key}:second`;
  const title=`Browser notification test ${Date.now()}`;
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",args:["--no-sandbox","--disable-setuid-sandbox"]});
  try {
    await createNotification({userId:user.id,title,message:"Open leave history",type:"leave",module:"Attendance",referenceId:1,targetUrl:"/users/leaveRequests",dedupeKey:key});
    const page=await browser.newPage();
    await page.goto("http://localhost:5173/login",{waitUntil:"networkidle0"});
    await page.evaluate((account) => {
      const state={ currentUser:JSON.stringify(account),permissions:JSON.stringify([]),error:JSON.stringify(""),_persist:JSON.stringify({version:-1,rehydrated:true}) };
      sessionStorage.setItem("persist:root",JSON.stringify(state));
      sessionStorage.setItem("token",account.token);
    },{ id:user.id,userId:user.id,name:user.name,email:user.email,role:user.role,token,permissions:[] });
    await page.evaluateOnNewDocument(() => {
      const NativeAudioContext = window.AudioContext;
      (window as any).__notificationSounds = 0;
      (window as any).AudioContext = class extends NativeAudioContext {
        createOscillator() {
          const oscillator = super.createOscillator();
          const start = oscillator.start.bind(oscillator);
          oscillator.start = (...args: Parameters<OscillatorNode["start"]>) => {
            (window as any).__notificationSounds += 1;
            return start(...args);
          };
          return oscillator;
        }
      };
    });
    await page.goto("http://localhost:5173/users/attendance",{waitUntil:"domcontentloaded"});
    try { await page.waitForSelector('[aria-label="Notifications"]',{timeout:15000}); }
    catch (error) { console.error("Browser page:",page.url(),(await page.evaluate(() => document.body.innerText)).slice(0,500),"session:",await page.evaluate(() => ({ keys:Object.keys(JSON.parse(sessionStorage.getItem("persist:root") || "{}")), hasUser:!!JSON.parse(sessionStorage.getItem("persist:root") || "{}").currentUser, token:!!sessionStorage.getItem("token") })),"permissions status:",await page.evaluate(() => fetch("http://localhost:3002/api/me/permissions",{headers:{Authorization:`Bearer ${sessionStorage.getItem("token")}`}}).then((response) => response.status))); throw error; }
    await page.waitForFunction(() => !!document.querySelector('[aria-label="Notifications"] span'),{timeout:20000});
    await page.click('[aria-label="Notifications"]');
    await page.waitForFunction((text) => document.body.textContent?.includes(text),{timeout:10000},title);
    await page.click('[aria-label="Notifications"]');
    await page.waitForFunction((text) => !document.body.textContent?.includes(text),{timeout:10000},title);
    await page.click('[aria-label="Notifications"]');
    await page.evaluate((text) => { const button=Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(text)); button?.click(); },title);
    await page.waitForFunction(() => location.pathname === "/users/leaveRequests",{timeout:15000});
    let read = 0;
    for (let attempt=0; attempt<50; attempt++) {
      const [rows]: any = await pool.query("SELECT isRead FROM notifications WHERE dedupeKey=?",[key]);
      read = rows[0].isRead;
      if (read) break;
      await new Promise((resolve) => setTimeout(resolve,50));
    }
    assert.equal(read,1);
    assert.equal(await page.evaluate(() => (window as any).__notificationSounds),0,"old notifications should not play sound on initial load");
    await createNotification({userId:user.id,title:"New browser notification",message:"New event",type:"leave",module:"Attendance",referenceId:2,targetUrl:"/users/leaveRequests",dedupeKey:secondKey});
    await page.waitForFunction(() => (window as any).__notificationSounds === 1,{timeout:25000});
    await new Promise((resolve) => setTimeout(resolve,16000));
    assert.equal(await page.evaluate(() => (window as any).__notificationSounds),1,"polling should not replay sound");
    await page.reload({waitUntil:"domcontentloaded"});
    await page.waitForSelector('[aria-label="Notifications"]',{timeout:15000});
    await new Promise((resolve) => setTimeout(resolve,2500));
    assert.equal(await page.evaluate(() => (window as any).__notificationSounds),0,"refresh should not replay old unread sound");
    await page.click('[aria-label="Notifications"]');
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.body.textContent?.includes("New browser notification"),{timeout:5000});
    await page.click('[aria-label="Notifications"]');
    await page.evaluate(() => { const button=Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("Mark all read")); button?.click(); });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Notifications"] span'),{timeout:10000});
    await page.setViewport({width:375,height:812});
    await page.click('[aria-label="Notifications"]');
    await page.click('[aria-label="Notifications"]');
    const bounds=await page.evaluate(() => {
      const panel=document.querySelector('div[class*="md:absolute"][class*="md:w-"]');
      const rect=panel?.getBoundingClientRect();
      return rect ? {left:rect.left,right:rect.right,width:window.innerWidth} : null;
    });
    assert(bounds && bounds.left>=0 && bounds.right<=bounds.width+1,"mobile notification panel should fit viewport");
    console.log("Bell badge, toggle, Escape, navigation, read state, polling sound, refresh silence, mark-all, and mobile panel passed");
  } finally {
    await browser.close();
    await pool.query("DELETE FROM notifications WHERE dedupeKey IN (?,?)",[key,secondKey]);
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode=1; });
