import { Request as ExpressRequest, Response } from "express";
import pool from "../database/db";
import { OkPacket, RowDataPacket } from "mysql2";
import { AuthenticatedRequest } from "../middleware/middleware";

export const getUsersLeaves = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const search = (req.query.search as string) || "";

    const query = `
  SELECT 
    l.id,
    l.leaveSubject,
    l.leaveReason,
    DATE_FORMAT(l.fromDate, '%Y-%m-%d') AS fromDate,
    DATE_FORMAT(l.toDate, '%Y-%m-%d') AS toDate,
    l.leaveStatus,
    u.name
  FROM leaves l
  JOIN tbl_users u ON u.id = l.userId
  WHERE u.name LIKE ? AND l.status = 'Y'
  ORDER BY l.id ASC
`;

    const [rows] = await pool.query<RowDataPacket[]>(query, [`%${search}%`]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const getMyLeaves = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    const userId = req.user.id;
    const search = (req.query.search as string) || "";

    const query = `
  SELECT 
    l.id,
    l.leaveSubject,
    l.leaveReason,
    DATE_FORMAT(l.fromDate, '%Y-%m-%d') AS fromDate,
    DATE_FORMAT(l.toDate, '%Y-%m-%d') AS toDate,
    l.leaveStatus,
    u.name
  FROM leaves l
  JOIN tbl_users u ON u.id = l.userId
  WHERE u.id = ? AND l.leaveSubject LIKE ? AND l.status = 'Y'
  ORDER BY l.id ASC
`;

    const [rows] = await pool.query<RowDataPacket[]>(query, [
      userId,
      `%${search}%`,
    ]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const getAllUsers = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, role FROM tbl_users",
    );
    res.json({ users: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

export const addLeave = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { leaveSubject, fromDate, toDate, leaveReason, employee_id } =
      req.body;

    if (!leaveSubject || !fromDate || !toDate || !leaveReason) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    let userId: number;

    // ✅ Check if user is admin
    const isAdmin = req.user.role?.toLowerCase() === "admin";

    if (isAdmin) {
      if (!employee_id) {
        return res.status(400).json({ message: "Employee ID is required" });
      }

      userId = Number(employee_id);

      if (isNaN(userId) || userId <= 0) {
        return res.status(400).json({ message: "Invalid employee ID" });
      }
    } else {
      userId = req.user.id;
    }

    const [existing] = await pool.query(
      `SELECT id FROM leaves WHERE userId = ? AND leaveStatus != 'Rejected' 
   AND ((fromDate <= ? AND toDate >= ?) OR (fromDate <= ? AND toDate >= ?))`,
      [userId, toDate, fromDate, fromDate, toDate],
    );

    if ((existing as any).length > 0) {
      return res
        .status(400)
        .json({ message: "Leave already applied for this user today" });
    }

    const [attendanceCheck] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM attendance
   WHERE userId = ?
   AND date BETWEEN ? AND ?
   AND status = 'Y'`,
      [userId, fromDate, toDate],
    );

    if (attendanceCheck.length > 0) {
      return res.status(400).json({
        message:
          "Attendance already marked for one or more selected dates. Cannot apply leave.",
      });
    }

    const [userRows] = await pool.query<RowDataPacket[]>(
      "SELECT date FROM tbl_users WHERE id = ?",
      [userId],
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const joiningDate = new Date(userRows[0].date);
    const leaveFromDate = new Date(fromDate);
    const leaveToDate = new Date(toDate);

    if (leaveFromDate < joiningDate || leaveToDate < joiningDate) {
      return res.status(400).json({
        message: "Leave cannot be applied before employee joining date",
      });
    }

    await pool.query(
      `INSERT INTO leaves (userId, leaveSubject, fromDate, toDate, leaveReason, leaveStatus)
   VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, leaveSubject, fromDate, toDate, leaveReason, "Pending"],
    );

    return res.status(201).json({ message: "Leave added successfully" });
  } catch (error) {
    console.error("Error adding leave:", error);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Server error" });
    }
  }
};

export const updateLeave = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const leaveId = Number(req.params.id);
    const { leaveStatus, fromDate, toDate, leaveSubject, leaveReason } =
      req.body;

    // ✅ Check if user is authenticated
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    // ✅ Check if user is admin
    const isAdmin = req.user.role?.toLowerCase() === "admin";
    
    console.log(`🔍 User: ${req.user.id}, Role: ${req.user.role}, isAdmin: ${isAdmin}`);

    // ✅ Get current leave details first
    const [currentLeave] = await pool.query<RowDataPacket[]>(
      `SELECT userId, fromDate as currentFromDate, toDate as currentToDate, leaveStatus as currentStatus 
       FROM leaves WHERE id = ? AND status = 'Y'`,
      [leaveId]
    );

    if (currentLeave.length === 0) {
      res.status(404).json({ message: "Leave not found" });
      return;
    }

    const userId = currentLeave[0].userId;
    const currentStatus = currentLeave[0].currentStatus;
    const newFromDate = fromDate || currentLeave[0].currentFromDate;
    const newToDate = toDate || currentLeave[0].currentToDate;
    const newStatus = leaveStatus || currentLeave[0].currentStatus;

    // ✅ ADMIN: Complete bypass - NO restrictions at all
    if (isAdmin) {
      console.log(`✅ ADMIN OVERRIDE: Updating leave ${leaveId} - ${currentStatus} → ${newStatus}`);
      
      // Admin can update ANY leave with ANY status, ANY dates, ANY conflicts
      await pool.query(
        `UPDATE leaves
         SET fromDate = ?, toDate = ?, leaveStatus = ?, leaveSubject = ?, leaveReason = ?
         WHERE id = ?`,
        [newFromDate, newToDate, newStatus, leaveSubject, leaveReason, leaveId],
      );

      res.status(200).json({
        message: `Leave updated successfully (Admin override - ${currentStatus} → ${newStatus})`,
      });
      return;
    }

    // ✅ NON-ADMIN: All restrictions apply below
    console.log(`🔒 Non-admin user: Applying restrictions`);

    // Check if user owns the leave
    if (req.user.id !== userId) {
      res.status(403).json({ message: "Forbidden: You don't own this leave" });
      return;
    }

    // ❌ Non-admin: Cannot change dates of Approved/Rejected leave
    if ((fromDate || toDate) && currentStatus !== "Pending") {
      res.status(403).json({ 
        message: `Cannot change dates of a ${currentStatus} leave request. Only Pending leaves can be modified.`,
        status: currentStatus
      });
      return;
    }

    // ❌ Non-admin: Cannot change status of Approved/Rejected leave
    if (leaveStatus && currentStatus !== "Pending") {
      res.status(403).json({ 
        message: `Cannot change status of a ${currentStatus} leave request. Status is locked.`,
        status: currentStatus
      });
      return;
    }

    // ❌ Non-admin: Check date logic - To Date must be after From Date
    if (newFromDate && newToDate) {
      const start = new Date(newFromDate);
      const end = new Date(newToDate);
      if (end < start) {
        res.status(400).json({ 
          message: "End date must be after start date" 
        });
        return;
      }
    }

    // ❌ Non-admin: Check joining date conflict
    const [userRows] = await pool.query<RowDataPacket[]>(
      "SELECT date FROM tbl_users WHERE id = ?",
      [userId]
    );

    if (userRows.length > 0) {
      const joiningDate = new Date(userRows[0].date);
      const leaveFromDate = new Date(newFromDate);
      const leaveToDate = new Date(newToDate);

      if (leaveFromDate < joiningDate || leaveToDate < joiningDate) {
        res.status(400).json({
          message: "Leave cannot be applied before employee joining date",
        });
        return;
      }
    }

    // ❌ Non-admin: Check for overlapping leaves
    const [overlapping] = await pool.query(
      `SELECT id FROM leaves 
       WHERE userId = ? 
       AND id != ? 
       AND leaveStatus != 'Rejected'
       AND status = 'Y'
       AND ((fromDate <= ? AND toDate >= ?) OR (fromDate <= ? AND toDate >= ?))`,
      [userId, leaveId, newToDate, newFromDate, newFromDate, newToDate]
    );

    if ((overlapping as any).length > 0) {
      res.status(400).json({
        message: "Leave period overlaps with an existing leave request",
      });
      return;
    }

    // ❌ Non-admin: Check attendance conflict when approving
    if (newStatus === "Approved") {
      const [attendanceCheck] = await pool.query<RowDataPacket[]>(
        `SELECT id, date, clockIn, clockOut, attendanceStatus 
         FROM attendance 
         WHERE userId = ? 
         AND date BETWEEN ? AND ?
         AND (
           clockIn IS NOT NULL 
           OR clockOut IS NOT NULL 
           OR attendanceStatus IN ('Present', 'Late', 'Short Leave')
         )
         LIMIT 1`,
        [userId, newFromDate, newToDate]
      );

      if (attendanceCheck.length > 0) {
        const attendanceDate = new Date(attendanceCheck[0].date).toLocaleDateString();
        const clockInTime = attendanceCheck[0].clockIn || 'N/A';
        const attendanceStatus = attendanceCheck[0].attendanceStatus;
        
        res.status(409).json({ 
          message: `Cannot approve leave. Employee has already marked attendance on ${attendanceDate} (Status: ${attendanceStatus}, Clock In: ${clockInTime}).`,
          conflictDate: attendanceCheck[0].date,
          attendanceDetails: {
            date: attendanceCheck[0].date,
            clockIn: attendanceCheck[0].clockIn,
            attendanceStatus: attendanceCheck[0].attendanceStatus
          }
        });
        return;
      }
    }

    // ✅ Non-admin: All validations passed - Update the leave
    await pool.query(
      `UPDATE leaves
       SET fromDate = ?, toDate = ?, leaveStatus = ?, leaveSubject = ?, leaveReason = ?
       WHERE id = ?`,
      [newFromDate, newToDate, newStatus, leaveSubject, leaveReason, leaveId],
    );

    res.status(200).json({
      message: "Leave updated successfully",
    });
  } catch (error) {
    console.error("Error updating leave:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteLeave = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const leaveId = Number(req.params.id);
    if (!leaveId || leaveId <= 0) {
      return res.status(400).json({ message: "Invalid leave ID" });
    }

    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const isAdmin = req.user.role?.toLowerCase() === "admin";

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT userId, leaveStatus FROM leaves WHERE id = ?",
      [leaveId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Leave not found" });
    }

    const leave = rows[0];

    // ✅ ADMIN: Can delete ANY leave
    if (isAdmin) {
      await pool.query("UPDATE leaves SET status = 'N' WHERE id = ?", [leaveId]);
      return res.status(200).json({ 
        message: "Leave deleted successfully (Admin)" 
      });
    }

    // Non-admin: Check ownership
    if (leave.userId !== req.user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Non-admin: Only allow deletion of Pending leaves
    if (leave.leaveStatus !== "Pending") {
      return res.status(403).json({ 
        message: "Cannot delete a leave that is already Approved or Rejected" 
      });
    }

    // SOFT DELETE: Update status to 'N' instead of deleting
    await pool.query("UPDATE leaves SET status = 'N' WHERE id = ?", [leaveId]);

    return res.status(200).json({ 
      message: "Leave deleted successfully" 
    });
  } catch (error) {
    console.error("Error deleting leave:", error);
    res.status(500).json({ message: "Server error" });
  }
};