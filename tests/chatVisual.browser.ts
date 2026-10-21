import assert from "node:assert/strict";
import path from "node:path";
import jwt from "jsonwebtoken";
import puppeteer from "puppeteer";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";

async function main() {
  const [users]: any = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.auth_version
    FROM tbl_users u JOIN chat_participants p ON p.user_id=u.id
    WHERE u.status='Active' AND u.loginStatus='Y' ORDER BY (LOWER(u.role)='user') DESC LIMIT 1`);
  assert(users.length, "an active user with a chat is required");
  const user = users[0];
  const token = jwt.sign({ id:user.id,role:user.role,authVersion:Number(user.auth_version)||0 },getJwtSecret(),{ expiresIn:"5m" });
  const browser = await puppeteer.launch({ headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",args:["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width:1440,height:900,deviceScaleFactor:1 });
    await page.goto("http://localhost:5173/login",{ waitUntil:"networkidle0" });
    await page.evaluate((account) => {
      sessionStorage.setItem("persist:root",JSON.stringify({ currentUser:JSON.stringify(account),permissions:JSON.stringify([]),error:JSON.stringify(""),_persist:JSON.stringify({ version:-1,rehydrated:true }) }));
      sessionStorage.setItem("token",account.token);
    },{ id:user.id,userId:user.id,name:user.name,email:user.email,role:user.role,token,permissions:[] });
    await page.goto("http://localhost:5173/chat",{ waitUntil:"networkidle0" });
    try { await page.waitForSelector(".mdchat-list-item",{ timeout:15000 }); }
    catch (error) {
      console.error("Chat page:",page.url(),(await page.evaluate(() => document.body.innerText)).slice(0,500));
      console.error("Chat API status:",await page.evaluate(() => fetch("http://localhost:3002/api/chat/conversations",{ headers:{ Authorization:"Bearer " + sessionStorage.getItem("token") } }).then((response) => response.status)));
      throw error;
    }
    assert(await page.$('[aria-label="Main navigation"]'),"chat should show the application sidebar");
    assert(await page.$('[aria-label="Toggle sidebar"]'),"chat should show the sidebar burger");
    await page.click('[aria-label="Toggle sidebar"]');
    await page.waitForFunction(() => document.querySelector('[aria-label="Main navigation"]')!.getBoundingClientRect().width > 190);
    await page.click('[aria-label="Toggle sidebar"]');
    assert(await page.$(".mdchat-conversations"));
    assert(await page.$(".mdchat-main"));
    await page.click(".mdchat-list-item");
    await page.waitForSelector(".mdchat-main-header",{ timeout:10000 });
    const reactionGap = await page.$eval(".mdchat-reactions:has(button)",(element) => { const bubble=element.parentElement!.querySelector(".mdchat-bubble")!; return element.getBoundingClientRect().top-bubble.getBoundingClientRect().bottom; }).catch(() => null);
    if (reactionGap !== null) assert(reactionGap >= 0 && reactionGap <= 6,"reaction counts should sit directly below the message bubble");
    const avatar = await page.$eval(".mdchat-main-header .mdchat-avatar",(element) => ({ width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height }));
    assert.equal(avatar.width,avatar.height,"chat avatar should be circular");
    await page.click('[aria-label="Choose emoji"]');
    assert(await page.$eval(".mdchat-emoji-picker",(element) => element.textContent?.includes(String.fromCodePoint(0x1f600))));
    await page.click('[aria-label="Choose emoji"]');
    const messageNodes = await page.$$(".mdchat-message");
    if (messageNodes.length) {
      const bubble = await messageNodes[messageNodes.length - 1].$(".mdchat-bubble");
      assert(bubble);
      await bubble.hover();
      await page.waitForSelector(".mdchat-message-actions",{ timeout:5000 });
      assert.equal(await page.$$eval(".mdchat-hover-reactions button",(buttons) => buttons.length),6,"emoji choices should appear in the message hover toolbar");
      const hoverBar = await page.$eval(".mdchat-message-actions",(element) => ({ parent:element.parentElement === document.body,left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom }));
      assert(hoverBar.parent && hoverBar.left >= 0 && hoverBar.right <= 1440,"hover reactions should stay inside the screen");
      const latestRect = await bubble.boundingBox();
      assert(latestRect);
      assert(hoverBar.right <= latestRect.x - 4 || hoverBar.left >= latestRect.x + latestRect.width + 4 || hoverBar.bottom <= latestRect.y - 4 || hoverBar.top >= latestRect.y + latestRect.height + 4,"hover reactions should not cover the latest message");
      const incoming = await page.$(".mdchat-message:not(.mine) .mdchat-bubble");
      if (incoming) {
        await incoming.hover();
        const incomingRect = await incoming.boundingBox();
        assert(incomingRect);
        await page.mouse.move(incomingRect.x + incomingRect.width/2 + 5,incomingRect.y + incomingRect.height/2);
        await page.waitForSelector(".mdchat-message-actions",{ timeout:5000 });
        const incomingBar = await page.$eval(".mdchat-message-actions",(element) => ({ left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom,bounds:document.querySelector(".mdchat-message-scroll")!.getBoundingClientRect().right }));
        assert(incomingBar.left >= 0 && incomingBar.right <= incomingBar.bounds,"incoming message emojis should not be cut off");
        assert(incomingBar.right <= incomingRect.x - 4 || incomingBar.left >= incomingRect.x + incomingRect.width + 4 || incomingBar.bottom <= incomingRect.y - 4 || incomingBar.top >= incomingRect.y + incomingRect.height + 4,"incoming message emojis should not cover the message");
      }
      const attachment = await page.$(".mdchat-bubble video, .mdchat-bubble img");
      if (attachment) {
        await attachment.hover();
        const mediaRect = await page.$eval(".mdchat-bubble:has(video), .mdchat-bubble:has(img)",(element) => { const rect=element.getBoundingClientRect(); return { x:rect.x,y:rect.y,width:rect.width,height:rect.height }; });
        await page.mouse.move(mediaRect.x + Math.min(25,mediaRect.width/2),mediaRect.y + mediaRect.height - 15);
        await page.waitForSelector(".mdchat-message-actions",{ timeout:5000 });
        const placement = await page.$eval(".mdchat-message-actions",(element) => ({ top:element.getBoundingClientRect().top,left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,bottom:element.getBoundingClientRect().bottom }));
        assert(placement.top > mediaRect.y,"attachment actions should appear near its lower edge");
        assert(placement.right <= mediaRect.x - 4 || placement.left >= mediaRect.x + mediaRect.width + 4 || placement.bottom <= mediaRect.y - 4 || placement.top >= mediaRect.y + mediaRect.height + 4,"attachment actions should not cover the preview");
        await page.screenshot({ path:path.resolve(__dirname,"../../../chat-preview-reactions.png") });
      }
      await page.click(".mdchat-message-actions button[title='More actions']");
      const menu = await page.$eval(".mdchat-action-menu",(element) => ({ parent:element.parentElement === document.body,left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom,emoji:element.textContent?.includes(String.fromCodePoint(0x1f44d)) }));
      assert(menu.parent && !menu.emoji && menu.left >= 0 && menu.right <= 1440 && menu.top >= 0 && menu.bottom <= 900,"three-dot actions should stay in view without emoji choices");
      await page.click('[aria-label="Close message actions"]');
    }
    await page.screenshot({ path:path.resolve(__dirname,"../../../chat-preview-desktop.png") });
    await page.setViewport({ width:390,height:844,deviceScaleFactor:1 });
    await page.screenshot({ path:path.resolve(__dirname,"../../../chat-preview-mobile.png") });
    const mobile = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth>window.innerWidth,
      listHidden:document.querySelector(".mdchat-conversations")?.classList.contains("mobile-hidden"),
      chatVisible:getComputedStyle(document.querySelector(".mdchat-main")!).display!=="none",
      inputFocused:document.activeElement?.getAttribute("aria-label")==="Type a message",
    }));
    assert.deepEqual(mobile,{ overflow:false,listHidden:true,chatVisible:true,inputFocused:false });
    await page.click(".mdchat-back");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".mdchat-conversations")!).display!=="none"),true);
    console.log("Chat desktop and mobile smoke test passed");
  } finally { await browser.close(); await pool.end(); }
}

main().catch((error) => { console.error(error); process.exitCode=1; });
