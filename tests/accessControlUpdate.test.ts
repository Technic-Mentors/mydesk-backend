import assert from "node:assert/strict";
import pool from "../database/db";
import { getAccessControl, updateAccessControl } from "../controllers/accesscontrol.controller";

const modules = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  moduleName: `Module ${index + 1}`,
}));
const grants = new Map<number, Set<number>>([
  [1, new Set([1, 2, 3, 4, 5])],
  [2, new Set([2, 8])],
]);
let deleteCount = 0;
let snapshot = new Map<number, Set<number>>();

const originalQuery = pool.query;
const originalGetConnection = pool.getConnection;
const connection = {
  async beginTransaction() {
    snapshot = new Map([...grants].map(([role, ids]) => [role, new Set(ids)]));
  },
  async commit() {},
  async rollback() {
    grants.clear();
    for (const [role, ids] of snapshot) grants.set(role, new Set(ids));
  },
  async query(sql: string, params?: any[]) {
    if (sql.startsWith("SELECT id, moduleName FROM modules")) return [modules];
    if (sql.startsWith("SELECT moduleId FROM access_control")) {
      return [[...(grants.get(Number(params?.[0])) || [])].map((moduleId) => ({ moduleId }))];
    }
    if (sql.startsWith("DELETE FROM access_control")) {
      deleteCount++;
      grants.set(Number(params?.[0]), new Set());
      return [{}];
    }
    if (sql.startsWith("INSERT INTO access_control")) {
      for (const [roleId, moduleId] of params?.[0] || []) {
        grants.get(Number(roleId))?.add(Number(moduleId));
      }
      return [{}];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  release() {},
};

function response() {
  return {
    code: 200,
    body: undefined as any,
    status(code: number) { this.code = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

async function read(roleId: number) {
  const res = response();
  await getAccessControl({ params: { roleId: String(roleId) } } as any, res as any);
  assert.equal(res.code, 200);
  return res.body.permissions as { moduleId: number; moduleName: string; status: number }[];
}

async function update(roleId: number, selected: number[], expected: number[], omit?: number) {
  const permissions = Object.fromEntries(modules
    .filter((module) => module.id !== omit)
    .map((module) => [module.moduleName, selected.includes(module.id)]));
  const res = response();
  await updateAccessControl({ body: { roleId, permissions, expectedModuleIds: expected } } as any, res as any);
  return res;
}

async function main() {
  (pool as any).query = async (sql: string, params?: any[]) => {
    if (!sql.includes("SELECT m.id AS moduleId")) throw new Error(`Unexpected read: ${sql}`);
    const assigned = grants.get(Number(params?.[0])) || new Set();
    return [modules.map((module) => ({
      moduleId: module.id,
      moduleName: module.moduleName,
      status: assigned.has(module.id) ? 1 : 0,
    }))];
  };
  (pool as any).getConnection = async () => connection;
  try {
    assert.equal((await read(1)).filter((row) => row.status === 1).length, 5);
    const beforeInvalid = deleteCount;
    assert.equal((await update(1, [2, 3, 4, 5], [1, 2, 3, 4, 5], 8)).code, 409);
    assert.equal(deleteCount, beforeInvalid);
    assert.equal((await update(1, [2, 3, 4, 5], [1, 2, 3, 4])).code, 409);
    assert.equal(deleteCount, beforeInvalid);

    assert.equal((await update(1, [2, 3, 4, 5], [1, 2, 3, 4, 5])).code, 200);
    assert.deepEqual((await read(1)).filter((row) => row.status === 1).map((row) => row.moduleId), [2, 3, 4, 5]);

    assert.equal((await update(1, [2, 3, 4, 5, 6, 7], [2, 3, 4, 5])).code, 200);
    assert.deepEqual((await read(1)).filter((row) => row.status === 1).map((row) => row.moduleId), [2, 3, 4, 5, 6, 7]);
    assert.deepEqual((await read(2)).filter((row) => row.status === 1).map((row) => row.moduleId), [2, 8]);
    console.log("Access control update: full replacement, reopen state, role isolation, incomplete and stale rejection");
  } finally {
    (pool as any).query = originalQuery;
    (pool as any).getConnection = originalGetConnection;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
