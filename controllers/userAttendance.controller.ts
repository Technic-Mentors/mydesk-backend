import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { adminAttendanceRecorded, adminAttendanceUpdated, decisionEvent, nonCriticalNotification } from "../services/notificationEvents";

const toMySQLDate = (dateStr: string | null): string | null => {
  if (!dateStr) return null;
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

const fullDayLeaveStatuses = new Set([
  "leave", "full day", "sick leave", "casual leave", "annual leave", "family responsibility",
]);

const attendanceStatusForLeaveType = (leaveType: string): string => {
  const type = leaveType.trim().toUpperCase();
  if (type === "HALF DAY") return "half leave";
  if (type === "SHORT LEAVE") return "short leave";
  return type.toLowerCase();
};

const leaveTypeForAttendanceStatus = (status: string): string =>
  status.trim().toLowerCase() === "half leave" ? "HALF DAY" :
  status.trim().toLowerCase() === "leave" ? "FULL DAY" :
  status.trim().toUpperCase();

const findConflictingApprovedLeave = async (
  userId: number, date: string, attendanceStatus: string,
): Promise<RowDataPacket | null> => {
  const status = attendanceStatus.trim().toLowerCase();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, leaveType, leaveSubject FROM leaves " +
      "WHERE userId = ? AND status = 'Y' AND LOWER(leaveStatus) = 'approved' " +
      "AND ? BETWEEN fromDate AND toDate",
    [userId, date],
  );
  return rows.find((leave) => {
    const matching = attendanceStatusForLeaveType(
      String(leave.leaveType || leave.leaveSubject || ""));
    return status !== matching && !(status === "leave" && matching === "full day");
  }) || null;
};

const findPendingLeaveForDate = async (userId: number, date: string): Promise<RowDataPacket | null> => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, leaveType, leaveSubject FROM leaves WHERE userId = ? AND status = 'Y' AND leaveStatus = 'Pending' " +
      "AND ? BETWEEN fromDate AND toDate ORDER BY id DESC LIMIT 1",
    [userId, date],
  );
  return rows[0] || null;
};

const approveOrCreateAttendanceLeave = async (
  connection: any, userId: number, date: string, attendanceStatus: string, createWhenMissing: boolean,
): Promise<number | null> => {
  const [rows]: any = await connection.query(
    "SELECT id, leaveStatus FROM leaves WHERE userId = ? AND status = 'Y' " +
      "AND leaveStatus IN ('Pending', 'Approved') AND ? BETWEEN fromDate AND toDate " +
      "ORDER BY FIELD(leaveStatus, 'Pending', 'Approved'), id DESC LIMIT 1 FOR UPDATE",
    [userId, date],
  );
  if (rows.length) {
    if (rows[0].leaveStatus === "Pending") {
      await connection.query("UPDATE leaves SET leaveStatus = 'Approved' WHERE id = ?", [rows[0].id]);
      return Number(rows[0].id);
    }
    return null;
  }
  if (!createWhenMissing) throw new Error("Pending leave request changed; refresh attendance and try again.");
  const [result]: any = await connection.query(
    "INSERT INTO leaves (userId, fromDate, toDate, leaveType, leaveSubject, leaveReason, leaveStatus, status) " +
      "VALUES (?, ?, ?, ?, ?, 'Marked as leave in attendance', 'Approved', 'Y')",
    [userId, date, date, leaveTypeForAttendanceStatus(attendanceStatus), leaveTypeForAttendanceStatus(attendanceStatus)],
  );
  // A newly created administrative leave is already approved; notify its employee.
  return Number(result.insertId);
};

const calculateWorkingHours = (
  clockIn: string,
  clockOut: string,
): string | null => {
  if (!clockIn || !clockOut) return null;
  try {
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

// ============================================================
// GET USERS
// ============================================================
export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        id, 
        name, 
        email, 
        contact, 
        cnic, 
        address, 
        date, 
        role, 
        status,
        loginStatus,
        image,
        position,
        salary,
        created_at,
        updated_at
      FROM tbl_users 
      WHERE LOWER(role) = 'user'`
    );
    const selectedDate = typeof req.query.date === "string" ? toMySQLDate(req.query.date) : null;
    if (!selectedDate) {
      res.json({ users: rows });
      return;
    }
    const [statuses] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, COALESCE(
          (SELECT a.attendanceStatus FROM attendance a
           WHERE a.userId = u.id AND a.date = ? AND a.status = 'Y'
             AND a.attendanceStatus IS NOT NULL
           ORDER BY a.id DESC LIMIT 1),
          (SELECT CONCAT('Leave (', l.leaveStatus, ')') FROM leaves l
           WHERE l.userId = u.id AND ? BETWEEN l.fromDate AND l.toDate
             AND l.status = 'Y' AND l.leaveStatus IN ('Approved', 'Pending')
           ORDER BY FIELD(l.leaveStatus, 'Approved', 'Pending') LIMIT 1),
          (SELECT 'Remote Work' FROM attendance r
           WHERE r.userId = u.id AND r.remoteStatus = 'Approved'
             AND r.remoteFromDate <= ? AND r.remoteToDate >= ?
             AND r.status = 'Y' LIMIT 1),
          'No attendance'
        ) AS attendanceCurrentStatus
       FROM tbl_users u WHERE LOWER(u.role) = 'user'`,
      [selectedDate, selectedDate, selectedDate, selectedDate]
    );
    const byId = new Map(statuses.map((row) => [Number(row.id), row.attendanceCurrentStatus]));
    res.json({ users: rows.map((row) => ({
      ...row,
      attendanceCurrentStatus: byId.get(Number(row.id)) || "No attendance"
    })) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch users." });
  }
};
// ============================================================
// GET ALL ATTENDANCES - ✅ WITH REMOTE FIELDS
// ============================================================
export const getAllAttendances = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.userId, u.name, u.email, u.role, DATE_FORMAT(a.date, '%Y-%m-%d') AS date, a.clockIn, a.clockOut,
              a.attendanceStatus, a.leaveStatus, a.leaveReason,
              a.workingHours, DAYNAME(DATE(a.date)) AS day, a.status,
              a.latitude, a.longitude, 
              a.clockInLatitude, a.clockInLongitude,
              a.clockOutLatitude, a.clockOutLongitude,
              -- ✅ Remote fields
              a.type,
              a.remoteStatus,
              a.remoteApprovedBy,
              a.remoteApprovedAt,
              a.remoteRejectedReason,
              a.remoteRequestDate,
              a.remoteFromDate,
              a.remoteToDate,
              a.remoteReason
       FROM attendance a
       JOIN tbl_users u ON a.userId = u.id
       WHERE a.status = 'Y'
         AND DATE(a.date) >= COALESCE(DATE(u.date), DATE(u.created_at))
       ORDER BY a.date ASC, a.id ASC`,
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch attendance records." });
  }
};

// ============================================================
// GET MY ATTENDANCES - ✅ WITH REMOTE FIELDS
// ============================================================
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
        DATE_FORMAT(a.date, '%Y-%m-%d') AS date,
          a.clockIn,
          a.clockOut,
          a.attendanceStatus,
          a.leaveStatus,
          a.leaveReason,
          a.workingHours,
          DAYNAME(DATE(a.date)) AS day,
          a.status,
          -- ✅ Remote fields
          a.type,
          a.remoteStatus,
          a.remoteRequestDate,
          a.remoteFromDate,
          a.remoteToDate,
          a.remoteReason
       FROM attendance a
       JOIN tbl_users u ON a.userId = u.id
       WHERE a.userId = ? AND a.status = 'Y'
         AND DATE(a.date) >= COALESCE(DATE(u.date), DATE(u.created_at))
       ORDER BY a.date ASC, a.id ASC`,
      [userId],
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch my attendance." });
  }
};

// ============================================================
// ADD ATTENDANCE - ✅ WITH REMOTE FIELDS
// ============================================================
export const addAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { userId } = req.params;
  const { 
    date, 
    clockIn, 
    clockOut, 
    attendanceStatus: manualStatus,
    type,
    remoteStatus,
    remoteRequestDate,
    remoteFromDate,
    remoteToDate,
    remoteReason,
    remoteApprovedBy
  } = req.body;


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


    const rule = await getAttendanceRule();
    if (!rule) {
      res.status(400).json({
        success: false,
        message: "No active attendance rule found on server.",
      });
      return;
    }

    // Weekly Off Check
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

    let finalStatus = manualStatus.toLowerCase();
    let workingHours = null;

    // ✅ Existing Attendance Check. Short Leave is allowed up to 2 clock-in/out
    // cycles for the same day (matching the employee self-service clock-in
    // flow), so admin can add a second cycle instead of being hard-blocked.
    // Every other status still allows only a single record per day.
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id, attendanceStatus FROM attendance WHERE userId = ? AND date = ? AND status = 'Y'",
      [userIdNum, formattedDate],
    );

    if (finalStatus === "short leave") {
      if (existing.length >= 2) {
        res.status(400).json({
          success: false,
          message: "Maximum of 2 clock-in/out cycles reached for Short Leave on this date",
        });
        return;
      }
      if (existing.some((row) => row.attendanceStatus !== "short leave")) {
        res.status(400).json({
          success: false,
          message: "Attendance already exists for this date with a different status",
        });
        return;
      }
    } else if (existing.length > 0) {
      res.status(400).json({
        success: false,
        message: "Attendance already exists for this date of this Employee",
      });
      return;
    }


    if (clockIn && clockOut) {
      workingHours = calculateWorkingHours(clockIn, clockOut);
    }

    if (finalStatus === "present") {
      if (!clockIn ) {
        res.status(400).json({
          success: false,
          message: "Clock In required for 'Present'",
        });
        return;
      }
      if (rule.halfLeave && clockIn >= rule.halfLeave) {
        finalStatus = "half leave";
      } else if (rule.lateTime && clockIn >= rule.lateTime) {
        finalStatus = "late";
      }
    }


    // ✅ Insert attendance
    const pendingLeave = await findPendingLeaveForDate(Number(userId), formattedDate);
    const applicableStatus = pendingLeave
      ? attendanceStatusForLeaveType(String(pendingLeave.leaveType || pendingLeave.leaveSubject || ""))
      : null;
    if (pendingLeave && String(manualStatus).toLowerCase() !== applicableStatus) {
      res.status(409).json({
        success: false,
        code: "PENDING_LEAVE_STATUS_CONFLICT",
        leaveId: pendingLeave.id,
        message: "This employee has a pending leave request for this date. You cannot mark " + manualStatus + ". Mark " + applicableStatus + " to approve it, or reject the leave request first.",
      });
      return;
    }

    const approvedLeave = await findConflictingApprovedLeave(
      userIdNum, formattedDate, manualStatus);
    if (approvedLeave) {
      res.status(409).json({
        success: false,
        code: "APPROVED_LEAVE_REQUIRES_REJECTION",
        leaveId: approvedLeave.id,
        message: "Reject the approved leave request before changing attendance status.",
      });
      return;
    }

    const connection = await pool.getConnection();
    let attendanceId: number;
    let approvedLeaveId: number | null = null;
    try {
      await connection.beginTransaction();
      const [result]: any = await connection.query(
        `INSERT INTO attendance
         (userId, date, clockIn, clockOut, attendanceStatus, workingHours, status,
          type, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, remoteReason, remoteApprovedBy)
         VALUES (?, ?, ?, ?, ?, ?, 'Y', ?, ?, ?, ?, ?, ?, ?)`,
        [
          userIdNum, formattedDate,
          fullDayLeaveStatuses.has(finalStatus) ? null : clockIn || null,
          fullDayLeaveStatuses.has(finalStatus) ? null : clockOut || null,
          finalStatus, fullDayLeaveStatuses.has(finalStatus) ? null : workingHours,
          type || "Onsite", remoteStatus || null,
          remoteRequestDate || null, remoteFromDate || null, remoteToDate || null,
          remoteReason || null, remoteApprovedBy || null,
        ],
      );
      attendanceId = Number(result.insertId);
      if (fullDayLeaveStatuses.has(finalStatus) || pendingLeave) {
        approvedLeaveId = await approveOrCreateAttendanceLeave(
          connection, userIdNum, formattedDate, finalStatus, fullDayLeaveStatuses.has(finalStatus),
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (approvedLeaveId) {
      await nonCriticalNotification(() => decisionEvent("leave", userIdNum, approvedLeaveId!, "Approved"));
    }

    await nonCriticalNotification(() => adminAttendanceRecorded(
      userIdNum, attendanceId, formattedDate, finalStatus, clockIn, clockOut
    ));

    res.status(201).json({
      success: true,
      message: "Attendance added successfully",
      data: { id: attendanceId, status: finalStatus },
    });
  } catch (error: any) {
    console.error("💥💥💥 SERVER ERROR:", error);
    console.error("💥 Error message:", error.message);
    console.error("💥 Stack trace:", error.stack);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.code === "ER_DUP_ENTRY" ? "Duplicate entry detected" : error.message,
    });
  }
};

// ============================================================
// GET ATTENDANCE BY USER AND DATE - ✅ WITH REMOTE FIELDS
// ============================================================
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
      `SELECT id, userId, date, clockIn, clockOut, attendanceStatus, workingHours,
              type, remoteStatus, remoteFromDate, remoteToDate, remoteReason
       FROM attendance
       WHERE userId = ? AND date = ? AND status = 'Y'
       ORDER BY id ASC`,
      [userId, formattedDate]
    );

    if (rows.length === 0) {
      const [leaveRows] = await pool.query<RowDataPacket[]>(
        `SELECT leaveStatus FROM leaves
         WHERE userId = ? AND ? BETWEEN fromDate AND toDate
           AND status = 'Y' AND leaveStatus IN ('Approved', 'Pending')
         ORDER BY FIELD(leaveStatus, 'Approved', 'Pending') LIMIT 1`,
        [userId, formattedDate]
      );
      const [remoteRows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM attendance
         WHERE userId = ? AND remoteStatus = 'Approved'
           AND remoteFromDate <= ? AND remoteToDate >= ?
           AND status = 'Y' LIMIT 1`,
        [userId, formattedDate, formattedDate]
      );
      res.json({
        success: true,
        data: null,
        cycles: [],
        currentStatus: leaveRows.length
          ? `Leave (${leaveRows[0].leaveStatus})`
          : remoteRows.length ? "Remote Work" : "No attendance"
      });
      return;
    }

    // ✅ Short Leave (and similar) can have multiple clock-in/out cycles for
    // the same day. `data` stays the first cycle for backward compatibility,
    // `cycles` carries every record so the caller can render/edit all of them.
    res.json({
      success: true,
      data: rows[0],
      cycles: rows
    });
  } catch (error) {
    console.error("Error fetching attendance:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch attendance" 
    });
  }
};

// ============================================================
// UPDATE ATTENDANCE - ✅ WITH REMOTE FIELDS
// ============================================================
// ============================================================
// ============================================================
// UPDATE ATTENDANCE - ✅ WITH PROPER OPTIONAL CLOCKOUT
// ============================================================
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
    // ✅ Remote fields (if any)
    type,
    remoteStatus,
    remoteApprovedBy,
    remoteApprovedAt,
    remoteRejectedReason,
    remoteRequestDate,
    remoteFromDate,
    remoteToDate,
    remoteReason
  } = req.body;

  try {
    // ✅ Validate required fields
    if (!userId || !date || !reqStatus) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: userId, date, or attendanceStatus"
      });
      return;
    }

    const formattedDate = toMySQLDate(date);
    if (!formattedDate) {
      res.status(400).json({
        success: false,
        message: "Invalid date format"
      });
      return;
    }

    // ✅ Check if attendance exists
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM attendance WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        message: "Attendance record not found"
      });
      return;
    }

    const rule = await getAttendanceRule();

    let finalStatus = reqStatus?.toLowerCase();
    let workingHours = null;

    // ✅ Determine if this status requires time
    const requiresTime = ["present", "late", "half leave", "short leave", "present (remote)", "late (remote)"].includes(finalStatus);

    // ✅ CLOCK IN validation (REQUIRED for present/late/half leave)
    if (requiresTime && !clockIn) {
      res.status(400).json({
        success: false,
        message: "Clock In is required for this attendance status"
      });
      return;
    }

    // ✅ CLOCK OUT validation (OPTIONAL - only validate if BOTH are provided)
    if (requiresTime && clockIn && clockOut) {
      // Both are provided, validate the time order
      if (clockIn >= clockOut) {
        res.status(400).json({
          success: false,
          message: "Clock Out time must be after Clock In time"
        });
        return;
      }
      // Calculate working hours only when both are provided
      workingHours = calculateWorkingHours(clockIn, clockOut);
    } else if (requiresTime && clockIn && !clockOut) {
      // ✅ Only clockIn provided, clockOut is optional - this is allowed!
      // No working hours calculated
      workingHours = null;
    }

    // ✅ Auto-adjust status based on rules (only for 'present')
    if (finalStatus === "present" && rule) {
      if (rule.halfLeave && clockIn && clockIn >= rule.halfLeave) {
        finalStatus = "half leave";
      } else if (rule.lateTime && clockIn && clockIn >= rule.lateTime) {
        finalStatus = "late";
      }
    }

    // ✅ Update with remote fields - clockOut can be null
    const pendingLeave = await findPendingLeaveForDate(Number(userId), formattedDate);
    const applicableStatus = pendingLeave
      ? attendanceStatusForLeaveType(String(pendingLeave.leaveType || pendingLeave.leaveSubject || ""))
      : null;
    if (pendingLeave && String(reqStatus).toLowerCase() !== applicableStatus) {
      res.status(409).json({
        success: false,
        code: "PENDING_LEAVE_STATUS_CONFLICT",
        leaveId: pendingLeave.id,
        message: "This employee has a pending leave request for this date. You cannot mark " + reqStatus + ". Mark " + applicableStatus + " to approve it, or reject the leave request first.",
      });
      return;
    }

    const approvedLeave = await findConflictingApprovedLeave(
      Number(userId), formattedDate, reqStatus);
    if (approvedLeave) {
      res.status(409).json({
        success: false,
        code: "APPROVED_LEAVE_REQUIRES_REJECTION",
        leaveId: approvedLeave.id,
        message: "Reject the approved leave request before changing attendance status.",
      });
      return;
    }

    const connection = await pool.getConnection();
    let approvedLeaveId: number | null = null;
    try {
      await connection.beginTransaction();
    await connection.query(
      `UPDATE attendance
       SET userId = ?,
           date = ?, 
           clockIn = ?, 
           clockOut = ?,
           attendanceStatus = ?, 
           workingHours = ?,
           type = ?,
           remoteStatus = ?,
           remoteApprovedBy = ?,
           remoteApprovedAt = ?,
           remoteRejectedReason = ?,
           remoteRequestDate = ?,
           remoteFromDate = ?,
           remoteToDate = ?,
           remoteReason = ?
       WHERE id = ?`,
      [
        userId,
        formattedDate,
        fullDayLeaveStatuses.has(finalStatus) ? null : clockIn || null,
        fullDayLeaveStatuses.has(finalStatus) ? null : clockOut || null,
        finalStatus,
        fullDayLeaveStatuses.has(finalStatus) ? null : workingHours,
        type !== undefined ? type : existing[0].type,
        remoteStatus !== undefined ? remoteStatus : existing[0].remoteStatus,
        remoteApprovedBy !== undefined ? remoteApprovedBy : existing[0].remoteApprovedBy,
        remoteApprovedAt !== undefined ? remoteApprovedAt : existing[0].remoteApprovedAt,
        remoteRejectedReason !== undefined ? remoteRejectedReason : existing[0].remoteRejectedReason,
        remoteRequestDate !== undefined ? remoteRequestDate : existing[0].remoteRequestDate,
        remoteFromDate !== undefined ? remoteFromDate : existing[0].remoteFromDate,
        remoteToDate !== undefined ? remoteToDate : existing[0].remoteToDate,
        remoteReason !== undefined ? remoteReason : existing[0].remoteReason,
        id,
      ],
    );

      if (fullDayLeaveStatuses.has(finalStatus)) {
        await connection.query(
          "UPDATE attendance SET status = 'N' WHERE userId = ? AND date = ? AND id != ? AND status = 'Y'",
          [userId, formattedDate, id],
        );
      }
      if (fullDayLeaveStatuses.has(finalStatus) || pendingLeave) {
        approvedLeaveId = await approveOrCreateAttendanceLeave(
          connection, Number(userId), formattedDate, finalStatus, fullDayLeaveStatuses.has(finalStatus),
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (approvedLeaveId) {
      await nonCriticalNotification(() => decisionEvent("leave", Number(userId), approvedLeaveId!, "Approved"));
    }

    await nonCriticalNotification(() => adminAttendanceUpdated(
      Number(userId), Number(id), formattedDate, finalStatus,
      fullDayLeaveStatuses.has(finalStatus) ? null : clockIn || null,
      fullDayLeaveStatuses.has(finalStatus) ? null : clockOut || null,
    ));

    res.json({ 
      success: true,
      message: "Attendance updated successfully",
      data: {
        id,
        status: finalStatus,
        workingHours,
        clockIn: fullDayLeaveStatuses.has(finalStatus) ? null : clockIn || null,
        clockOut: fullDayLeaveStatuses.has(finalStatus) ? null : clockOut || null
      }
    });
  } catch (error) {
    console.error("❌ Error updating attendance:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to update attendance.",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
// ============================================================
// DELETE ATTENDANCE
// ============================================================
export const deleteAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  try {
    const [rows]: any = await pool.query(
      "SELECT userId, date FROM attendance WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Attendance record not found" });
      return;
    }

    const { userId, date } = rows[0];

    await pool.query<ResultSetHeader>(
      "UPDATE attendance SET status = 'N' WHERE id = ?",
      [id],
    );

    res.json({ 
      message: "Attendance deleted successfully",
      userId: userId,
      date: date
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete attendance." });
  }
};
