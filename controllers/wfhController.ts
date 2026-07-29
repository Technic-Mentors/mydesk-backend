import { Request, Response } from "express";
import pool from "../database/db";
import moment from "moment-timezone";

// ============================================================
// EMPLOYEE CONTROLLERS
// ============================================================

// ✅ Employee: Request Remote Work
export const requestWFH = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { fromDate, toDate, reason } = req.body;

        if (!fromDate || !toDate) {
            res.status(400).json({ 
                message: "From Date and To Date are required" 
            });
            return;
        }

        // Check if reason is required by rules
        const [rules]: any = await pool.query(
            "SELECT requireWFHReason FROM attendance_rules WHERE status = 'Active' LIMIT 1"
        );

        if (rules.length > 0 && rules[0].requireWFHReason && !reason) {
            res.status(400).json({ 
                message: "Reason is required for Remote work request" 
            });
            return;
        }

        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const from = moment.tz(fromDate, "Asia/Karachi");
        const to = moment.tz(toDate, "Asia/Karachi");

        if (from.isBefore(today)) {
            res.status(400).json({ 
                message: "Cannot request Remote work for past dates" 
            });
            return;
        }

        if (from.isAfter(to)) {
            res.status(400).json({ 
                message: "From Date must be before or equal to To Date" 
            });
            return;
        }

        // Check if user already marked attendance for any date in range
        const [attendanceRows]: any = await pool.query(
            `SELECT date FROM attendance 
             WHERE userId = ? AND date BETWEEN ? AND ? AND status = 'Y' AND clockIn IS NOT NULL`,
            [userId, fromDate, toDate]
        );

        if (attendanceRows.length > 0) {
            const dates = attendanceRows.map((row: any) => row.date);
            res.status(400).json({
                message: `You have already marked attendance on: ${dates.join(', ')}. Cannot request Remote work.`
            });
            return;
        }

        // Check if user already has pending/approved remote request
        const [existingRemote]: any = await pool.query(
            `SELECT * FROM attendance 
             WHERE userId = ? AND remoteStatus IN ('Pending', 'Approved') AND status = 'Y'
             AND (
                 (remoteFromDate BETWEEN ? AND ?) OR 
                 (remoteToDate BETWEEN ? AND ?) OR 
                 (? BETWEEN remoteFromDate AND remoteToDate)
             )`,
            [userId, fromDate, toDate, fromDate, toDate, fromDate]
        );

        if (existingRemote.length > 0) {
            const existing = existingRemote[0];
            res.status(400).json({
                message: `You already have a ${existing.remoteStatus} Remote work request for these dates`
            });
            return;
        }

        // Check if user is on leave
        const [leaveRows]: any = await pool.query(
            `SELECT id FROM leaves 
             WHERE userId = ? AND leaveStatus = 'Approved' 
             AND (? BETWEEN fromDate AND toDate OR ? BETWEEN fromDate AND toDate)`,
            [userId, fromDate, toDate]
        );

        if (leaveRows.length > 0) {
            res.status(400).json({
                message: "You have an approved leave during these dates. Cannot request Remote work."
            });
            return;
        }

        // Check if dates contain holidays
        const [holidayRows]: any = await pool.query(
            `SELECT holiday FROM holidays 
             WHERE ? BETWEEN fromDate AND toDate 
             OR ? BETWEEN fromDate AND toDate 
             AND holidayStatus = 'Y'`,
            [fromDate, toDate]
        );

        if (holidayRows.length > 0) {
            res.status(400).json({
                message: `Cannot request Remote work during holidays: ${holidayRows.map((h: any) => h.holiday).join(', ')}`
            });
            return;
        }

        // ✅ Insert Remote request into attendance table
        const [result] = await pool.query(
            `INSERT INTO attendance 
             (userId, date, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, remoteReason, status, type) 
             VALUES (?, ?, 'Pending', ?, ?, ?, ?, 'Y', 'Remote')`,
            [userId, today, today, fromDate, toDate, reason || null]
        );

        res.status(201).json({
            success: true,
            message: "Remote work request submitted successfully! Waiting for admin approval.",
            requestId: (result as any).insertId,
            status: "Pending",
            data: {
                userId,
                fromDate,
                toDate,
                reason: reason || null
            }
        });

    } catch (error) {
        console.error("Remote Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Employee: Get my Remote requests
export const getMyWFHRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { status } = req.query;

        let query = `
            SELECT id, userId, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, 
                 remoteReason, remoteApprovedAt, remoteRejectedReason, created_at, type
            FROM attendance 
            WHERE userId = ? AND remoteStatus IS NOT NULL AND status = 'Y'
        `;
        const params: any[] = [userId];

        if (status && ['Pending', 'Approved', 'Rejected'].includes(status as string)) {
            query += ` AND remoteStatus = ?`;
            params.push(status);
        }

        query += ` ORDER BY remoteRequestDate DESC`;

        const [rows] = await pool.query(query, params);

        res.status(200).json({
            success: true,
            count: (rows as any[]).length,
            data: rows
        });

    } catch (error) {
        console.error("Get My Remote Requests Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Employee: Check Remote status for today
export const checkWFHStatusForToday = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

        const [rows]: any = await pool.query(
            `SELECT * FROM attendance 
             WHERE userId = ? 
             AND remoteStatus = 'Approved'
             AND remoteFromDate <= ? AND remoteToDate >= ?
             AND status = 'Y'
             LIMIT 1`,
            [userId, today, today]
        );

        if (rows.length > 0) {
            res.status(200).json({
                success: true,
                isWFH: true,
                message: "You are approved for Remote work today",
                data: rows[0]
            });
        } else {
            res.status(200).json({
                success: true,
                isWFH: false,
                message: "No Remote work approval for today"
            });
        }

    } catch (error) {
        console.error("Check Remote Status Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Employee: Cancel Remote request (only if Pending)
export const cancelWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { requestId } = req.params;

        const [request]: any = await pool.query(
            "SELECT * FROM attendance WHERE id = ? AND userId = ? AND remoteStatus = 'Pending' AND status = 'Y'",
            [requestId, userId]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "Remote request not found or cannot be cancelled" 
            });
            return;
        }

        // Soft delete
        await pool.query(
            "UPDATE attendance SET status = 'N' WHERE id = ? AND userId = ?",
            [requestId, userId]
        );

        res.status(200).json({
            success: true,
            message: "Remote request cancelled successfully"
        });

    } catch (error) {
        console.error("Cancel Remote Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ============================================================
// ADMIN CONTROLLERS
// ============================================================

// ✅ Admin: Get all Remote requests
// ✅ Admin: Get all Remote requests
export const getAllWFHRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const { status } = req.query;

        let query = `
            SELECT 
                a.id,
                a.userId,
                a.remoteStatus as wfhStatus,
                a.remoteRequestDate as wfhRequestDate,
                a.remoteFromDate as wfhFromDate,
                a.remoteToDate as wfhToDate,
                a.remoteReason as wfhReason,
                a.remoteApprovedAt as wfhApprovedAt,
                a.remoteRejectedReason as wfhRejectedReason,
                a.remoteApprovedBy as wfhApprovedBy,
                a.type,
                a.created_at,
                u.name as employeeName,
                u.email as employeeEmail,
                (SELECT name FROM tbl_users WHERE id = a.remoteApprovedBy) as approvedByName
            FROM attendance a
            LEFT JOIN tbl_users u ON a.userId = u.id
            WHERE a.remoteStatus IS NOT NULL AND a.status = 'Y'
        `;

        const params: any[] = [];
        if (status && ['Pending', 'Approved', 'Rejected'].includes(status as string)) {
            query += ` AND a.remoteStatus = ?`;
            params.push(status);
        }

        query += ` ORDER BY a.created_at DESC`;

        const [rows] = await pool.query(query, params);

        res.status(200).json({
            success: true,
            count: (rows as any[]).length,
            data: rows
        });

    } catch (error) {
        console.error("Get All Remote Requests Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Get Remote request by ID
// ✅ Admin: Get Remote request by ID
export const getWFHRequestById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;

        const [rows]: any = await pool.query(
            `SELECT 
                a.*,
                u.name as employeeName,
                u.email as employeeEmail,
                (SELECT name FROM tbl_users WHERE id = a.remoteApprovedBy) as approvedByName
            FROM attendance a
            LEFT JOIN tbl_users u ON a.userId = u.id
            WHERE a.id = ? AND a.remoteStatus IS NOT NULL AND a.status = 'Y'`,
            [requestId]
        );

        if (!rows.length) {
            res.status(404).json({ 
                message: "Remote request not found" 
            });
            return;
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error("Get Remote Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Approve Remote request
export const approveWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        const adminId = req.body.adminId || 1;

        const [request]: any = await pool.query(
            "SELECT * FROM attendance WHERE id = ? AND remoteStatus = 'Pending' AND status = 'Y'",
            [requestId]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "Request not found or already processed" 
            });
            return;
        }

        await pool.query(
            `UPDATE attendance 
             SET remoteStatus = 'Approved', 
                 remoteApprovedBy = ?, 
                 remoteApprovedAt = NOW(),
                 type = 'Remote'
             WHERE id = ?`,
            [adminId, requestId]
        );

        res.status(200).json({
            success: true,
            message: "Remote work request approved successfully",
            requestId: requestId
        });

    } catch (error) {
        console.error("Approve Remote Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Reject Remote request
export const rejectWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        const { rejectedReason } = req.body;
        const adminId = req.body.adminId || 1;

        const [request]: any = await pool.query(
            "SELECT * FROM attendance WHERE id = ? AND remoteStatus = 'Pending' AND status = 'Y'",
            [requestId]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "Request not found or already processed" 
            });
            return;
        }

        await pool.query(
            `UPDATE attendance 
             SET remoteStatus = 'Rejected', 
                 remoteApprovedBy = ?, 
                 remoteApprovedAt = NOW(),
                 remoteRejectedReason = ?,
                 type = 'Onsite'
             WHERE id = ?`,
            [adminId, rejectedReason || null, requestId]
        );

        res.status(200).json({
            success: true,
            message: "Remote work request rejected",
            requestId: requestId
        });

    } catch (error) {
        console.error("Reject Remote Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Delete Remote request
export const deleteWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const [request]: any = await pool.query(
            "SELECT * FROM attendance WHERE id = ? AND remoteStatus IS NOT NULL AND status = 'Y'",
            [id]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "Remote request not found" 
            });
            return;
        }

        // Soft delete
        await pool.query(
            "UPDATE attendance SET status = 'N' WHERE id = ?",
            [id]
        );

        res.status(200).json({
            success: true,
            message: "Remote request deleted successfully"
        });

    } catch (error) {
        console.error("Delete Remote Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Add Remote request for employee (Auto-Approved)
export const adminAddWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId, fromDate, toDate, reason, approvedBy } = req.body;

        if (!userId || !fromDate || !toDate) {
            res.status(400).json({ 
                message: "Employee, From Date and To Date are required" 
            });
            return;
        }

        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const from = moment.tz(fromDate, "Asia/Karachi");
        const to = moment.tz(toDate, "Asia/Karachi");

        if (from.isAfter(to)) {
            res.status(400).json({ 
                message: "From Date must be before or equal to To Date" 
            });
            return;
        }

        // Check if employee already marked attendance
        const [attendanceRows]: any = await pool.query(
            `SELECT date FROM attendance 
             WHERE userId = ? AND date BETWEEN ? AND ? AND status = 'Y' AND clockIn IS NOT NULL`,
            [userId, fromDate, toDate]
        );

        if (attendanceRows.length > 0) {
            const dates = attendanceRows.map((row: any) => row.date);
            res.status(409).json({
                message: `Employee has already marked attendance on: ${dates.join(', ')}`,
                conflict: {
                    type: "ATTENDANCE_EXISTS",
                    dates: dates
                }
            });
            return;
        }

        // Check if employee already has remote request
        const [existingRemote]: any = await pool.query(
            `SELECT * FROM attendance 
             WHERE userId = ? AND remoteStatus IN ('Pending', 'Approved') AND status = 'Y'
             AND (
                 (remoteFromDate BETWEEN ? AND ?) OR 
                 (remoteToDate BETWEEN ? AND ?) OR 
                 (? BETWEEN remoteFromDate AND remoteToDate)
             )`,
            [userId, fromDate, toDate, fromDate, toDate, fromDate]
        );

        if (existingRemote.length > 0) {
            res.status(400).json({
                message: `Employee already has a ${existingRemote[0].remoteStatus} Remote request for these dates`
            });
            return;
        }

        // ✅ Insert with AUTO-APPROVED status
        const [result] = await pool.query(
            `INSERT INTO attendance 
             (userId, date, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, remoteReason, 
              remoteApprovedBy, remoteApprovedAt, status, type) 
             VALUES (?, ?, 'Approved', ?, ?, ?, ?, ?, NOW(), 'Y', 'Remote')`,
            [userId, today, today, fromDate, toDate, reason || null, approvedBy || null]
        );

        res.status(201).json({
            success: true,
            message: "Remote work request added and auto-approved successfully",
            requestId: (result as any).insertId,
            status: "Approved",
            data: {
                userId,
                fromDate,
                toDate,
                reason: reason || null
            }
        });

    } catch (error) {
        console.error("Admin Add Remote Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Get Remote statistics
export const getWFHStatistics = async (req: Request, res: Response): Promise<void> => {
    try {
        const { year, month } = req.query;

        let query = `
            SELECT 
                COUNT(CASE WHEN remoteStatus = 'Pending' THEN 1 END) as pending,
                COUNT(CASE WHEN remoteStatus = 'Approved' THEN 1 END) as approved,
                COUNT(CASE WHEN remoteStatus = 'Rejected' THEN 1 END) as rejected,
                COUNT(CASE WHEN type = 'Remote' AND remoteStatus = 'Approved' AND date = CURDATE() THEN 1 END) as activeRemoteToday
            FROM attendance
            WHERE remoteStatus IS NOT NULL AND status = 'Y'
        `;
        const params: any[] = [];

        if (year) {
            query += ` AND YEAR(remoteRequestDate) = ?`;
            params.push(year);
        }

        if (month) {
            query += ` AND MONTH(remoteRequestDate) = ?`;
            params.push(month);
        }

        const [stats] = await pool.query(query, params);

        // Get top Remote employees
        const [topEmployees] = await pool.query(
            `SELECT 
                userId,
                (SELECT name FROM tbl_users WHERE id = userId) as employeeName,
                COUNT(CASE WHEN remoteStatus = 'Approved' THEN 1 END) as approvedDays,
                COUNT(CASE WHEN remoteStatus = 'Pending' THEN 1 END) as pendingDays
            FROM attendance
            WHERE remoteStatus IS NOT NULL AND status = 'Y'
            GROUP BY userId
            ORDER BY approvedDays DESC
            LIMIT 10`
        );

        res.status(200).json({
            success: true,
            statistics: (stats as any[])[0],
            topEmployees: topEmployees
        });

    } catch (error) {
        console.error("Get Remote Statistics Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};