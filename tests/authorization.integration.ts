import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
import { hasPermission, MODULE } from "../permissionModel";

const modules: [string, string][] = [
  ["People", "/api/admin/getUsers"],
  ["Human Resources", "/api/admin/getEmpll"],
  ["Attendance", "/api/admin/getAllAttendances"],
  ["Configuration", "/api/admin/getAccessControl/1"],
  ["Projects", "/api/admin/getProjects"],
  ["Performance", "/api/admin/getTodos"],
  ["Lead Management", "/api/leads"],
  ["Pipeline", "/api/pipeline"],
  ["Follow-ups", "/api/followups"],
  ["Sales", "/api/admin/getSales"],
  ["Accounts", "/api/admin/getAllEmployeeAccounts"],
  ["Payroll", "/api/admin/getCalendarSession"],
  ["Expenses", "/api/admin/getExpense"],
  ["Assets", "/api/admin/assets"],
  ["Talent Acquisition", "/api/admin/getjob"],
  ["Dynamics", "/api/admin/getPromotions"],
  ["Users Management", "/api/admin/getRoles"],
  ["Reports", "/api/admin/getAccountReport"],
];

async function main() {
  const [accounts]: any = await pool.query(
    "SELECT id, role, auth_version FROM tbl_users WHERE status = 'Active' AND loginStatus = 'Y' AND role IN ('admin', 'user')",
  );
  const admin = accounts.find((row: any) => row.role === "admin");
  const employee = accounts.find((row: any) => row.role === "user");
  assert(admin && employee, "Active admin and employee accounts are required");
  const [restrictedRows]: any = await pool.query(
    "SELECT id, role, auth_version FROM tbl_users WHERE status = 'Active' AND loginStatus = 'Y' AND role NOT IN ('admin', 'user') LIMIT 1",
  );
  const token = (account: any) => jwt.sign(
    { id: account.id, role: account.role, authVersion: Number(account.auth_version) || 0 },
    getJwtSecret(), { expiresIn: "5m" },
  );
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const status = async (path: string, account?: any) => {
      const response = await fetch(`${url}${path}`, {
        headers: account ? { Authorization: `Bearer ${token(account)}` } : {},
      });
      await response.arrayBuffer();
      return response.status;
    };
    for (const [module, path] of modules) {
      const adminStatus = await status(path, admin);
      const employeeStatus = await status(path, employee);
      assert.equal(employeeStatus, 403, `${module}: employee must be forbidden`);
      assert.notEqual(adminStatus, 403, `${module}: admin must pass authorization`);
      console.log(`${module}: admin ${adminStatus}, employee ${employeeStatus}`);
    }
    assert.equal(await status("/api/admin/getRoles"), 401);
    assert.equal(await status(`/api/user/getTodo/${employee.id}`, employee), 200);
    assert.equal(await status(`/api/user/getTodo/${admin.id}`, employee), 403);
    assert.equal(await status(`/api/wfh/${admin.id}/my-requests`, employee), 403);
    assert.equal(await status("/api/user/dashboard", employee), 200);
    assert.equal(await status("/api/user/getMyLoans", employee), 200);
    assert.equal(await status("/api/getNotifications", employee), 200);
    assert.equal(await status("/api/admin/getHolidays", employee), 200);
    assert.equal(await status("/api/admin/getTimeConfigured", employee), 200);
    assert.equal(await status("/api/admin/business-variables", employee), 200);
    assert.equal(await status(`/api/getPromotionHistory/${admin.id}`, employee), 403);
    const postStatus = async (path: string, body: object, account = employee) => {
      const response = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token(account)}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await response.arrayBuffer();
      return response.status;
    };
    assert.equal(await postStatus("/api/createAdvanceSalary", { employee_id: admin.id }), 403);
    assert.equal(await postStatus("/api/createAdvanceSalary", { employee_id: employee.id }), 400);
    assert.equal(await postStatus("/api/user/addRejoin", { id: admin.id }), 403);
    assert.equal(await postStatus("/api/addLoan", {}), 403);
    assert.equal(await postStatus("/api/addLoan", { employee_id: admin.id }), 403);
    assert.equal(await postStatus("/api/addLoan", {}, admin), 400);
    if (restrictedRows.length) {
      const restricted = restrictedRows[0];
      const [grants]: any = await pool.query(
        `SELECT m.moduleName FROM tbl_users u JOIN access_control ac ON ac.roleId = u.roleId
         JOIN modules m ON m.id = ac.moduleId WHERE u.id = ? AND ac.status = 1`,
        [restricted.id],
      );
      const principal = { role: restricted.role, permissions: grants.map((row: any) => row.moduleName) };
      for (const [module, path] of modules) {
        const apiStatus = await status(path, restricted);
        assert.equal(apiStatus === 403, !hasPermission(principal, module), `${module}: restricted role mismatch`);
      }
      console.log("Restricted role: UI permission model matches API authorization");
    } else {
      // Exercise the real HTTP guard without writing a test account into the database.
      const originalQuery = pool.query;
      (pool as any).query = async (sql: string, values?: any[]) => {
        if (typeof sql === "string" && sql.startsWith("SELECT auth_version, role, roleId") &&
            Number(values?.[0]) === employee.id) {
          return [[{
            auth_version: employee.auth_version, role: "restricted-test", roleId: 999999,
            name: "Restricted Test", email: "restricted@example.invalid",
            loginStatus: "Y", status: "Active",
          }], []];
        }
        if (typeof sql === "string" && sql.includes("FROM access_control ac") &&
            Number(values?.[0]) === 999999) {
          return [[{ moduleName: MODULE.Attendance }], []];
        }
        return originalQuery.call(pool, sql as any, values as any);
      };
      try {
        const restricted = { ...employee, role: "restricted-test" };
        assert.equal(hasPermission({ role: restricted.role, permissions: [MODULE.Attendance] }, MODULE.Attendance), true);
        assert.equal(hasPermission({ role: restricted.role, permissions: [MODULE.Attendance] }, MODULE.TalentAcquisition), false);
        assert.equal(await status("/api/admin/getAllAttendances", restricted), 200);
        assert.equal(await status("/api/admin/getjob", restricted), 403);
        console.log("Restricted role: simulated DB grant matches UI model and HTTP 200/403");
      } finally {
        (pool as any).query = originalQuery;
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
