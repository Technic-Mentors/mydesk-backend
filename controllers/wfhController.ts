import { Request, Response } from "express";
import pool from "../database/db";
import moment from "moment-timezone";

// ============================================================
// EMPLOYEE CONTROLLERS
// ============================================================

// ✅ Employee: Request WFH
export const requestWFH = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { fromDate, toDate, reason } = req.body;

        // Validation
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
                message: "Reason is required for WFH request" 
            });
            return;
        }

        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const from = moment.tz(fromDate, "Asia/Karachi");
        const to = moment.tz(toDate, "Asia/Karachi");

        // Check if dates are valid
        if (from.isBefore(today)) {
            res.status(400).json({ 
                message: "Cannot request WFH for past dates" 
            });
            return;
        }

        if (from.isAfter(to)) {
            res.status(400).json({ 
                message: "From Date must be before or equal to To Date" 
            });
            return;
        }

        // Check if already have pending/approved request for these dates
        const [existingRequests]: any = await pool.query(
            `SELECT * FROM wfh_requests 
             WHERE userId = ? 
             AND wfhStatus IN ('Pending', 'Approved')
             AND (
                 (fromDate BETWEEN ? AND ?) OR 
                 (toDate BETWEEN ? AND ?) OR 
                 (? BETWEEN fromDate AND toDate)
             )`,
            [userId, fromDate, toDate, fromDate, toDate, fromDate]
        );

        if (existingRequests.length > 0) {
            res.status(400).json({ 
                message: "You already have a pending or approved WFH request for these dates" 
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
                message: "You have an approved leave during these dates. Cannot request WFH."
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
                message: `Cannot request WFH during holidays: ${holidayRows.map((h: any) => h.holiday).join(', ')}`
            });
            return;
        }

        // Insert WFH request
        const [result] = await pool.query(
            `INSERT INTO wfh_requests 
             (userId, requestDate, fromDate, toDate, reason, wfhStatus) 
             VALUES (?, ?, ?, ?, ?, 'Pending')`,
            [userId, today, fromDate, toDate, reason || null]
        );

        res.status(201).json({
            success: true,
            message: "WFH request submitted successfully",
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
        console.error("WFH Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Employee: Get my WFH requests
export const getMyWFHRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { status } = req.query;

        let query = `SELECT * FROM wfh_requests WHERE userId = ?`;
        const params: any[] = [userId];

        if (status && ['Pending', 'Approved', 'Rejected'].includes(status as string)) {
            query += ` AND wfhStatus = ?`;
            params.push(status);
        }

        query += ` ORDER BY createdAt DESC`;

        const [rows] = await pool.query(query, params);

        res.status(200).json({
            success: true,
            count: (rows as any[]).length,
            data: rows
        });

    } catch (error) {
        console.error("Get My WFH Requests Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Employee: Check WFH status for today
export const checkWFHStatusForToday = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

        const [rows]: any = await pool.query(
            `SELECT * FROM wfh_requests 
             WHERE userId = ? 
             AND wfhStatus = 'Approved'
             AND ? BETWEEN fromDate AND toDate
             LIMIT 1`,
            [userId, today]
        );

        if (rows.length > 0) {
            res.status(200).json({
                success: true,
                isWFH: true,
                message: "You are approved for WFH today",
                data: rows[0]
            });
        } else {
            res.status(200).json({
                success: true,
                isWFH: false,
                message: "No WFH approval for today"
            });
        }

    } catch (error) {
        console.error("Check WFH Status Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Employee: Cancel WFH request (only if Pending)
export const cancelWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { requestId } = req.params;

        // Check if request exists and belongs to user
        const [request]: any = await pool.query(
            "SELECT * FROM wfh_requests WHERE id = ? AND userId = ?",
            [requestId, userId]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "WFH request not found" 
            });
            return;
        }

        if (request[0].wfhStatus !== 'Pending') {
            res.status(400).json({ 
                message: `Cannot cancel request. Status is ${request[0].wfhStatus}` 
            });
            return;
        }

        // Delete the request
        await pool.query(
            "DELETE FROM wfh_requests WHERE id = ? AND userId = ?",
            [requestId, userId]
        );

        res.status(200).json({
            success: true,
            message: "WFH request cancelled successfully"
        });

    } catch (error) {
        console.error("Cancel WFH Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ============================================================
// ADMIN CONTROLLERS
// ============================================================

// ✅ Admin: Get all WFH requests
export const getAllWFHRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const { status } = req.query;

        let query = `
            SELECT 
                wr.*,
                u.name as employeeName,
                u.email as employeeEmail
            FROM wfh_requests wr
            LEFT JOIN tbl_users u ON wr.userId = u.id
        `;  // ✅ Changed to tbl_users
        
        const params: any[] = [];

        if (status && ['Pending', 'Approved', 'Rejected'].includes(status as string)) {
            query += ` WHERE wr.wfhStatus = ?`;
            params.push(status);
        }

        query += ` ORDER BY wr.createdAt DESC`;

        const [rows] = await pool.query(query, params);

        res.status(200).json({
            success: true,
            count: (rows as any[]).length,
            data: rows
        });

    } catch (error) {
        console.error("Get All WFH Requests Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Get WFH request by ID
export const getWFHRequestById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;

        const [rows]: any = await pool.query(
            `SELECT 
                wr.*,
                u.name as employeeName,
                u.email as employeeEmail,
                (SELECT name FROM tbl_users WHERE id = wr.approvedBy) as approvedByName
            FROM wfh_requests wr
            LEFT JOIN tbl_users u ON wr.userId = u.id
            WHERE wr.id = ?`,
            [requestId]
        );  // ✅ Changed to tbl_users

        if (!rows.length) {
            res.status(404).json({ 
                message: "WFH request not found" 
            });
            return;
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error("Get WFH Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Approve WFH request
export const approveWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        const adminId = req.body.adminId || 1;

        // Check if request exists and is pending
        const [request]: any = await pool.query(
            "SELECT * FROM wfh_requests WHERE id = ? AND wfhStatus = 'Pending'",
            [requestId]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "Request not found or already processed" 
            });
            return;
        }

        // Update request
        await pool.query(
            `UPDATE wfh_requests 
             SET wfhStatus = 'Approved', 
                 approvedBy = ?, 
                 approvedAt = NOW()
             WHERE id = ?`,
            [adminId, requestId]
        );

        res.status(200).json({
            success: true,
            message: "WFH request approved successfully",
            requestId: requestId
        });

    } catch (error) {
        console.error("Approve WFH Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Reject WFH request
export const rejectWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        const { rejectedReason } = req.body;
        const adminId = req.body.adminId || 1;

        // Check if request exists and is pending
        const [request]: any = await pool.query(
            "SELECT * FROM wfh_requests WHERE id = ? AND wfhStatus = 'Pending'",
            [requestId]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "Request not found or already processed" 
            });
            return;
        }

        // Update request
        await pool.query(
            `UPDATE wfh_requests 
             SET wfhStatus = 'Rejected', 
                 approvedBy = ?, 
                 approvedAt = NOW(),
                 rejectedReason = ?
             WHERE id = ?`,
            [adminId, rejectedReason || null, requestId]
        );

        res.status(200).json({
            success: true,
            message: "WFH request rejected",
            requestId: requestId
        });

    } catch (error) {
        console.error("Reject WFH Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ Admin: Get WFH statistics
export const getWFHStatistics = async (req: Request, res: Response): Promise<void> => {
    try {
        const { year, month } = req.query;

        let query = `
            SELECT 
                COUNT(*) as totalRequests,
                SUM(CASE WHEN wfhStatus = 'Pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN wfhStatus = 'Approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN wfhStatus = 'Rejected' THEN 1 ELSE 0 END) as rejected
            FROM wfh_requests
            WHERE 1=1
        `;
        const params: any[] = [];

        if (year) {
            query += ` AND YEAR(fromDate) = ?`;
            params.push(year);
        }

        if (month) {
            query += ` AND MONTH(fromDate) = ?`;
            params.push(month);
        }

        const [stats] = await pool.query(query, params);

        // Get top WFH employees - ✅ Changed to tbl_users
        const [topEmployees] = await pool.query(
            `SELECT 
                wr.userId,
                (SELECT name FROM tbl_users WHERE id = wr.userId) as employeeName,
                COUNT(*) as totalDays
            FROM wfh_requests wr
            WHERE wfhStatus = 'Approved'
            GROUP BY wr.userId
            ORDER BY totalDays DESC
            LIMIT 10`
        );

        res.status(200).json({
            success: true,
            statistics: (stats as any[])[0],
            topEmployees: topEmployees
        });

    } catch (error) {
        console.error("Get WFH Statistics Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
// ✅ Admin: Delete/Cancel WFH request
export const deleteWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        // Check if request exists
        const [request]: any = await pool.query(
            "SELECT * FROM wfh_requests WHERE id = ?",
            [id]
        );

        if (!request.length) {
            res.status(404).json({ 
                message: "WFH request not found" 
            });
            return;
        }

        // Delete the request
        await pool.query(
            "DELETE FROM wfh_requests WHERE id = ?",
            [id]
        );

        res.status(200).json({
            success: true,
            message: "WFH request deleted successfully"
        });

    } catch (error) {
        console.error("Delete WFH Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
// ✅ Admin: Add WFH request for employee (Auto-Approved)
export const adminAddWFHRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId, fromDate, toDate, reason, approvedBy } = req.body;

        // Validation
        if (!userId || !fromDate || !toDate) {
            res.status(400).json({ 
                message: "Employee, From Date and To Date are required" 
            });
            return;
        }

        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const from = moment.tz(fromDate, "Asia/Karachi");
        const to = moment.tz(toDate, "Asia/Karachi");

        // Check if dates are valid
        if (from.isAfter(to)) {
            res.status(400).json({ 
                message: "From Date must be before or equal to To Date" 
            });
            return;
        }

        // Check if user has existing request for these dates
        const [existingRequests]: any = await pool.query(
            `SELECT * FROM wfh_requests 
             WHERE userId = ? 
             AND wfhStatus IN ('Pending', 'Approved')
             AND (
                 (fromDate BETWEEN ? AND ?) OR 
                 (toDate BETWEEN ? AND ?) OR 
                 (? BETWEEN fromDate AND toDate)
             )`,
            [userId, fromDate, toDate, fromDate, toDate, fromDate]
        );

        if (existingRequests.length > 0) {
            res.status(400).json({ 
                message: "Employee already has a pending or approved WFH request for these dates" 
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
                message: "Employee has an approved leave during these dates. Cannot request WFH."
            });
            return;
        }

        // Insert WFH request with AUTO-APPROVED status
        const [result] = await pool.query(
            `INSERT INTO wfh_requests 
             (userId, requestDate, fromDate, toDate, reason, wfhStatus, approvedBy, approvedAt) 
             VALUES (?, ?, ?, ?, ?, 'Approved', ?, NOW())`,
            [userId, today, fromDate, toDate, reason || null, approvedBy || null]
        );

        res.status(201).json({
            success: true,
            message: "WFH request added and auto-approved successfully",
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
        console.error("Admin Add WFH Request Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};