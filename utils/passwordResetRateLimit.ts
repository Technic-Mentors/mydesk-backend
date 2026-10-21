import { createHash } from "crypto";
import pool from "../database/db";

const windowMinutes = 15;

export const consumePasswordRateLimit = async (scope: string, limit: number): Promise<boolean> => {
  const key = createHash("sha256").update(scope).digest("hex");
  await pool.query(
    `INSERT INTO password_reset_rate_limits (scope_key, window_started_at, attempts)
     VALUES (?, NOW(), 1)
     ON DUPLICATE KEY UPDATE
       attempts = IF(window_started_at <= NOW() - INTERVAL ${windowMinutes} MINUTE, 1, attempts + 1),
       window_started_at = IF(window_started_at <= NOW() - INTERVAL ${windowMinutes} MINUTE, NOW(), window_started_at)`,
    [key]
  );
  const [rows]: any = await pool.query(
    "SELECT attempts FROM password_reset_rate_limits WHERE scope_key = ?",
    [key]
  );
  return Number(rows[0]?.attempts) <= limit;
};
