import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import app from "../server";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";

(async () => {
  const [admins]: any = await pool.query(
    "SELECT id, role, auth_version FROM tbl_users WHERE role = 'admin' AND status = 'Active' AND loginStatus = 'Y' LIMIT 1");
  assert(admins.length, "Active admin required");
  const [before]: any = await pool.query(
    "SELECT id, session_name, year, month, calendarStatus FROM calendarsession WHERE session_name = ?",
    ["2026"]);
  const original = before.find((r: any) => r.calendarStatus === "Active");
  const october = before.find((r: any) => Number(r.year) === 2026 && r.month === "October");
  assert.equal(before.length, 12);
  assert(original && october, "2026 session needs one active month and October");
  const [cycles]: any = await pool.query(
    "SELECT id FROM salarycycle WHERE calendar_session_id IN (?) LIMIT 1", [before.map((r: any) => r.id)]);
  assert.equal(cycles.length, 0, "Do not test activation on processed sessions");
  const token = jwt.sign({ id: admins[0].id, role: admins[0].role,
    authVersion: Number(admins[0].auth_version) || 0 }, getJwtSecret(), { expiresIn: "5m" });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const activate = async (row: any) => {
      const response = await fetch("http://127.0.0.1:" + address.port + "/api/admin/activate-calendar-session", {
        method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ session_name: row.session_name, year: row.year, month: row.month }),
      });
      assert.equal(response.status, 200, await response.text());
    };
    try {
      await activate(october);
      const [active]: any = await pool.query(
        "SELECT month,year FROM calendarsession WHERE calendarStatus = 'Active'");
      assert.deepEqual(active.map((r: any) => r.month + " " + r.year), ["October 2026"]);
      console.log("Calendar HTTP activation selected only October 2026");
    } finally {
      await activate(original);
    }
    const [after]: any = await pool.query(
      "SELECT id FROM calendarsession WHERE calendarStatus = 'Active'");
    assert.deepEqual(after.map((r: any) => r.id), [original.id]);
    console.log("Original active month restored");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
