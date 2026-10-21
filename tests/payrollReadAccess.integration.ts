import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";

(async () => {
  const [users]: any = await pool.query(
    "SELECT id, role, auth_version FROM tbl_users WHERE status = 'Active' AND loginStatus = 'Y' AND role IN ('admin','user')");
  const admin = users.find((u: any) => u.role === "admin");
  const employee = users.find((u: any) => u.role === "user");
  assert(admin && employee, "Read-only access test needs an active admin and employee");
  const token = (u: any) => jwt.sign(
    { id: u.id, role: u.role, authVersion: Number(u.auth_version) || 0 },
    getJwtSecret(), { expiresIn: "5m" });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const status = async (path: string, user?: any) => {
      const response = await fetch("http://127.0.0.1:" + address.port + path, {
        headers: user ? { Authorization: "Bearer " + token(user) } : {},
      });
      await response.arrayBuffer();
      return response.status;
    };
    for (const path of ["/api/admin/getCalendarSession", "/api/admin/getPayrollReport",
      "/api/admin/getsalaries", "/api/admin/getLoans", "/api/getOvertime",
      "/api/admin/getOvertimeConfig"]) {
      assert.equal(await status(path), 401, path + " unauthenticated");
      assert.equal(await status(path, employee), 403, path + " employee");
      assert.equal(await status(path, admin), 200, path + " admin");
    }
    assert.equal(await status("/api/user/getMyLoans", employee), 200);
    console.log("Payroll read access: 401 anonymous, 403 employee, 200 admin, own loans 200");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

