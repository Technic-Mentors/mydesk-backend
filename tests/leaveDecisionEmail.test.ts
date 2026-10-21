import assert from "node:assert/strict";
import pool from "../database/db";
import * as events from "../services/notificationEvents";
import { updateLeave } from "../controllers/leave.controller";

async function main() {
  const originalExecute = pool.execute;
  const originalDecisionEvent = events.decisionEvent;
  let previousStatus = "Pending";
  const decisions: string[] = [];
  (pool as any).execute = async (sql: string) => {
    if (sql.includes("SELECT userId, leaveStatus FROM leaves")) return [[{ userId: 42, leaveStatus: previousStatus }]];
    if (sql.includes("UPDATE leaves")) return [{ affectedRows: 1 }];
    if (sql.includes("SELECT * FROM leaves")) return [[{ id: 7, userId: 42, leaveStatus: "Approved" }]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  (events as any).decisionEvent = async (kind: string, userId: number, id: number, status: string) => {
    decisions.push(`${kind}:${userId}:${id}:${status}`);
  };
  const response = {
    statusCode: 0,
    status(code: number) { this.statusCode = code; return this; },
    json(_data: unknown) { return this; },
  };
  try {
    await updateLeave({ params: { id: "7" }, body: { leaveStatus: "Approved" } } as any, response as any);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(decisions, ["leave:42:7:Approved"]);
    previousStatus = "Approved";
    await updateLeave({ params: { id: "7" }, body: { leaveStatus: "Approved" } } as any, response as any);
    assert.equal(decisions.length, 1, "saving an unchanged status must not resend email");
    await updateLeave({ params: { id: "7" }, body: { leaveStatus: "Rejected" } } as any, response as any);
    assert.deepEqual(decisions, ["leave:42:7:Approved", "leave:42:7:Rejected"]);
    console.log("Admin Edit Leave queues approval and rejection emails only when status changes");
  } finally {
    (pool as any).execute = originalExecute;
    (events as any).decisionEvent = originalDecisionEvent;
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
