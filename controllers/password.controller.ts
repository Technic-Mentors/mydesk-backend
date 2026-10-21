import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwtSecret";
import pool from "../database/db";
import { randomBytes } from "crypto";
import { sendSensitiveEmail } from "../services/emailService";
import { adminPasswordResetNotice, passwordChangedNotice } from "../services/employeeNotificationEvents";
import { passwordResetUrl } from "../config/passwordReset";
import { AuthenticatedRequest } from "../middleware/middleware";
import { createResetToken, hashResetToken, passwordValidationError } from "../utils/passwordSecurity";
import { consumePasswordRateLimit } from "../utils/passwordResetRateLimit";

const genericResponse = { message: "If the account exists, a reset link has been sent." };
const invalidTokenResponse = { message: "Reset link is invalid, expired, or already used." };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestIp = (req: Request): string => req.ip || req.socket.remoteAddress || "unknown";

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!await consumePasswordRateLimit(`forgot:ip:${requestIp(req)}`, 10)) {
      res.status(429).json({ message: "Too many reset requests. Try again later." });
      return;
    }
    const email = req.body?.email;
    if (typeof email !== "string" || email.length > 254 || !emailPattern.test(email.trim())) {
      res.status(400).json({ message: "A valid email is required" });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!await consumePasswordRateLimit(`forgot:email:${normalizedEmail}`, 3)) {
      res.status(429).json({ message: "Too many reset requests. Try again later." });
      return;
    }

    const [users]: any = await pool.query(
      "SELECT id, email, name FROM tbl_users WHERE LOWER(email) = ? AND status = 'Active' LIMIT 1",
      [normalizedEmail]
    );
    if (users.length) {
      let issuedTokenHash: string | undefined;
      try {
        const rawToken = createResetToken();
        const tokenHash = hashResetToken(rawToken);
        await pool.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
          [users[0].id, tokenHash]
        );
        issuedTokenHash = tokenHash;

        const link = new URL(passwordResetUrl);
        link.hash = new URLSearchParams({ token: rawToken }).toString();
        await sendSensitiveEmail(users[0].email,"Reset Your MyDesk Password",
          `Hello ${users[0].name},\n\nWe received a request to reset your MyDesk password. This link expires in 15 minutes and can only be used once. If you did not request this, you can ignore this email.`,link.toString());
      } catch {
        if (issuedTokenHash) {
          try {
            await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ?", [issuedTokenHash]);
          } catch {
            // A token that was not emailed remains unknown to the requester.
          }
        }
        // The response stays generic even when delivery fails for an existing account.
      }
    }
    res.status(200).json(genericResponse);
  } catch {
    res.status(500).json({ message: "Unable to process reset request" });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!await consumePasswordRateLimit(`reset:ip:${requestIp(req)}`, 20)) {
      res.status(429).json({ message: "Too many reset attempts. Try again later." });
      return;
    }
    const { token, password, confirmPassword } = req.body ?? {};
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      res.status(400).json(invalidTokenResponse);
      return;
    }
    const validationError = passwordValidationError(password, confirmPassword);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }
    const tokenHash = hashResetToken(token);
    if (!await consumePasswordRateLimit(`reset:token:${tokenHash}`, 5)) {
      res.status(429).json({ message: "Too many reset attempts. Try again later." });
      return;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows]: any = await connection.query(
        `SELECT id, user_id, used_at, (expires_at > NOW()) AS not_expired
         FROM password_reset_tokens WHERE token_hash = ? FOR UPDATE`,
        [tokenHash]
      );
      const reset = rows[0];
      if (!reset || reset.used_at || !reset.not_expired) {
        await connection.rollback();
        res.status(400).json(invalidTokenResponse);
        return;
      }
      if (!await consumePasswordRateLimit(`reset:user:${reset.user_id}`, 10)) {
        await connection.rollback();
        res.status(429).json({ message: "Too many reset attempts. Try again later." });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const [updated]: any = await connection.query(
        "UPDATE tbl_users SET password = ?, must_change_password = 0, auth_version = auth_version + 1 WHERE id = ?",
        [hashedPassword, reset.user_id]
      );
      if (updated.affectedRows !== 1) {
        await connection.rollback();
        res.status(400).json(invalidTokenResponse);
        return;
      }
      await connection.query(
        "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
        [reset.user_id]
      );
      await connection.commit();
      try { await passwordChangedNotice(reset.user_id,Number(reset.id)); }
      catch { console.error("Password reset confirmation notification failed for user ID",reset.user_id); }
      res.status(200).json({ message: "Password reset successfully. Please sign in again." });
    } catch {
      await connection.rollback();
      res.status(500).json({ message: "Unable to reset password" });
    } finally {
      connection.release();
    }
  } catch {
    res.status(500).json({ message: "Unable to reset password" });
  }
};

export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user?.id) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || !currentPassword) {
    res.status(400).json({ message: "Current password is required" });
    return;
  }
  const validationError = passwordValidationError(newPassword, confirmPassword);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ message: "New password must differ from current password" });
    return;
  }

  let connection: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [users]: any = await connection.query(
      "SELECT password,auth_version FROM tbl_users WHERE id = ? FOR UPDATE",
      [req.user.id]
    );
    if (!users.length || !await bcrypt.compare(currentPassword, users[0].password)) {
      await connection.rollback();
      res.status(403).json({ message: "Current password is incorrect" });
      return;
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await connection.query(
      "UPDATE tbl_users SET password = ?, must_change_password = 0, auth_version = auth_version + 1 WHERE id = ?",
      [hashedPassword, req.user.id]
    );
    await connection.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
      [req.user.id]
    );
    const currentToken = req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    const currentClaims = jwt.decode(currentToken);
    const expiresAt = currentClaims && typeof currentClaims === "object" && typeof currentClaims.exp === "number"
      ? currentClaims.exp : Math.floor(Date.now() / 1000) + 86400;
    const token = jwt.sign({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      authVersion: Number(users[0].auth_version) + 1,
      exp: expiresAt,
    }, getJwtSecret());
    await connection.commit();
    try { await passwordChangedNotice(req.user.id,Number(users[0].auth_version)+1); }
    catch { console.error("Password change confirmation notification failed for user ID",req.user.id); }
    res.status(200).json({ message: "Password changed successfully.", token });
  } catch {
    if (connection) await connection.rollback();
    res.status(500).json({ message: "Unable to change password" });
  } finally {
    connection?.release();
  }
};

export const adminResetPassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const employeeId = Number(req.params.id);
  if (!Number.isSafeInteger(employeeId) || employeeId < 1) { res.status(400).json({message:"Invalid employee ID"}); return; }
  try {
    const [rows]: any = await pool.query("SELECT id,name,email,role,status FROM tbl_users WHERE id=?",[employeeId]);
    const user = rows[0];
    if (!user || user.status !== "Active" || user.role.toLowerCase() !== "user") { res.status(404).json({message:"Active employee not found"}); return; }
    const temporaryPassword = randomBytes(18).toString("base64url");
    const passwordHash = await bcrypt.hash(temporaryPassword,10);
    await pool.query("UPDATE tbl_users SET password=?,must_change_password=1,auth_version=auth_version+1 WHERE id=?",[passwordHash,employeeId]);
    await pool.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=? AND used_at IS NULL",[employeeId]);
    try { await sendSensitiveEmail(user.email,"Your MyDesk Password Was Reset",
      `Hello ${user.name},\n\nAn administrator reset your MyDesk password.\nLogin email: ${user.email}\nTemporary password: ${temporaryPassword}\n\nPlease change this temporary password when you next sign in.`,
      `${process.env.FRONTEND_URL || "http://localhost:5173"}/login`); }
    catch { console.error("Administrator password reset email failed for employee ID",employeeId); }
    try { await adminPasswordResetNotice(employeeId); }
    catch { console.error("Administrator password reset notification failed for employee ID",employeeId); }
    res.json({message:"Employee password reset. The temporary password was sent to the registered email."});
  } catch { res.status(500).json({message:"Unable to reset employee password"}); }
};
