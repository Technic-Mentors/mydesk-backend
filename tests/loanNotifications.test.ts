import assert from "node:assert/strict";
import pool from "../database/db";
import { addLoan } from "../controllers/loan.controller";
import { loanDeductedEvent } from "../services/loanNotificationEvents";

const notifications = require("../services/notificationService");
const originalQuery = pool.query;
const originalNotify = notifications.notifyUser;
const notices: Array<{ userId: number; notice: any }> = [];

(async () => {
  try {
    notifications.notifyUser = async (userId: number, notice: any) => { notices.push({ userId, notice }); };
    (pool as any).query = async (sql: string) => {
      if (sql.includes("SELECT date FROM employee_lifeline")) return [[{ date: new Date("2020-01-01") }]];
      if (sql.includes("INSERT INTO loan")) return [{ insertId: 91 }];
      throw new Error("Unexpected query: " + sql);
    };

    let code = 200;
    const response: any = { status(value: number) { code = value; return this; }, json() { return this; } };
    await addLoan({ body: { employee_id: 7, loanAmount: 1000, deduction: 200, applyDate: "2026-10-16" } } as any, response);
    assert.equal(code, 201);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].userId, 7);
    assert.equal(notices[0].notice.type, "LOAN_CREATED");
    assert.equal(notices[0].notice.targetUrl, "/user/payroll?viewId=91");
    assert.match(notices[0].notice.message, /Rs 1,000.00/);

    await loanDeductedEvent(12, 2026, "October", 7, 125.50);
    assert.equal(notices.length, 2);
    assert.equal(notices[1].notice.type, "LOAN_DEDUCTED");
    assert.equal(notices[1].notice.targetUrl, "/user/payroll");
    assert.equal(notices[1].notice.dedupeKey, "loan:cycle:12:deducted:u7");
    assert.match(notices[1].notice.message, /Rs 125.50.*October 2026/);

    console.log("Loan notifications: creation and salary deduction messages passed");
  } finally {
    (pool as any).query = originalQuery;
    notifications.notifyUser = originalNotify;
    await pool.end();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
