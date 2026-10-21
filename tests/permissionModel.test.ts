import assert from "node:assert/strict";
import { hasPermission, MODULE } from "../permissionModel";
import { requirePermission } from "../middleware/middleware";

const cases = [
  { role: "admin", permissions: [] as string[], allowed: true },
  { role: "user", permissions: [] as string[], allowed: false },
  { role: "auditor", permissions: [MODULE.Reports], allowed: true },
  { role: "auditor", permissions: [MODULE.Reports], allowed: false, module: MODULE.People },
];

for (const account of cases) {
  const module = account.module || MODULE.Reports;
  const visible = hasPermission(account, module);
  assert.equal(visible, account.allowed);
  let status = 0;
  let passed = false;
  const req = { user: account } as any;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as any;
  requirePermission(module)(req, res, () => { passed = true; });
  assert.equal(passed, account.allowed);
  if (!account.allowed) assert.equal(status, 403);
}

console.log("Admin, employee, and synthetic restricted-role UI/API decisions match");
