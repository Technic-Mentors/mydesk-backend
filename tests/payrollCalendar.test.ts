import assert from "node:assert/strict";
import pool from "../database/db";
import { addCalendarSession, activateCalendarSession } from "../controllers/calendar.controller";

const original = pool.getConnection;
const response = () => ({
  code: 200, body: null as any,
  status(code: number) { this.code = code; return this; },
  json(body: any) { this.body = body; return this; },
});
(async () => {
  let inserted: any[][] = [];
  let activatedId = 0, deactivated = false, committed = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() {},
    release() {},
    async query(sql: string, args: any[] = []): Promise<any> {
      if (sql.startsWith("SELECT id FROM calendarsession")) return [[]];
      if (sql.startsWith("INSERT INTO calendarsession")) { inserted = args[0]; return [{}]; }
      if (sql.startsWith("SELECT cs.id")) return [[{ id: 10, calendarStatus: "InActive", cycle_id: null }]];
      if (sql.startsWith("UPDATE calendarsession SET calendarStatus = 'InActive'")) {
        deactivated = true; return [{}];
      }
      if (sql.startsWith("UPDATE calendarsession SET calendarStatus = 'Active'")) {
        activatedId = args[0]; return [{}];
      }
      if (sql.startsWith("SELECT * FROM calendarsession")) return [[{ id: activatedId, month: "October", year: 2026 }]];
      throw new Error("Unexpected SQL: " + sql);
    },
  };
  (pool as any).getConnection = async () => connection;
  try {
    const added = response();
    await addCalendarSession({ body: { session_name: "2026", year: 2026, month: "January" } } as any, added as any);
    assert.equal(added.code, 201);
    assert.equal(inserted.length, 12);
    assert.deepEqual(inserted.map(row => row[1] + "-" + String(["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(row[2]) + 1).padStart(2,"0")),
      Array.from({ length: 12 }, (_, i) => "2026-" + String(i + 1).padStart(2,"0")));
    const activated = response();
    await activateCalendarSession({ body: { session_name: "2026", year: 2026, month: "October" } } as any, activated as any);
    assert.equal(activated.code, 200);
    assert.equal(activatedId, 10);
    assert.equal(deactivated, true);
    assert.equal(committed, true);
    console.log("Calendar: January start generated 12 correct months; October activation selected only its row");
  } finally { (pool as any).getConnection = original; }
})().catch(error => { console.error(error); process.exitCode = 1; });
