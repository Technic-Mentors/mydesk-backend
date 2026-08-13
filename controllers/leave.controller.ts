import { Request as ExpressRequest, Response } from "express";
import pool from "../database/db";
import { OkPacket, RowDataPacket } from "mysql2";
import { AuthenticatedRequest } from "../middleware/middleware";
import moment from "moment-timezone";

// ============================================================
// LEAVE TYPE CONSTANTS
// ============================================================
const VALID_LEAVE_TYPES = [
    'FULL DAY',
    'HALF DAY',
    'SHORT LEAVE',
    'CASUAL LEAVE',
    'SICK LEAVE',
    'ANNUAL LEAVE',
    'FAMILY RESPONSIBILITY'
];

// ============================================================
// GET ALL LEAVES (Admin)
// ============================================================
export const getUsersLeaves = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const search = (req.query.search as string) || "";

        const query = `
            SELECT 
                l.id,
                l.leaveSubject,
                l.leaveType,
                l.leaveReason,
                DATE_FORMAT(l.fromDate, '%Y-%m-%d') AS fromDate,
                DATE_FORMAT(l.toDate, '%Y-%m-%d') AS toDate,
                l.leaveStatus,
                l.userId,
                u.name
            FROM leaves l
            JOIN tbl_users u ON u.id = l.userId
            WHERE (u.name LIKE ? OR l.leaveType LIKE ? OR l.leaveSubject LIKE ?) AND l.status = 'Y'
            ORDER BY l.id DESC
        `;

        const [rows] = await pool.query<RowDataPacket[]>(query, [`%${search}%`, `%${search}%`, `%${search}%`]);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server Error" });
    }
};

// ============================================================
// GET MY LEAVES (Employee)
// ============================================================
// ============================================================
// GET MY LEAVES (Employee) - FIXED
// ============================================================
export const getMyLeaves = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) return res.status(401).json({ message: "Unauthorized" });

        const userId = req.user.id;
        const search = (req.query.search as string) || "";

        const query = `
            SELECT 
                l.id,
                l.leaveSubject,
                l.leaveType,
                l.leaveReason,
                DATE_FORMAT(l.fromDate, '%Y-%m-%d') AS fromDate,
                DATE_FORMAT(l.toDate, '%Y-%m-%d') AS toDate,
                l.leaveStatus,
                l.userId,  -- ✅ ADD THIS LINE - Include userId in response
                u.name
            FROM leaves l
            JOIN tbl_users u ON u.id = l.userId
            WHERE u.id = ? AND (l.leaveSubject LIKE ? OR l.leaveType LIKE ?) AND l.status = 'Y'
            ORDER BY l.id DESC
        `;

        const [rows] = await pool.query<RowDataPacket[]>(query, [
            userId,
            `%${search}%`,
            `%${search}%`,
        ]);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server Error" });
    }
};
// ============================================================
// GET LEAVE STATISTICS - With Date Range Filter
// ============================================================
export const getLeaveStatistics = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { fromDate, toDate, userId } = req.query;

        // ✅ Build date filter
        let dateFilter = '';
        const queryParams: any[] = [];

        if (fromDate && toDate) {
            dateFilter = ' AND l.fromDate >= ? AND l.toDate <= ?';
            queryParams.push(fromDate, toDate);
        } else if (fromDate) {
            dateFilter = ' AND l.fromDate >= ?';
            queryParams.push(fromDate);
        } else if (toDate) {
            dateFilter = ' AND l.toDate <= ?';
            queryParams.push(toDate);
        }

        // ✅ User filter (if admin wants specific user)
        let userFilter = '';
        if (userId) {
            userFilter = ' AND l.userId = ?';
            queryParams.push(userId);
        }

        // ============================================================
        // 1️⃣ GET OVERALL STATISTICS
        // ============================================================
        const [overallStats] = await pool.query<RowDataPacket[]>(
            `SELECT 
                COUNT(*) AS totalLeaves,
                SUM(CASE WHEN l.leaveStatus = 'Approved' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN l.leaveStatus = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN l.leaveStatus = 'Pending' THEN 1 ELSE 0 END) AS pending,
                COUNT(DISTINCT l.userId) AS totalEmployees
            FROM leaves l
            WHERE l.status = 'Y'
            ${dateFilter}
            ${userFilter}
            `,
            queryParams
        );

        // ============================================================
        // 2️⃣ GET LEAVE TYPE BREAKDOWN
        // ============================================================
        const [typeBreakdown] = await pool.query<RowDataPacket[]>(
            `SELECT 
                l.leaveType,
                COUNT(*) AS total,
                SUM(CASE WHEN l.leaveStatus = 'Approved' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN l.leaveStatus = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN l.leaveStatus = 'Pending' THEN 1 ELSE 0 END) AS pending
            FROM leaves l
            WHERE l.status = 'Y'
            ${dateFilter}
            ${userFilter}
            GROUP BY l.leaveType
            ORDER BY total DESC
            `,
            queryParams
        );

        // ============================================================
        // 3️⃣ GET EMPLOYEE-WISE STATISTICS (Top 10)
        // ============================================================
        const [employeeStats] = await pool.query<RowDataPacket[]>(
            `SELECT 
                u.id AS userId,
                u.name AS employeeName,
                COUNT(*) AS totalLeaves,
                SUM(CASE WHEN l.leaveStatus = 'Approved' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN l.leaveStatus = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN l.leaveStatus = 'Pending' THEN 1 ELSE 0 END) AS pending
            FROM leaves l
            JOIN tbl_users u ON u.id = l.userId
            WHERE l.status = 'Y'
            ${dateFilter}
            ${userFilter}
            GROUP BY l.userId, u.name
            ORDER BY totalLeaves DESC
            LIMIT 10
            `,
            queryParams
        );

        // ============================================================
        // 4️⃣ GET MONTHLY TREND (Last 12 months)
        // ============================================================
        const [monthlyTrend] = await pool.query<RowDataPacket[]>(
            `SELECT 
                DATE_FORMAT(l.fromDate, '%Y-%m') AS month,
                COUNT(*) AS total,
                SUM(CASE WHEN l.leaveStatus = 'Approved' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN l.leaveStatus = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN l.leaveStatus = 'Pending' THEN 1 ELSE 0 END) AS pending
            FROM leaves l
            WHERE l.status = 'Y'
                AND l.fromDate >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                ${userId ? 'AND l.userId = ?' : ''}
            GROUP BY DATE_FORMAT(l.fromDate, '%Y-%m')
            ORDER BY month ASC
            `,
            userId ? [userId] : []
        );

        // ============================================================
        // 5️⃣ GET LEAVE STATUS BREAKDOWN (for pie chart)
        // ============================================================
        const [statusBreakdown] = await pool.query<RowDataPacket[]>(
            `SELECT 
                l.leaveStatus,
                COUNT(*) AS count
            FROM leaves l
            WHERE l.status = 'Y'
            ${dateFilter}
            ${userFilter}
            GROUP BY l.leaveStatus
            `,
            queryParams
        );

        // ============================================================
        // 6️⃣ GET ACTIVE LEAVES (Currently on leave)
        // ============================================================
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const [activeLeaves] = await pool.query<RowDataPacket[]>(
            `SELECT 
                u.id AS userId,
                u.name AS employeeName,
                l.id AS leaveId,
                l.leaveType,
                l.fromDate,
                l.toDate,
                l.leaveReason
            FROM leaves l
            JOIN tbl_users u ON u.id = l.userId
            WHERE l.status = 'Y'
                AND l.leaveStatus = 'Approved'
                AND ? BETWEEN l.fromDate AND l.toDate
                ${userId ? 'AND l.userId = ?' : ''}
            `,
            userId ? [today, userId] : [today]
        );

        // ============================================================
        // 7️⃣ CALCULATE DATES
        // ============================================================
        const startDate = fromDate || 'All';
        const endDate = toDate || 'All';

        res.status(200).json({
            success: true,
            filters: {
                fromDate: startDate,
                toDate: endDate,
                userId: userId || 'All'
            },
            overview: (overallStats as any[])[0] || {
                totalLeaves: 0,
                approved: 0,
                rejected: 0,
                pending: 0,
                totalEmployees: 0
            },
            byLeaveType: typeBreakdown || [],
            byEmployee: employeeStats || [],
            monthlyTrend: monthlyTrend || [],
            statusBreakdown: statusBreakdown || [],
            activeLeaves: activeLeaves || []
        });

    } catch (error) {
        console.error("Error fetching leave statistics:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch leave statistics"
        });
    }
};
// ============================================================
// GET ALL USERS
// ============================================================
export const getAllUsers = async (
    req: AuthenticatedRequest,
    res: Response,
): Promise<void> => {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            "SELECT id, name, role FROM tbl_users WHERE status = 'Y'",
        );
        res.json({ users: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// ============================================================
// ADD LEAVE
// ============================================================
export const addLeave = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { 
            leaveSubject, 
            leaveType,
            fromDate, 
            toDate, 
            leaveReason, 
            employee_id 
        } = req.body;

        // ✅ Validate required fields
        if (!leaveType || !fromDate || !toDate || !leaveReason) {
            return res.status(400).json({ 
                message: "Missing required fields: leaveType, fromDate, toDate, leaveReason" 
            });
        }

        // ============================================================
        // ✅ VALIDATE LEAVE TYPE
        // ============================================================
        const leaveTypeValue = leaveType.toUpperCase();
        
        if (!VALID_LEAVE_TYPES.includes(leaveTypeValue)) {
            return res.status(400).json({ 
                message: `Invalid leave type. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}` 
            });
        }

        // ============================================================
        // ✅ DATE VALIDATION
        // ============================================================
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);
        const todayDate = new Date(today);
        todayDate.setHours(0, 0, 0, 0);

        if (startDate < todayDate) {
            return res.status(400).json({ 
                message: "Cannot apply leave for past dates" 
            });
        }

        if (endDate < startDate) {
            return res.status(400).json({ 
                message: "End date must be after start date" 
            });
        }

        // ============================================================
        // ✅ SHORT LEAVE: Must be single day
        // ============================================================
        if (leaveTypeValue === 'SHORT LEAVE' && fromDate !== toDate) {
            return res.status(400).json({ 
                message: "Short Leave must be for a single day only" 
            });
        }

        // ============================================================
        // ✅ HALF DAY: Must be single day
        // ============================================================
        if (leaveTypeValue === 'HALF DAY' && fromDate !== toDate) {
            return res.status(400).json({ 
                message: "Half Day must be for a single day only" 
            });
        }

        // ============================================================
        // ✅ CHECK USER
        // ============================================================
        let userId: number;
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

        // Check if user exists
        const [userRows] = await pool.query<RowDataPacket[]>(
            "SELECT id, name FROM tbl_users WHERE id = ?",
            [userId]
        );

        if (userRows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const employeeName = userRows[0].name || "Employee";

        // ============================================================
        // ✅ CHECK FOR EXISTING LEAVE
        // ============================================================
        const [existing] = await pool.query(
            `SELECT id FROM leaves 
             WHERE userId = ? 
             AND leaveStatus != 'Rejected' 
             AND status = 'Y'
             AND ((fromDate <= ? AND toDate >= ?) OR (fromDate <= ? AND toDate >= ?))`,
            [userId, toDate, fromDate, fromDate, toDate]
        );

        if ((existing as any).length > 0) {
            return res.status(400).json({ 
                message: "You already have a leave request for these dates" 
            });
        }

        // ============================================================
        // ✅ ATTENDANCE CHECK - Only for specific leave types
        // ============================================================
        const leaveTypesThatAllowAttendance = ['SHORT LEAVE', 'HALF DAY'];
        
        if (!leaveTypesThatAllowAttendance.includes(leaveTypeValue)) {
            const [attendanceCheck] = await pool.query<RowDataPacket[]>(
                `SELECT id, clockIn, clockOut, attendanceStatus FROM attendance
                 WHERE userId = ?
                 AND date BETWEEN ? AND ?
                 AND status = 'Y'
                 AND clockIn IS NOT NULL`,
                [userId, fromDate, toDate]
            );

            if (attendanceCheck.length > 0) {
                const dates = attendanceCheck.map((row: any) => row.date);
                return res.status(400).json({
                    message: `Attendance already marked on: ${dates.join(', ')}. Cannot apply ${leaveTypeValue} leave.`,
                    conflict: {
                        type: "ATTENDANCE_EXISTS",
                        dates: dates,
                        suggestion: "Please remove attendance first or apply for Short Leave/Half Day instead."
                    }
                });
            }
        } else {
            const [attendanceCheck] = await pool.query<RowDataPacket[]>(
                `SELECT id, clockIn, clockOut, attendanceStatus FROM attendance
                 WHERE userId = ?
                 AND date BETWEEN ? AND ?
                 AND status = 'Y'
                 AND clockIn IS NOT NULL`,
                [userId, fromDate, toDate]
            );

            if (attendanceCheck.length > 0) {
                console.log(`✅ ${leaveTypeValue} leave applied with existing attendance for user ${userId}`);
                console.log(`📊 Attendance records:`, attendanceCheck);
            }
        }

        // ============================================================
        // ✅ DETERMINE LEAVE STATUS
        // ============================================================
        const leaveStatus = isAdmin ? "Approved" : "Pending";

        // ============================================================
        // ✅ INSERT LEAVE - FIXED
        // ============================================================
        const [result] = await pool.query(
            `INSERT INTO leaves 
             (userId, fromDate, toDate, leaveSubject, leaveType, leaveReason, leaveStatus)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, 
                fromDate, 
                toDate, 
                leaveSubject || leaveTypeValue, 
                leaveTypeValue, 
                leaveReason, 
                leaveStatus
            ]
        );

        const leaveId = (result as any).insertId;

        // ============================================================
        // ✅ SEND NOTIFICATIONS
        // ============================================================
        try {
            if (!isAdmin) {
                const [adminUsers] = await pool.query<RowDataPacket[]>(
                    "SELECT id FROM tbl_users WHERE role = 'admin' AND status = 'Y'"
                );

                for (const admin of adminUsers) {
                    if (admin.id !== userId) {
                        await pool.query(
                            `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
                             VALUES (?, ?, 'leave', ?, false, NOW(), NOW())`,
                            [
                                admin.id,
                                leaveId,
                                `${employeeName} applied for ${leaveTypeValue} leave: ${fromDate} to ${toDate}`
                            ]
                        );
                    }
                }
            } else {
                if (userId !== req.user.id) {
                    await pool.query(
                        `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
                         VALUES (?, ?, 'leave', ?, false, NOW(), NOW())`,
                        [
                            userId,
                            leaveId,
                            `Your ${leaveTypeValue} leave request has been Approved by admin`
                        ]
                    );
                }
            }
        } catch (notifError) {
            console.error("Notification error (non-critical):", notifError);
        }

        return res.status(201).json({
            success: true,
            message: isAdmin 
                ? "Leave added and approved successfully" 
                : "Leave added successfully",
            status: leaveStatus,
            leaveId: leaveId,
            leaveType: leaveTypeValue
        });

    } catch (error) {
        console.error("Error adding leave:", error);
        if (!res.headersSent) {
            return res.status(500).json({ message: "Server error" });
        }
    }
};

// ============================================================
// UPDATE LEAVE
// ============================================================
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
// ============================================================
// UPDATE MY LEAVE (Employee) - New Route
// ============================================================
export const updateMyLeave = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { 
            leaveSubject, 
            leaveReason, 
            fromDate, 
            toDate 
        } = req.body;

        // ✅ Check if user is authenticated
        if (!req.user) {
            return res.status(401).json({ 
                success: false,
                message: "Unauthorized - Please login" 
            });
        }

        const userId = req.user.id;

        // ✅ Get the leave first to check ownership and status
        const [leaveRows]: any[] = await pool.execute(
            'SELECT * FROM leaves WHERE id = ? AND status = "Y"',
            [id]
        );

        if (leaveRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Leave not found or already deleted'
            });
        }

        const leave = leaveRows[0];

        // ✅ Check ownership
        if (leave.userId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only edit your own leaves.'
            });
        }

        // ✅ Check if leave is Pending
        if (leave.leaveStatus !== "Pending") {
            return res.status(403).json({
                success: false,
                message: `Access denied. Cannot edit leave with status "${leave.leaveStatus}". Only Pending leaves can be modified.`
            });
        }

        // ✅ Build update query (only allowed fields)
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
            // Validate date - cannot be past
            const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
            const startDate = new Date(fromDate);
            const todayDate = new Date(today);
            todayDate.setHours(0, 0, 0, 0);
            
            if (startDate < todayDate) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot change leave to past dates"
                });
            }
            updateFields.push('fromDate = ?');
            values.push(fromDate);
        }

        if (toDate !== undefined) {
            // Validate date - cannot be past
            const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
            const endDate = new Date(toDate);
            const todayDate = new Date(today);
            todayDate.setHours(0, 0, 0, 0);
            
            if (endDate < todayDate) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot change leave to past dates"
                });
            }
            updateFields.push('toDate = ?');
            values.push(toDate);
        }

        // ✅ Validate date range
        if (fromDate !== undefined && toDate !== undefined) {
            const start = new Date(fromDate);
            const end = new Date(toDate);
            if (end < start) {
                return res.status(400).json({
                    success: false,
                    message: 'End date must be after start date'
                });
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        // ✅ Check for overlapping leaves
        const checkFromDate = fromDate || leave.fromDate;
        const checkToDate = toDate || leave.toDate;
        
        const [overlapping] = await pool.query(
            `SELECT id FROM leaves 
             WHERE userId = ? 
             AND id != ?
             AND leaveStatus != 'Rejected' 
             AND status = 'Y'
             AND ((fromDate <= ? AND toDate >= ?) OR (fromDate <= ? AND toDate >= ?))`,
            [userId, id, checkToDate, checkFromDate, checkFromDate, checkToDate]
        );

        if ((overlapping as any).length > 0) {
            return res.status(400).json({
                success: false,
                message: 'You already have a leave request for these dates'
            });
        }

        // ✅ Execute update
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

        // ✅ Get updated leave
        const [updatedRows] = await pool.execute(
            'SELECT * FROM leaves WHERE id = ?',
            [id]
        );

        const updatedLeave = (updatedRows as any[])[0];

        console.log(`✅ Leave ${id} updated by employee ${req.user.name}`);

        res.status(200).json({
            success: true,
            message: 'Leave updated successfully',
            data: updatedLeave
        });

    } catch (error) {
        console.error('Error updating leave:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update leave'
        });
    }
};
// ============================================================
// UPDATE LEAVE STATUS (Approve/Reject) - FIXED
// ============================================================
export const updateLeaveStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { leaveStatus, rejectedReason } = req.body;

        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!leaveStatus) {
            return res.status(400).json({
                success: false,
                message: 'leaveStatus is required'
            });
        }

        const validStatuses = ['Pending', 'Approved', 'Rejected'];
        if (!validStatuses.includes(leaveStatus)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid leave status. Must be Pending, Approved, or Rejected'
            });
        }

        const [existingRows]: any[] = await pool.execute(
            'SELECT * FROM leaves WHERE id = ? AND status = "Y"',
            [id]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Leave not found'
            });
        }

        // ✅ FIXED: Only update leaveStatus
        const [result]: any[] = await pool.execute(
            `UPDATE leaves SET leaveStatus = ? WHERE id = ?`,
            [leaveStatus, id]
        );

        if (result.affectedRows === 0) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update leave status'
            });
        }

        const [updatedRows]: any[] = await pool.execute(
            'SELECT * FROM leaves WHERE id = ?',
            [id]
        );

        try {
            const leave = updatedRows[0];
            const empId = leave.userId;
            const adminId = req.user.id;

            if (empId !== adminId) {
                const statusMessage = leaveStatus === 'Approved' 
                    ? 'Approved' 
                    : `Rejected${rejectedReason ? `: ${rejectedReason}` : ''}`;
                
                await pool.query(
                    `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
                     VALUES (?, ?, 'leave', ?, false, NOW(), NOW())`,
                    [
                        empId,
                        id,
                        `Your ${leave.leaveType || leave.leaveSubject} leave request has been ${statusMessage}`
                    ]
                );
            }
        } catch (notifError) {
            console.error("Notification error (non-critical):", notifError);
        }

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

// ============================================================
// DELETE LEAVE (Soft Delete)
// ============================================================
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
            "SELECT userId, leaveStatus FROM leaves WHERE id = ? AND status = 'Y'",
            [leaveId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: "Leave not found" });
        }

        const leave = rows[0];

        if (isAdmin) {
            await pool.query("UPDATE leaves SET status = 'N' WHERE id = ?", [leaveId]);
            return res.status(200).json({
                message: "Leave deleted successfully (Admin)"
            });
        }

        if (leave.userId !== req.user.id) {
            return res.status(403).json({ message: "Forbidden" });
        }

        if (leave.leaveStatus !== "Pending") {
            return res.status(403).json({
                message: "Cannot delete a leave that is already Approved or Rejected"
            });
        }

        await pool.query("UPDATE leaves SET status = 'N' WHERE id = ?", [leaveId]);

        return res.status(200).json({
            message: "Leave deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting leave:", error);
        res.status(500).json({ message: "Server error" });
    }
};