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
      l.userId,
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
    let employeeName: string = "Employee";

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

    const [userRows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, date FROM tbl_users WHERE id = ?",
      [userId],
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    employeeName = userRows[0].name || "Employee";

    const joiningDate = new Date(userRows[0].date);
    const leaveFromDate = new Date(fromDate);
    const leaveToDate = new Date(toDate);

    if (leaveFromDate < joiningDate || leaveToDate < joiningDate) {
      return res.status(400).json({
        message: "Leave cannot be applied before employee joining date",
      });
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

    const leaveStatus = isAdmin ? "Approved" : "Pending";

    const [result] = await pool.query(
      `INSERT INTO leaves (userId, leaveSubject, fromDate, toDate, leaveReason, leaveStatus)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, leaveSubject, fromDate, toDate, leaveReason, leaveStatus],
    );

    const leaveId = (result as any).insertId;

    try {
      if (!isAdmin) {
        // Employee applied → notify all admins (except if they are also the applicant)
        const [adminUsers] = await pool.query<RowDataPacket[]>(
          "SELECT id FROM tbl_users WHERE role = 'admin'"
        );

        for (const admin of adminUsers) {
          if (admin.id !== userId) {
            await pool.query(
              `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
               VALUES (?, ?, 'leave', ?, false, NOW(), NOW())`,
              [
                admin.id,
                leaveId,
                `${employeeName} applied for leave: ${leaveSubject}`
              ]
            );
          }
        }
      } else {
        // Admin added leave for someone else → notify that employee only
        if (userId !== req.user.id) {
          await pool.query(
            `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
             VALUES (?, ?, 'leave', ?, false, NOW(), NOW())`,
            [
              userId,
              leaveId,
              `Your leave request (${leaveSubject}) has been Approved by admin`
            ]
          );
        }
      }
    } catch (notifError) {
      console.error("Notification error (non-critical):", notifError);
    }

    return res.status(201).json({ 
      message: isAdmin 
        ? "Leave added and approved successfully" 
        : "Leave added successfully",
      status: leaveStatus,
      leaveId: leaveId
    });
  } catch (error) {
    console.error("Error adding leave:", error);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Server error" });
    }
  }
};

// In leave.controller.ts

export const updateLeave = async (req: ExpressRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      leaveSubject, 
      leaveReason, 
      fromDate, 
      toDate, 
      leaveStatus 
    } = req.body;

    // Build the update query dynamically based on what fields are provided
    const updateFields: string[] = [];
    const values: any[] = [];

    if (leaveSubject !== undefined) {
      updateFields.push('leaveSubject = ?');
      values.push(leaveSubject);
    }

    if (leaveReason !== undefined) {
      updateFields.push('leaveReason = ?');
      values.push(leaveReason);
    }

    if (fromDate !== undefined) {
      updateFields.push('fromDate = ?');
      values.push(fromDate);
    }

    if (toDate !== undefined) {
      updateFields.push('toDate = ?');
      values.push(toDate);
    }

    if (leaveStatus !== undefined) {
      updateFields.push('leaveStatus = ?');
      values.push(leaveStatus);
    }

    // If no fields to update, return error
    if (updateFields.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No fields to update' 
      });
    }

    values.push(id);

    const query = `
      UPDATE leaves 
      SET ${updateFields.join(', ')} 
      WHERE id = ?
    `;

    const [result] = await pool.execute(query, values);

    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Leave not found' 
      });
    }

    // Fetch the updated leave
    const [updatedRows] = await pool.execute(
      'SELECT * FROM leaves WHERE id = ?',
      [id]
    );

    const updatedLeave = (updatedRows as any[])[0];

    res.status(200).json({
      success: true,
      message: 'Leave updated successfully',
      data: updatedLeave,
    });

  } catch (error) {
    console.error('Error updating leave:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update leave' 
    });
  }
};

export const updateLeaveStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { leaveStatus } = req.body;

    // 1. Validate input
    if (!leaveStatus) {
      return res.status(400).json({ 
        success: false, 
        message: 'leaveStatus is required' 
      });
    }

    // 2. Validate status value
    const validStatuses = ['Pending', 'Approved', 'Rejected'];
    if (!validStatuses.includes(leaveStatus)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid leave status. Must be Pending, Approved, or Rejected' 
      });
    }

    // 3. Check if leave exists FIRST
    const [existingRows]: any[] = await pool.execute(
      'SELECT * FROM leaves WHERE id = ?',
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Leave not found' 
      });
    }

    // 4. Update ONLY the status field
    const [result]: any[] = await pool.execute(
      'UPDATE leaves SET leaveStatus = ? WHERE id = ?',
      [leaveStatus, id]
    );

    // 5. Check if update was successful
    if (result.affectedRows === 0) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update leave status' 
      });
    }

    // 6. Fetch the updated leave
    const [updatedRows]: any[] = await pool.execute(
      'SELECT * FROM leaves WHERE id = ?',
      [id]
    );

    // 7. Return success with data
    return res.status(200).json({
      success: true,
      message: `Leave ${leaveStatus.toLowerCase()} successfully`,
      data: updatedRows[0]
    });

  } catch (error) {
    console.error('Error updating leave status:', error);
    return res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'Failed to update leave status' 
    });
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