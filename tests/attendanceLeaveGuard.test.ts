import assert from "node:assert/strict";
import pool from "../database/db";
import { addAttendance, updateAttendance } from "../controllers/userAttendance.controller";

type Reply = { code: number; body: any; status: (code: number) => Reply; json: (body: any) => Reply };
const response = (): Reply => ({
  code: 200, body: null,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

async function scenario(leaveType: string, attendanceStatus: string, mode: "add" | "update" = "update") {
  const originalQuery = pool.query;
  let wroteAttendance = false;
  (pool as any).query = async (sql: string) => {
    if (sql.includes("SELECT * FROM attendance WHERE id")) return [[{ id: 8, type: "Onsite" }]];
    if (sql.includes("FROM attendance_rules")) return [[{}]];
    if (sql.includes("SELECT id, attendanceStatus FROM attendance")) return [[]];
    if (sql.includes("FROM leaves")) return [[{ id: 31, leaveType, leaveSubject: leaveType }]];
    if (sql.includes("UPDATE attendance")) {
      wroteAttendance = true;
      return [{ affectedRows: 1 }];
    }
    throw new Error("Unexpected query: " + sql);
  };
  const reply = response();
  try {
    const request = {
      params: { id: "8", userId: "7" },
      body: { userId: 7, date: "2026-10-20", attendanceStatus, clockIn: "09:00:00" },
    } as any;
    if (mode === "add") await addAttendance(request, reply as any);
    else await updateAttendance(request, reply as any);
  } finally {
    (pool as any).query = originalQuery;
  }
  return { reply, wroteAttendance };
}

(async () => {
  const blocked = await scenario("FULL DAY", "present (remote)");
  assert.equal(blocked.reply.code, 409);
  assert.equal(blocked.reply.body.code, "APPROVED_LEAVE_REQUIRES_REJECTION");
  assert.equal(blocked.wroteAttendance, false);

  const blockedAdd = await scenario("FULL DAY", "present", "add");
  assert.equal(blockedAdd.reply.code, 409);
  assert.equal(blockedAdd.wroteAttendance, false);

  const compatible = await scenario("HALF DAY", "half leave");
  assert.equal(compatible.reply.code, 200);
  assert.equal(compatible.wroteAttendance, true);

  await pool.end();
  console.log("Approved leave blocks conflicting attendance writes");
})().catch((error) => { console.error(error); process.exitCode = 1; });
