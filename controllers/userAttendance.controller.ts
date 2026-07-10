import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

const toMySQLDate = (dateStr: string | null): string | null => {
  if (!dateStr) return null;

  // If it's already YYYY-MM-DD (with or without time), just take the first 10 chars
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  } catch (error) {
    return null;
  }
};

const calculateWorkingHours = (
  clockIn: string,
  clockOut: string,
): string | null => {
  if (!clockIn || !clockOut) return null;

  try {
    // Use a fixed date to compare times safely
    const start = new Date(`1970-01-01T${clockIn}`);
    const end = new Date(`1970-01-01T${clockOut}`);

    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) return null;

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs / (1000 * 60)) % 60);

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`;
  } catch (error) {
    return null;
  }
};

const getAttendanceRule = async (): Promise<any | null> => {
  try {
    const [rows]: any = await pool.query(
      "SELECT * FROM attendance_rules WHERE status = 'Active' ORDER BY id DESC LIMIT 1",
    );
    return rows.length ? rows[0] : null;
  } catch (error) {
    console.error("❌ Error fetching attendance rule:", error);
    throw error;
  }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, role FROM tbl_users WHERE status = 'Y'",
    );
    res.json({ users: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch users." });
  }
};

export const getAllAttendances = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.userId, u.name, u.email, u.role, a.date, a.clockIn, a.clockOut,
              a.attendanceStatus, a.leaveStatus, a.leaveReason,
              a.workingHours, DAYNAME(a.date) AS day, a.status,
              a.latitude, a.longitude, 
              a.clockInLatitude, a.clockInLongitude,
              a.clockOutLatitude, a.clockOutLongitude
       FROM attendance a
       JOIN tbl_users u ON a.userId = u.id
       WHERE a.status = 'Y'
       ORDER BY a.date ASC, a.id ASC`,
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch attendance records." });
  }
};

export const getMyAttendances = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
          a.id,
          a.userId,
          u.email,
          a.date,
          a.clockIn,
          a.clockOut,
          a.attendanceStatus,
          a.leaveStatus,
          a.leaveReason,
          a.workingHours,
          DAYNAME(a.date) AS day,
          a.status
       FROM attendance a
       JOIN tbl_users u ON a.userId = u.id
       WHERE a.userId = ? AND a.status = 'Y'
       ORDER BY a.date ASC, a.id ASC`,
      [userId],
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch my attendance." });
  }
};

export const addAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { userId } = req.params;
  const { date, clockIn, clockOut, attendanceStatus: manualStatus } = req.body;

  try {
    const userIdNum = parseInt(userId);
    if (!userIdNum || !date || !manualStatus) {
      res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
      return;
    }

    const formattedDate = toMySQLDate(date);
    if (!formattedDate) {
      res.status(400).json({ success: false, message: "Invalid date format" });
      return;
    }

    // 1. Fetch Rule
    const rule = await getAttendanceRule();
    if (!rule) {
      res.status(400).json({
        success: false,
        message: "No active attendance rule found on server.",
      });
      return;
    }

    // 2. Weekly Off Check (Using UTC methods to avoid local server shifts)
    if (rule.offDay) {
      const dateObj = new Date(formattedDate);
      const dayName = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
      }).format(dateObj);

      if (dayName.toLowerCase() === rule.offDay.toLowerCase()) {
        res.status(400).json({
          success: false,
          message: `Cannot add attendance on ${rule.offDay} (Weekly Off)`,
        });
        return;
      }
    }

    // 3. Existing Attendance Check
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM attendance WHERE userId = ? AND date = ? AND status = 'Y'",
      [userIdNum, formattedDate],
    );

    if (existing.length > 0) {
      res.status(400).json({
        success: false,
        message: "Attendance already exists for this date of this Employee",
      });
      return;
    }

    // 4. Status Determination
    let finalStatus = manualStatus.toLowerCase();
    let workingHours = null;

    // Calculate working hours for all valid cases
    if (clockIn && clockOut) {
      workingHours = calculateWorkingHours(clockIn, clockOut);
    }

    if (finalStatus === "present") {
      if (!clockIn || !clockOut) {
        res.status(400).json({
          success: false,
          message: "Clock In/Out required for 'Present'",
        });
        return;
      }

      // Auto override
      if (rule.halfLeave && clockIn >= rule.halfLeave) {
        finalStatus = "half leave";
      } else if (rule.lateTime && clockIn >= rule.lateTime) {
        finalStatus = "late";
      }
    }

    // 5. Insert (Explicitly handling potential NULLs for Live Server Strict Mode)
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO attendance 
       (userId, date, clockIn, clockOut, attendanceStatus, workingHours, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'Y')`,
      [
        userIdNum,
        formattedDate,
        clockIn || null,
        clockOut || null,
        finalStatus,
        workingHours,
      ],
    );

    res.status(201).json({
      success: true,
      message: "Attendance added successfully",
      data: { id: result.insertId, status: finalStatus },
    });
  } catch (error: any) {
    console.error("💥 Server Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        error.code === "ER_DUP_ENTRY"
          ? "Duplicate entry detected"
          : error.message,
    });
  }
};
// In your attendance controller
export const getAttendanceByUserAndDate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, date } = req.query;

    if (!userId || !date) {
      res.status(400).json({ 
        success: false, 
        message: "UserId and date are required" 
      });
      return;
    }

    const formattedDate = toMySQLDate(date as string);
    if (!formattedDate) {
      res.status(400).json({ 
        success: false, 
        message: "Invalid date format" 
      });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, userId, date, clockIn, clockOut, attendanceStatus, workingHours 
       FROM attendance 
       WHERE userId = ? AND date = ? AND status = 'Y'`,
      [userId, formattedDate]
    );

    if (rows.length === 0) {
      res.status(404).json({ 
        success: false, 
        message: "No attendance found for this user on this date" 
      });
      return;
    }

    res.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (error) {
    console.error("Error fetching attendance:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch attendance" 
    });
  }
};
export const updateAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  const {
    userId,
    date,
    clockIn,
    clockOut,
    attendanceStatus: reqStatus,
  } = req.body;

  try {
    const formattedDate = toMySQLDate(date);

    const rule = await getAttendanceRule();

    let finalStatus = reqStatus?.toLowerCase();
    let workingHours = calculateWorkingHours(clockIn, clockOut);

    if (finalStatus === "present") {
      if (rule) {
        if (rule.halfLeave && clockIn >= rule.halfLeave) {
          finalStatus = "half leave";
        } else if (rule.lateTime && clockIn >= rule.lateTime) {
          finalStatus = "late";
        }
      }
    }

    await pool.query<ResultSetHeader>(
      `UPDATE attendance
   SET date = ?, clockIn = ?, clockOut = ?,
       attendanceStatus = ?, workingHours = ?
   WHERE id = ?`,
      [
        formattedDate,
        clockIn || null,
        clockOut || null,
        finalStatus,
        workingHours,
        id,
      ],
    );

    res.json({ message: "Attendance updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update attendance." });
  }
};

export const deleteAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  try {
    await pool.query<ResultSetHeader>(
      "UPDATE attendance SET status = 'N' WHERE id = ?",
      [id],
    );

    res.json({ message: "Attendance deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete attendance." });
  }
};
