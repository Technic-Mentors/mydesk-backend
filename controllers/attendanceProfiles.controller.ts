import { Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../database/db";
import { ensureAttendanceProfileSchema } from "../services/attendanceProfiles";

const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;
const normalizeTime = (value: unknown): string | null => {
  if (typeof value !== "string" || !timePattern.test(value)) return null;
  const [hour, minute, second = "00"] = value.split(":");
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  return `${hour}:${minute}:${second}`;
};
const normalizeOffDays = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const allowed = new Map(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, day[0].toUpperCase() + day.slice(1)]));
  const days = [...new Set(value.map(day => typeof day === "string" ? allowed.get(day.trim().toLowerCase()) : undefined))];
  return days.some(day => !day) ? null : days as string[];
};
const parseProfile = (body: Request["body"]) => {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const startTime = normalizeTime(body.startTime);
  const endTime = normalizeTime(body.endTime);
  const lateTime = normalizeTime(body.lateTime);
  const halfLeave = normalizeTime(body.halfLeave);
  const offDays = normalizeOffDays(body.offDays);
  const status = body.status === undefined ? "Active" : body.status;
  if (!name || name.length > 120 || !startTime || !endTime || !lateTime || !halfLeave || !offDays || !["Active", "Inactive"].includes(status)) return null;
  if (startTime >= endTime || lateTime < startTime || lateTime > endTime || halfLeave < startTime || halfLeave > endTime) return null;
  return { name, startTime, endTime, lateTime, halfLeave, offDays: offDays.join(","), status: status as "Active" | "Inactive" };
};

export const listAttendanceProfiles = async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureAttendanceProfileSchema();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.name, p.startTime, p.endTime, p.lateTime, p.halfLeave,
              p.offDays, p.status, COUNT(a.userId) AS assignedEmployees
       FROM attendance_profiles p
       LEFT JOIN employee_attendance_profiles a ON a.profileId = p.id
       GROUP BY p.id ORDER BY p.name ASC`,
    );
    res.json(rows.map(row => ({ ...row, offDays: String(row.offDays || "").split(",").filter(Boolean) })));
  } catch (error) {
    console.error("List attendance profiles failed:", error);
    res.status(500).json({ message: "Failed to load attendance profiles" });
  }
};

export const createAttendanceProfile = async (req: Request, res: Response): Promise<void> => {
  const profile = parseProfile(req.body);
  if (!profile) { res.status(400).json({ message: "Provide a unique name, valid shift times, thresholds within the shift, and at least one off day." }); return; }
  try {
    await ensureAttendanceProfileSchema();
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO attendance_profiles (name, startTime, endTime, lateTime, halfLeave, offDays, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [profile.name, profile.startTime, profile.endTime, profile.lateTime, profile.halfLeave, profile.offDays, profile.status],
    );
    res.status(201).json({ id: result.insertId, message: "Attendance profile created" });
  } catch (error) {
    const duplicate = (error as { code?: string }).code === "ER_DUP_ENTRY";
    res.status(duplicate ? 409 : 500).json({ message: duplicate ? "A profile with this name already exists" : "Failed to create attendance profile" });
  }
};

export const updateAttendanceProfile = async (req: Request, res: Response): Promise<void> => {
  const profile = parseProfile(req.body);
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || !profile) { res.status(400).json({ message: "Invalid attendance profile" }); return; }
  try {
    await ensureAttendanceProfileSchema();
    const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM attendance_profiles WHERE id=? LIMIT 1", [id]);
    if (!existing.length) { res.status(404).json({ message: "Attendance profile not found" }); return; }
    await pool.query<ResultSetHeader>(
      `UPDATE attendance_profiles SET name=?, startTime=?, endTime=?, lateTime=?, halfLeave=?, offDays=?, status=? WHERE id=?`,
      [profile.name, profile.startTime, profile.endTime, profile.lateTime, profile.halfLeave, profile.offDays, profile.status, id],
    );
    res.json({ message: "Attendance profile updated" });
  } catch (error) {
    const duplicate = (error as { code?: string }).code === "ER_DUP_ENTRY";
    res.status(duplicate ? 409 : 500).json({ message: duplicate ? "A profile with this name already exists" : "Failed to update attendance profile" });
  }
};

export const deleteAttendanceProfile = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ message: "Invalid attendance profile" }); return; }
  try {
    await ensureAttendanceProfileSchema();
    const [assignments] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM employee_attendance_profiles WHERE profileId=?", [id]);
    if (Number(assignments[0]?.total || 0) > 0) { res.status(409).json({ message: "Reassign employees before deleting this profile" }); return; }
    const [result] = await pool.query<ResultSetHeader>("DELETE FROM attendance_profiles WHERE id=?", [id]);
    if (!result.affectedRows) { res.status(404).json({ message: "Attendance profile not found" }); return; }
    res.json({ message: "Attendance profile deleted" });
  } catch (error) {
    console.error("Delete attendance profile failed:", error);
    res.status(500).json({ message: "Failed to delete attendance profile" });
  }
};
