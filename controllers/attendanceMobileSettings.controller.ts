import { Request, Response } from "express";
import pool from "../database/db";

export type MobileClockSettings = { allowClockIn: boolean; allowClockOut: boolean };

let initialization: Promise<void> | null = null;

// Existing installations may not have run the migration yet. Initialize once
// per process and retry if a transient database error interrupts setup.
export const ensureMobileClockSettings = async (): Promise<void> => {
  if (!initialization) {
    initialization = (async () => {
      try {
        const [rows]: any = await pool.query(
          "SELECT id FROM attendance_mobile_settings WHERE id = 1"
        );
        if (rows.length > 0) return;
      } catch (error: any) {
        if (error.code !== "ER_NO_SUCH_TABLE") throw error;
        await pool.query(`CREATE TABLE IF NOT EXISTS attendance_mobile_settings (
          id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
          allowClockIn TINYINT(1) NOT NULL DEFAULT 1,
          allowClockOut TINYINT(1) NOT NULL DEFAULT 1
        )`);
      }
      await pool.query(
        "INSERT IGNORE INTO attendance_mobile_settings (id, allowClockIn, allowClockOut) VALUES (1, 1, 1)"
      );
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
};

export const getMobileClockSettings = async (): Promise<MobileClockSettings> => {
  await ensureMobileClockSettings();
  const [rows]: any = await pool.query(
    "SELECT allowClockIn, allowClockOut FROM attendance_mobile_settings WHERE id = 1"
  );
  return {
    allowClockIn: Boolean(rows[0].allowClockIn),
    allowClockOut: Boolean(rows[0].allowClockOut),
  };
};

export const isMobileAttendanceRequest = (req: Request): boolean => {
  const clientHint = req.get("sec-ch-ua-mobile");
  if (clientHint === "?1") return true;
  const userAgent = req.get("user-agent") || "";
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS|BlackBerry/i.test(userAgent);
};

export const readMobileClockSettings = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getMobileClockSettings());
  } catch (error) {
    console.error("Mobile attendance settings read failed:", error);
    res.status(500).json({ message: "Mobile attendance settings are unavailable. Apply the attendance mobile settings migration if database schema creation is restricted." });
  }
};

export const updateMobileClockSettings = async (req: Request, res: Response): Promise<void> => {
  const { allowClockIn, allowClockOut } = req.body;
  if (typeof allowClockIn !== "boolean" || typeof allowClockOut !== "boolean") {
    res.status(400).json({ message: "Both mobile clock settings must be booleans" });
    return;
  }
  try {
    await ensureMobileClockSettings();
    await pool.query(
      "UPDATE attendance_mobile_settings SET allowClockIn = ?, allowClockOut = ? WHERE id = 1",
      [allowClockIn, allowClockOut]
    );
    res.json({ allowClockIn, allowClockOut });
  } catch (error) {
    console.error("Mobile attendance settings update failed:", error);
    res.status(500).json({ message: "Unable to update mobile attendance settings" });
  }
};
