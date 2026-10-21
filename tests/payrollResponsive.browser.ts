import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import puppeteer from "puppeteer";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";

(async () => {
  const originalLog = console.log;
  console.log = (...args: any[]) => { if (!String(args[0]).startsWith("📊") &&
    !String(args[0]).startsWith("📋") && !String(args[0]).startsWith("✅")) originalLog(...args); };
  const [admins]: any = await pool.query(
    "SELECT id, role, name, email, auth_version FROM tbl_users WHERE role='admin' AND status='Active' AND loginStatus='Y' LIMIT 1");
  assert(admins.length, "Active admin needed for UI check");
  const admin = admins[0];
  const token = jwt.sign({ id: admin.id, role: admin.role, authVersion: Number(admin.auth_version) || 0 },
    getJwtSecret(), { expiresIn: "10m" });
  const user = { id: admin.id, userId: admin.id, role: "admin", name: admin.name,
    email: admin.email, token, permissions: ["Payroll", "Reports", "Configuration"] };
  const server = app.listen(3002, "127.0.0.1");
  let browser: any;
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ||
      (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : puppeteer.executablePath()), args: ["--no-sandbox"] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.evaluateOnNewDocument((payload: { token: string; user: any }) => {
      sessionStorage.setItem("token", payload.token);
      sessionStorage.setItem("persist:root", JSON.stringify({
        currentUser: JSON.stringify(payload.user),
        permissions: JSON.stringify(payload.user.permissions),
        error: JSON.stringify(""),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      }));
    }, { token, user });
    const routes = process.env.PAYROLL_UI_QUICK ? [] : [
      "/payroll?tab=CALENDAR", "/payroll?tab=SALARY_CYCLE",
      "/payroll?tab=OVERTIME", "/payroll?tab=LOAN_MANAGEMENT",
      "/payroll?tab=CONFIG_SALARIES", "/configuration?tab=CONFIGURE_OVERTIME",
      "/reports?tab=PAYROLL_REPORT",
    ];
    const widths = [1920, 1366, 1024, 768, 430, 390, 375];
    const results: any[] = [];
    for (const width of widths) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      for (const route of routes) {
        await page.goto("http://127.0.0.1:5173" + route, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForSelector(".submodule-tabs", { timeout: 12000 });
        await page.waitForSelector('[aria-label="Table"]', { timeout: 15000 });
        const measure = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          navOverflow: (() => { const n = document.querySelector(".submodule-tabs"); return n ? n.scrollWidth - n.clientWidth : 0; })(),
          tablePresent: !!document.querySelector('[aria-label="Table"]'),
          forbidden: !!document.body.textContent?.includes("Access Denied"),
        }));
        results.push({ width, route, ...measure });
      }
    }
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto("http://127.0.0.1:5173/payroll?tab=CALENDAR", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".submodule-tabs");
    await page.waitForSelector('[aria-label="Table"]', { timeout: 15000 });
    const buttons = await page.$$("button");
    for (const button of buttons) {
      const label = await button.evaluate((el: Element) => el.textContent?.trim() || "");
      if (label.includes("Activate Calendar Session")) { await button.click(); break; }
    }
    await page.waitForSelector(".fixed.inset-0 .max-w-xl", { timeout: 6000 });
    const modal = await page.evaluate(() => {
      const el = document.querySelector(".fixed.inset-0 .max-w-xl");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width,
        viewport: window.innerWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    const modalChecks: Array<{ route: string; label: string; left: number; right: number; viewport: number }> = [];
    if (process.env.PAYROLL_UI_QUICK) {
      await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
      const cases = [
        { route: "/payroll?tab=CALENDAR", label: "Add Calendar" },
        { route: "/payroll?tab=SALARY_CYCLE", label: "Add Salary Cycle" },
        { route: "/payroll?tab=OVERTIME", label: "Add Overtime" },
        { route: "/payroll?tab=LOAN_MANAGEMENT", label: "Add Loan" },
        { route: "/payroll?tab=CONFIG_SALARIES", label: "Add Configure Salary" },
        { route: "/configuration?tab=CONFIGURE_OVERTIME", label: "Add Overtime" },
      ];
      for (const item of cases) {
        await page.goto("http://127.0.0.1:5173" + item.route, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[aria-label="Table"]', { timeout: 15000 });
        const controls = await page.$$("button");
        let clicked = false;
        for (const control of controls) {
          const label = await control.evaluate((el: Element) => el.textContent?.trim() || "");
          if (label.includes(item.label)) { await control.click(); clicked = true; break; }
        }
        assert(clicked, item.label + " button missing");
        await page.waitForSelector(".fixed.inset-0", { timeout: 6000 });
        const bounds = await page.evaluate(() => {
          const overlays = document.querySelectorAll(".fixed.inset-0");
          const overlay = overlays[overlays.length - 1];
          const content = overlay?.firstElementChild;
          if (!content) return null;
          const rect = content.getBoundingClientRect();
          return { left: rect.left, right: rect.right, viewport: window.innerWidth };
        });
        assert(bounds, item.label + " modal missing");
        modalChecks.push({ route: item.route, label: item.label, ...bounds });
      }
    }    console.log(JSON.stringify({ results, modal, modalChecks, errors }));
    assert(results.every(r => r.overflow <= 1 && !r.forbidden), "Payroll page overflow or access failure");
    assert(modal && modal.left >= 0 && modal.right <= 390, "Activation modal clipped");
    assert(modalChecks.every(m => m.left >= 0 && m.right <= m.viewport), "Add modal clipped at 375px");
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
    console.log = originalLog;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });









