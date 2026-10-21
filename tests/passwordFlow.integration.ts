import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "../database/db";
import resend from "../utils/resend";
import { login } from "../controllers/login.controller";
import { forgotPassword, resetPassword, changePassword } from "../controllers/password.controller";
import { authenticateToken } from "../middleware/middleware";
import { createResetToken, hashResetToken } from "../utils/passwordSecurity";

const suffix = randomUUID().replace(/-/g, "");
const email = `password-test-${suffix}@example.invalid`;
const otherEmail = `password-other-${suffix}@example.invalid`;
const originalPassword = "Original1!Password";
const resetPasswordValue = "Replacement1!Password";
const changedPassword = "Changed2!Password";
const scopes = new Set<string>();
const mockIp = `password-test-${suffix}`;
const otherIp = `password-rate-${suffix}`;
let userId: number | undefined;
let otherId: number | undefined;
let emailedToken = "";

const originalSend = resend.emails.send.bind(resend.emails);
(resend.emails as any).send = async (message: { html: string }) => {
  const href = message.html.match(/href="([^"]+)"/)?.[1];
  assert.ok(href);
  emailedToken = new URLSearchParams(new URL(href.replace(/&amp;/g, "&")).hash.slice(1)).get("token") || "";
  return { data: { id: "test-email" }, error: null };
};

const invoke = async (handler: Function, body: object, user?: { id: number }, ip = mockIp) => {
  const response: any = {
    statusCode: 200,
    data: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(data: unknown) { this.data = data; return this; },
  };
  await handler({ body, user, ip, socket: { remoteAddress: ip } }, response);
  return response;
};

const insertToken = async (token: string, expiry: string) => {
  await pool.query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [userId, hashResetToken(token), expiry]
  );
};

const run = async () => {
  const originalHash = await bcrypt.hash(originalPassword, 10);
  const [inserted]: any = await pool.query(
    "INSERT INTO tbl_users (email, password, role, name, loginStatus, status) VALUES (?, ?, 'user', 'Password Test', 'Y', 'Active')",
    [email, originalHash]
  );
  userId = inserted.insertId;
  const [other]: any = await pool.query(
    "INSERT INTO tbl_users (email, password, role, name, loginStatus, status) VALUES (?, ?, 'user', 'Password Other', 'Y', 'Active')",
    [otherEmail, originalHash]
  );
  otherId = other.insertId;

  const beforeLogin = await invoke(login, { email, password: originalPassword });
  assert.equal(beforeLogin.statusCode, 200);
  const oldJwt = beforeLogin.data.token;

  scopes.add(`forgot:ip:${mockIp}`);
  scopes.add(`forgot:email:${email}`);
  const forgot = await invoke(forgotPassword, { email });
  assert.equal(forgot.statusCode, 200);
  assert.equal(forgot.data.message, "If the account exists, a reset link has been sent.");
  assert.match(emailedToken, /^[a-f0-9]{64}$/);
  const [saved]: any = await pool.query("SELECT token_hash FROM password_reset_tokens WHERE user_id = ?", [userId]);
  assert.equal(saved[0].token_hash, hashResetToken(emailedToken));
  assert.notEqual(saved[0].token_hash, emailedToken);

  scopes.add(`reset:ip:${mockIp}`);
  const noToken = await invoke(resetPassword, { password: resetPasswordValue, confirmPassword: resetPasswordValue });
  assert.equal(noToken.statusCode, 400);
  const randomToken = createResetToken();
  scopes.add(`reset:token:${hashResetToken(randomToken)}`);
  assert.equal((await invoke(resetPassword, { token: randomToken, password: resetPasswordValue, confirmPassword: resetPasswordValue })).statusCode, 400);

  const expiredToken = createResetToken();
  await insertToken(expiredToken, "2000-01-01 00:00:00");
  scopes.add(`reset:token:${hashResetToken(expiredToken)}`);
  assert.equal((await invoke(resetPassword, { token: expiredToken, password: resetPasswordValue, confirmPassword: resetPasswordValue })).statusCode, 400);

  const secondToken = createResetToken();
  await insertToken(secondToken, "2099-01-01 00:00:00");
  scopes.add(`reset:token:${hashResetToken(secondToken)}`);
  scopes.add(`reset:token:${hashResetToken(emailedToken)}`);
  scopes.add(`reset:user:${userId}`);
  assert.equal((await invoke(resetPassword, { token: emailedToken, password: resetPasswordValue, confirmPassword: resetPasswordValue })).statusCode, 200);
  assert.equal((await invoke(resetPassword, { token: emailedToken, password: resetPasswordValue, confirmPassword: resetPasswordValue })).statusCode, 400);
  assert.equal((await invoke(resetPassword, { token: secondToken, password: resetPasswordValue, confirmPassword: resetPasswordValue })).statusCode, 400);
  assert.equal((await invoke(login, { email, password: originalPassword })).statusCode, 400);
  assert.equal((await invoke(login, { email, password: resetPasswordValue })).statusCode, 200);

  const authResponse: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json() { return this; } };
  let nextCalled = false;
  await authenticateToken({ header: () => `Bearer ${oldJwt}` } as any, authResponse, () => { nextCalled = true; });
  assert.equal(authResponse.statusCode, 403);
  assert.equal(nextCalled, false);

  assert.equal((await invoke(changePassword, { currentPassword: "Wrong1!Password", newPassword: changedPassword, confirmPassword: changedPassword }, { id: userId! })).statusCode, 403);
  const ownChange = await invoke(changePassword, { id: otherId, currentPassword: resetPasswordValue, newPassword: changedPassword, confirmPassword: changedPassword }, { id: userId! });
  assert.equal(ownChange.statusCode, 200);
  const [otherRows]: any = await pool.query("SELECT password FROM tbl_users WHERE id = ?", [otherId]);
  assert.equal(await bcrypt.compare(originalPassword, otherRows[0].password), true);
  assert.equal((await invoke(login, { email, password: changedPassword })).statusCode, 200);

  scopes.add(`forgot:ip:${otherIp}`);
  const unknownEmail = `unknown-${suffix}@example.invalid`;
  scopes.add(`forgot:email:${unknownEmail}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const unknown = await invoke(forgotPassword, { email: unknownEmail }, undefined, otherIp);
    assert.equal(unknown.statusCode, 200);
    assert.equal(unknown.data.message, forgot.data.message);
  }
  assert.equal((await invoke(forgotPassword, { email: unknownEmail }, undefined, otherIp)).statusCode, 429);

  const repeatedToken = createResetToken();
  const resetRateIp = `password-reset-rate-${suffix}`;
  scopes.add(`reset:ip:${resetRateIp}`);
  scopes.add(`reset:token:${hashResetToken(repeatedToken)}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await invoke(resetPassword, { token: repeatedToken, password: resetPasswordValue, confirmPassword: resetPasswordValue }, undefined, resetRateIp)).statusCode, 400);
  }
  assert.equal((await invoke(resetPassword, { token: repeatedToken, password: resetPasswordValue, confirmPassword: resetPasswordValue }, undefined, resetRateIp)).statusCode, 429);
  process.stdout.write("Password reset and change integration cases passed.\n");
};

run().catch((error) => {
  process.stderr.write(`Password flow test failed: ${error.message}\n`);
  process.exitCode = 1;
}).finally(async () => {
  (resend.emails as any).send = originalSend;
  if (userId) {
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = ?", [userId]);
    await pool.query("DELETE FROM tbl_users WHERE id = ?", [userId]);
  }
  if (otherId) await pool.query("DELETE FROM tbl_users WHERE id = ?", [otherId]);
  if (scopes.size) {
    const hashes = [...scopes].map(hashResetToken);
    await pool.query("DELETE FROM password_reset_rate_limits WHERE scope_key IN (?)", [hashes]);
  }
  await pool.end();
});
