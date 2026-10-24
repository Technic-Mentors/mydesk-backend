import assert from "node:assert/strict";
import pool from "../database/db";
import { addAttendance, updateAttendance } from "../controllers/userAttendance.controller";

type Reply = { code: number; body: any; status: (code: number) => Reply; json: (body: any) => Reply };
const response = (): Reply => ({
  code: 200, body: null,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

async function scenario(
  leaveStatus: "Pending" | "Approved" | "None",
  attendanceStatus: string,
  mode: "add" | "update",
  failApproval = false,
  leaveType = "FULL DAY",
) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let wroteAttendance = false;
  let approvedLeave = false;
  let createdLeave = false;
  let committed = false;
  let rolledBack = false;

  (pool as any).query = async (sql: string) => {
    if (sql.includes("FROM attendance_rules")) return [[{}]];
    if (sql.includes("SELECT * FROM attendance WHERE id")) return [[{ id: 8, type: "Onsite" }]];
    if (sql.includes("SELECT id, attendanceStatus FROM attendance")) return [[]];
    if (sql.includes("leaveStatus = 'Pending'")) return [leaveStatus === "Pending" ? [{ id: 31, leaveType }] : []];
    if (sql.includes("LOWER(leaveStatus) = 'approved'")) {
      return [leaveStatus === "Approved" ? [{ id: 31, leaveType }] : []];
    }
    return [[]];
  };
  (pool as any).getConnection = async () => ({
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => {},
    query: async (sql: string) => {
      if (sql.includes("UPDATE attendance") || sql.includes("INSERT INTO attendance")) {
        wroteAttendance = true;
        return [{ insertId: 8, affectedRows: 1 }];
      }
      if (sql.includes("SELECT id, leaveStatus FROM leaves")) {
        return [leaveStatus === "None" ? [] : [{ id: 31, leaveStatus }]];
      }
      if (sql.includes("INSERT INTO leaves")) {
        createdLeave = true;
        return [{ insertId: 32 }];
      }
      if (sql.includes("UPDATE leaves SET leaveStatus")) {
        if (failApproval) throw new Error("Leave update failed");
        approvedLeave = true;
        return [{ affectedRows: 1 }];
      }
      throw new Error("Unexpected transaction query: " + sql);
    },
  });

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
    (pool as any).getConnection = originalGetConnection;
  }
  return { reply, wroteAttendance, approvedLeave, createdLeave, committed, rolledBack };
}

(async () => {
  for (const mode of ["add", "update"] as const) {
    const approved = await scenario("Approved", "present", mode);
    assert.equal(approved.reply.code, 409);
    assert.equal(approved.reply.body.code, "APPROVED_LEAVE_REQUIRES_REJECTION");
    assert.equal(approved.wroteAttendance, false);

    const pending = await scenario("Pending", "present", mode);
    assert.equal(pending.reply.code, 409);
    assert.equal(pending.reply.body.code, "PENDING_LEAVE_STATUS_CONFLICT");
    assert.match(pending.reply.body.message, /cannot mark present/i);
    assert.match(pending.reply.body.message, /Reject the leave request first/i);
    assert.equal(pending.wroteAttendance, false);

    const markedLeave = await scenario("Pending", "full day", mode);
    assert.equal(markedLeave.reply.code, mode === "add" ? 201 : 200);
    assert.equal(markedLeave.approvedLeave, true);
    assert.equal(markedLeave.createdLeave, false);
    assert.equal(markedLeave.committed, true);

    for (const [requestType, allowedStatus] of [["HALF DAY", "half leave"], ["SHORT LEAVE", "short leave"], ["SICK LEAVE", "sick leave"], ["CASUAL LEAVE", "casual leave"], ["ANNUAL LEAVE", "annual leave"], ["FAMILY RESPONSIBILITY", "family responsibility"]] as const) {
      const blocked = await scenario("Pending", "leave", mode, false, requestType);
      assert.equal(blocked.reply.code, 409);
      assert.equal(blocked.reply.body.code, "PENDING_LEAVE_STATUS_CONFLICT");
      assert.equal(blocked.wroteAttendance, false);
      const matching = await scenario("Pending", allowedStatus, mode, false, requestType);
      assert.equal(matching.reply.code, mode === "add" ? 201 : 200);
      assert.equal(matching.approvedLeave, true);
      assert.equal(matching.createdLeave, false);
      assert.equal(matching.committed, true);
    }
  }

  const newLeave = await scenario("None", "sick leave", "add");
  assert.equal(newLeave.reply.code, 201);
  assert.equal(newLeave.createdLeave, true);
  assert.equal(newLeave.committed, true);

  const failed = await scenario("Pending", "full day", "add", true);
  assert.equal(failed.reply.code, 500);
  assert.equal(failed.committed, false);
  assert.equal(failed.rolledBack, true);

  await pool.end();
  console.log("Attendance and pending leave stay synchronized");
})().catch((error) => { console.error(error); process.exitCode = 1; });
