import { Request, Response } from "express";
import pool from "../database/db";
import { ensureMobileClockSettings } from "./attendanceMobileSettings.controller";

interface AttendanceRule {
  id?: number;
  startTime: string;
  endTime: string;
  offDay: string;
  lateTime: string;
  halfLeave: string;
  month: string;
  year: string;
  status?: string;
  shortLeaveThreshold?: number;
  officeLatitude?: number | null;
  officeLongitude?: number | null;
  allowedRadius?: number;
  allowClockIn?: boolean;
  allowClockOut?: boolean;
}

export const getAllConfigTime = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM attendance_rules ORDER BY id ASC",
    );
    res.json(rows);
  } catch (error) {
    console.error("Fetch Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// ✅ NEW: Get active attendance rule
export const getActiveConfigTime = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM attendance_rules WHERE status = 'Active' LIMIT 1",
    );
    if (!rows || (rows as any[]).length === 0) {
      res.status(404).json({ message: "No active attendance rule found" });
      return;
    }
    res.json((rows as any[])[0]);
  } catch (error) {
    console.error("Fetch Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const addConfigTime = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      startTime,
      endTime,
      offDay,
      lateTime,
      halfLeave,
      month,
      year,
      shortLeaveThreshold,
      officeLatitude,
      officeLongitude,
      allowedRadius,
      allowClockIn,
      allowClockOut,
    } = req.body as AttendanceRule;

    if (
      !startTime ||
      !endTime ||
      !offDay ||
      !lateTime ||
      !halfLeave ||
      !year ||
      !month
    ) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }

    if (startTime >= endTime) {
      res.status(400).json({ message: "Start Time must be before End Time" });
      return;
    }

    if ((allowClockIn !== undefined || allowClockOut !== undefined) &&
        (typeof allowClockIn !== "boolean" || typeof allowClockOut !== "boolean")) {
      res.status(400).json({ message: "Both mobile clock settings must be booleans" });
      return;
    }

    const threshold = shortLeaveThreshold || 120;
    const radius = allowedRadius || 100;

    if (allowClockIn !== undefined) await ensureMobileClockSettings();
    const connection = await pool.getConnection();
    let result: any;
    try {
      await connection.beginTransaction();
      await connection.query("UPDATE attendance_rules SET status = 'Inactive'");
      [result] = await connection.query(
        `INSERT INTO attendance_rules
         (startTime, endTime, offDay, lateTime, halfLeave, month, year, status, shortLeaveThreshold,
          officeLatitude, officeLongitude, allowedRadius)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          startTime, endTime, offDay, lateTime, halfLeave, month, year, "Active", threshold,
          officeLatitude ?? null, officeLongitude ?? null, radius,
        ],
      );

      if (allowClockIn !== undefined) {
        await connection.query(
          "UPDATE attendance_mobile_settings SET allowClockIn = ?, allowClockOut = ? WHERE id = 1",
          [allowClockIn, allowClockOut]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.status(201).json({
      message: "Attendance rule added successfully",
      id: (result as any).insertId,
    });
  } catch (error) {
    console.error("Insert Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const updateConfigTime = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      startTime,
      endTime,
      offDay,
      lateTime,
      halfLeave,
      month,
      year,
      status,
      shortLeaveThreshold,
      officeLatitude,
      officeLongitude,
      allowedRadius,
      allowClockIn,
      allowClockOut,
    } = req.body as AttendanceRule;

    const [existing]: any = await pool.query(
      "SELECT status FROM attendance_rules WHERE id = ? LIMIT 1",
      [id],
    );

    if (!existing.length) {
      res.status(404).json({ message: "Attendance rule not found" });
      return;
    }

    if (existing[0].status !== "Active") {
      res.status(400).json({
        message: "Only Active attendance rule can be edited",
      });
      return;
    }

    if (
      !startTime ||
      !endTime ||
      !offDay ||
      !lateTime ||
      !halfLeave ||
      !month ||
      !year
    ) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }

    if (
      halfLeave < startTime ||
      (halfLeave > endTime && lateTime < startTime) ||
      lateTime > endTime
    ) {
      res.status(400).json({
        message: "Late and Half Leave Time must be within Office Hours",
      });
      return;
    }

    if (lateTime < startTime || lateTime > endTime) {
      res
        .status(400)
        .json({ message: "Late Time must be within Office Hours" });
      return;
    }

    if (halfLeave < startTime || halfLeave > endTime) {
      res
        .status(400)
        .json({ message: "Half Leave must be within Office Hours" });
      return;
    }

    if ((allowClockIn !== undefined || allowClockOut !== undefined) &&
        (typeof allowClockIn !== "boolean" || typeof allowClockOut !== "boolean")) {
      res.status(400).json({ message: "Both mobile clock settings must be booleans" });
      return;
    }

    const threshold = shortLeaveThreshold || 120;
    const radius = allowedRadius || 100;

    if (allowClockIn !== undefined) await ensureMobileClockSettings();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
      `UPDATE attendance_rules
       SET startTime = ?,
           endTime = ?,
           offDay = ?,
           lateTime = ?,
           halfLeave = ?,
           month = ?,
           year = ?,
           status = ?,
           shortLeaveThreshold = ?,
           officeLatitude = ?,
           officeLongitude = ?,
           allowedRadius = ?
       WHERE id = ?`,
      [
        startTime,
        endTime,
        offDay,
        lateTime,
        halfLeave,
        month,
        year,
        status ?? "Active",
        threshold,
        officeLatitude ?? null,
        officeLongitude ?? null,
        radius,
        id,
      ],
      );
      if (allowClockIn !== undefined) {
        await connection.query(
          "UPDATE attendance_mobile_settings SET allowClockIn = ?, allowClockOut = ? WHERE id = 1",
          [allowClockIn, allowClockOut]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({ message: "Attendance rule updated successfully" });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const deleteConfigTime = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM attendance_rules WHERE id = ?", [id]);
    res.json({ message: "Attendance rule deleted" });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};