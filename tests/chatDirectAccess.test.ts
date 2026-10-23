import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import jwt from "jsonwebtoken";
import pool from "../database/db";
import { getJwtSecret } from "../config/jwtSecret";
import chatRoutes from "../routes/chat.routes";

async function main() {
  const [rows]: any = await pool.query(`SELECT id,role,auth_version FROM tbl_users
    WHERE status='Active' AND loginStatus='Y' AND LOWER(role) IN ('admin','user')
    ORDER BY id`);
  const admin = rows.find((row: any) => row.role.toLowerCase() === "admin");
  const employees = rows.filter((row: any) => row.role.toLowerCase() === "user");
  assert(admin && employees.length >= 2, "an admin and two employees are required");
  const tokenFor = (account: any) => jwt.sign({ id: account.id, role: account.role,
    authVersion: Number(account.auth_version) || 0 }, getJwtSecret(), { expiresIn: "5m" });

  const app = express();
  app.use(express.json());
  app.use("/api/chat", chatRoutes);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    const headers = { Authorization: `Bearer ${tokenFor(employees[0])}`, "Content-Type": "application/json" };
    const forbiddenGroup = await fetch(`http://127.0.0.1:${port}/api/chat/conversations`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "group", name: "Not allowed", userIds: [admin.id, employees[1].id] }),
    });
    assert.equal(forbiddenGroup.status, 403, "employees must not create groups");

    const forbidden = await fetch(`http://127.0.0.1:${port}/api/chat/conversations`, {
      method: "POST", headers, body: JSON.stringify({ type: "direct", userIds: [employees[1].id] }),
    });
    assert.equal(forbidden.status, 403, "employee-to-employee direct chat must be rejected");

    const list = await fetch(`http://127.0.0.1:${port}/api/chat/conversations`, { headers });
    assert.equal(list.status, 200);
    const conversations: any[] = await list.json();
    assert(conversations.every((chat) => chat.type !== "direct" ||
      chat.participants.some((person: any) => Number(person.id) === Number(admin.id))),
      "employees must not see direct chats without an administrator");

    const adminHeaders = { Authorization: `Bearer ${tokenFor(admin)}`, "Content-Type": "application/json" };
    const contactsResponse = await fetch(`http://127.0.0.1:${port}/api/chat/contacts`, { headers: adminHeaders });
    assert.equal(contactsResponse.status, 200);
    const contacts: any[] = await contactsResponse.json();
    assert(employees.every((employee: any) => contacts.some((contact) => Number(contact.id) === Number(employee.id))),
      "administrators must be able to find every active employee");

    const [existing]: any = await pool.query(`SELECT c.id,p.user_id AS employee_id FROM chat_conversations c
      JOIN chat_participants a ON a.conversation_id=c.id AND a.user_id=?
      JOIN chat_participants p ON p.conversation_id=c.id AND p.user_id<>?
      JOIN tbl_users u ON u.id=p.user_id AND LOWER(u.role)='user'
      WHERE c.type='direct' AND (SELECT COUNT(*) FROM chat_participants WHERE conversation_id=c.id)=2 LIMIT 1`,
      [admin.id, admin.id]);
    if (existing.length) {
      const pair = existing[0];
      const employee = employees.find((item: any) => Number(item.id) === Number(pair.employee_id));
      assert(employee);
      for (const [sender, target] of [[admin, employee], [employee, admin]]) {
        const response = await fetch(`http://127.0.0.1:${port}/api/chat/conversations`, {
          method: "POST", headers: { Authorization: `Bearer ${tokenFor(sender)}`, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "direct", userIds: [target.id] }),
        });
        assert.equal(response.status, 200, "admin-employee direct chats should remain available");
        const result: any = await response.json();
        assert.equal(Number(result.id), Number(pair.id));
      }
    }
    console.log("Direct chat access checks passed");
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
