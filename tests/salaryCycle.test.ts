import assert from "node:assert/strict";
import pool from "../database/db";
import { runSalaryCycle } from "../controllers/salaryCycle.controller";

const original = pool.getConnection;
type Result = { code: number; body: any; status: (n: number) => Result; json: (v: any) => Result };
const response = (): Result => ({
  code: 200, body: null,
  status(n) { this.code = n; return this; },
  json(v) { this.body = v; return this; },
});
async function scenario(options: { active?: boolean; duplicate?: boolean; fail?: boolean; midMonthChange?: boolean; leaveHoliday?: boolean; overtime?: boolean; sequenceMissing?: boolean; year?: number } = {}) {
  let committed = false, rolledBack = false, loanUpdate = 0, accountDebit = -1, snapshotNet = -1, snapshotOvertime = -1;
  let loanRemaining = 1000, accountRows = 0, snapshotRows = 0;
  let sequenceNumber = options.sequenceMissing ? null : 12;
  let before = { loanRemaining, accountRows, snapshotRows };
  const connection = {
    async beginTransaction() { before = { loanRemaining, accountRows, snapshotRows }; },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; ({ loanRemaining, accountRows, snapshotRows } = before); },
    release() {},
    async query(sql: string, args: any[] = []): Promise<any> {
      if (sql.startsWith("SELECT id, session_name, calendarStatus")) return [[{
        id: 7, session_name: "2025", calendarStatus: options.active === false ? "InActive" : "Active",
      }]];
      if (sql.startsWith("SELECT id FROM salarycycle")) return [options.duplicate ? [{ id: 1 }] : []];
      if (sql.startsWith("SELECT rule_mode, cutoff_day")) return [[{ rule_mode: "AFTER_MONTH_END", cutoff_day: 25 }]];
      if (sql.startsWith("SELECT id FROM employee_accounts")) return [[]];
      if (sql.startsWith("SELECT CURRENT_DATE()")) return [[{ is_future: 0 }]];
      if (sql.startsWith("SELECT c.id, c.employee_id")) return [[{
        id: 3, employee_id: 8, total_salary: 31000, salary_amount: 30000, emp_of_mon_allowance: 1000, transport_allowance: 0, medical_allowance: 0, attendance_base: "Y",
        effective_from: "2025-10-01", joined: "2025-10-10", last_day: null,
      }]];
      if (sql.startsWith("SELECT id, total_salary, salary_amount")) return [options.midMonthChange ? [
        { id: 2, total_salary: 31000, salary_amount: 30000, emp_of_mon_allowance: 1000, transport_allowance: 0, medical_allowance: 0, attendance_base: "Y", effective_from: "2025-10-10" },
        { id: 3, total_salary: 62000, salary_amount: 60000, emp_of_mon_allowance: 2000, transport_allowance: 0, medical_allowance: 0, attendance_base: "Y", effective_from: "2025-10-20" },
      ] : [{ id: 3, total_salary: 31000, salary_amount: 30000, emp_of_mon_allowance: 1000, transport_allowance: 0, medical_allowance: 0, attendance_base: "Y", effective_from: "2025-10-01" }]];      if (sql.startsWith("SELECT DATE_FORMAT(date")) return [options.leaveHoliday ? [] : [
        ...Array.from({ length: 20 }, (_, i) => ({ day: "2025-10-" + String(i + 10).padStart(2, "0") })),
      ]];
      if (sql.includes("FROM leaves")) return [options.leaveHoliday ? [
        { firstDay: "2025-10-10", lastDay: "2025-10-10", leaveType: "FULL DAY" },
        { firstDay: "2025-10-11", lastDay: "2025-10-11", leaveType: "HALF DAY" },
      ] : []];
      if (sql.includes("FROM holidays")) return [options.leaveHoliday ? [
        { firstDay: "2025-10-12", lastDay: "2025-10-12" },
      ] : []];
      if (sql.startsWith("SELECT id, remainingAmount, deduction FROM loan"))
        return [[{ id: 11, remainingAmount: 1000, deduction: 1000 }]];
      if (sql.startsWith("UPDATE loan")) { loanUpdate = args[0]; loanRemaining -= args[0]; return [{}]; }
      if (sql.startsWith("SELECT COALESCE(SUM(overtime_amount)")) return [[{ amount: options.overtime ? 500 : 0, hours: options.overtime ? 2 : 0 }]];
      if (sql.startsWith("INSERT INTO payroll_run_items")) { snapshotNet = args[7]; snapshotOvertime = args[6]; snapshotRows++; return [{}]; }
      if (sql.startsWith("SELECT balance FROM employee_accounts")) return [[{ balance: 500 }]];
      if (sql.startsWith("INSERT INTO invoice_sequence")) { if (sequenceNumber === null) sequenceNumber = 0; return [{}]; }
      if (sql.startsWith("SELECT employee_acc_no")) return [[{ employee_acc_no: sequenceNumber }]];
      if (sql.startsWith("INSERT INTO employee_accounts")) {
        if (options.fail) throw new Error("Injected account failure");
        accountDebit = args[1]; accountRows++; return [{}];
      }
      if (sql.startsWith("UPDATE invoice_sequence")) { sequenceNumber = args[0]; return [{}]; }
      if (sql.startsWith("INSERT INTO salarycycle") ||
          sql.startsWith("UPDATE calendarsession")) return [{}];
      throw new Error("Unexpected SQL: " + sql);
    },
  };
  (pool as any).getConnection = async () => connection;
  const res = response();
  try {
    await runSalaryCycle({ body: { year: options.year || 2025, month: "October" } } as any, res as any);
  } finally { (pool as any).getConnection = original; }
  return { res, committed, rolledBack, loanUpdate, accountDebit, snapshotNet, snapshotOvertime, loanRemaining, accountRows, snapshotRows, sequenceNumber };
}

(async () => {
  const inactive = await scenario({ active: false });
  assert.equal(inactive.res.code, 409);
  assert.equal(inactive.committed, false);
  const unfinishedMonth = await scenario({ year: 2026 });
  assert.equal(unfinishedMonth.res.code, 409);
  assert.equal(unfinishedMonth.res.body.message,
    "Salary Cycle cannot be processed because October 2026 has not completed yet.");
  assert.equal(unfinishedMonth.accountRows, 0);
  const duplicate = await scenario({ duplicate: true });
  assert.equal(duplicate.res.code, 409);
  const success = await scenario();
  assert.equal(success.res.code, 200);
  assert.equal(success.committed, true);
  assert.equal(success.loanUpdate, 1000);
  assert.equal(success.accountDebit, 19000);
  assert.equal(success.snapshotNet, 19000);
  assert.equal(success.loanRemaining, 0);
  assert.equal(success.accountRows, 1);
  assert.equal(success.snapshotRows, 1);
  const changed = await scenario({ midMonthChange: true });
  assert.equal(changed.accountDebit, 29000);
  const leave = await scenario({ leaveHoliday: true, overtime: true });
  assert.equal(leave.accountDebit, 1500);
  assert.equal(leave.snapshotOvertime, 500);
  const missingSequence = await scenario({ sequenceMissing: true });
  assert.equal(missingSequence.res.code, 200);
  assert.equal(missingSequence.sequenceNumber, 1);
  const failure = await scenario({ fail: true });
  assert.equal(failure.res.code, 500);
  assert.equal(failure.committed, false);
  assert.equal(failure.rolledBack, true);
  assert.equal(failure.loanRemaining, 1000);
  assert.equal(failure.accountRows, 0);
  assert.equal(failure.snapshotRows, 0);
  console.log("Salary Cycle: active month, duplicate guard, mid-month join, loan cap, and rollback passed");
})().catch(error => { console.error(error); process.exitCode = 1; });







