import { Request, Response } from "express";
import pool from "../database/db";
import moment from "moment-timezone";

// Helper function to calculate distance
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
};

// Helper function to determine attendance status
const determineAttendanceStatus = (
    clockIn: string,
    clockOut: string,
    startTime: string,
    endTime: string,
    lateTime: string,
    halfLeaveTime: string,
    shortLeaveThresholdMinutes: number,
    currentStatus: string
): string => {
    const clockInMoment = moment(clockIn, "HH:mm:ss");
    const clockOutMoment = moment(clockOut, "HH:mm:ss");
    const startMoment = moment(startTime, "HH:mm:ss");
    const endMoment = moment(endTime, "HH:mm:ss");
    const halfLeaveMoment = moment(halfLeaveTime, "HH:mm:ss");
    
    const totalMinutesWorked = clockOutMoment.diff(clockInMoment, "minutes");
    const expectedShiftMinutes = endMoment.diff(startMoment, "minutes");
    const percentageCompleted = (totalMinutesWorked / expectedShiftMinutes) * 100;

    if (totalMinutesWorked < 30) {
        return "Absent";
    }
    
    if (totalMinutesWorked < shortLeaveThresholdMinutes) {
        return "Short Leave";
    }
    
    if (percentageCompleted <= 50) {
        return "Half Leave";
    }
    
    if (clockInMoment.isAfter(moment(lateTime, "HH:mm:ss"))) {
        return "Late";
    }
    
    return "Present";
};

// ============================================================
// UPDATED: Get Attendance (Employee)
// ============================================================
export const getAttendance = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

        // Check if user is on leave
        const [leaveRows]: any = await pool.query(
            `SELECT leaveReason FROM leaves 
             WHERE userId = ? AND leaveStatus = 'Approved' 
             AND ? BETWEEN fromDate AND toDate LIMIT 1`,
            [userId, today],
        );

        if (leaveRows.length > 0) {
            res.status(200).json({
                attendanceStatus: "Leave",
                message: `User is on Approved Leave: ${leaveRows[0].leaveReason}`,
            });
            return;
        }

        // Check if today is a holiday
        const [holidayRows]: any = await pool.query(
            `SELECT holiday FROM holidays 
             WHERE ? BETWEEN fromDate AND toDate AND holidayStatus = 'Y' LIMIT 1`,
            [today],
        );

        if (holidayRows.length > 0) {
            res.status(200).json({
                attendanceStatus: "Holiday",
                message: `Today is holiday: ${holidayRows[0].holiday}`,
            });
            return;
        }

        // Check attendance rules for weekly off
        const [rules]: any = await pool.query(
            "SELECT * FROM attendance_rules WHERE status = 'Active' LIMIT 1",
        );

        if (!rules.length) {
            res.status(400).json({
                message: "Firstly configure Attendance Rule.",
            });
            return;
        }

        if (rules.length) {
            const { offDay } = rules[0];
            const todayDayName = moment.tz("Asia/Karachi").format("dddd");

            if (offDay && todayDayName.toLowerCase() === offDay.toLowerCase()) {
                res.status(200).json({
                    attendanceStatus: "Holiday",
                    message: `${offDay} is Weekly Off`,
                });
                return;
            }
        }

        const [rows]: any = await pool.query(
            `SELECT id, userId, clockIn, clockOut, workingHours, date, attendanceStatus, 
                    latitude, longitude, clockInLatitude, clockInLongitude, 
                    clockOutLatitude, clockOutLongitude, status, isWFH, wfhRequestId
             FROM attendance 
             WHERE userId = ? AND date = ? AND status = 'Y'`,
            [userId, today],
        );

        if (!rows || rows.length === 0) {
            res.status(200).json({
                userId: userId,
                date: today,
                attendanceStatus: "Absent",
                message: "User has not clocked in today.",
            });
            return;
        }

        const record = rows[0];
        if (record && record.date) {
            record.date = moment.tz(record.date, "Asia/Karachi").format("YYYY-MM-DD");
        }

        res.status(200).json(record);
    } catch (error) {
        console.error("Get Attendance Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Internal server error" });
        }
    }
};

// ============================================================
// UPDATED: Mark Attendance with WFH Logic
// ============================================================
export const markAttendance = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { latitude, longitude } = req.body;

        // Validation 1: Check if location is provided
        if (!latitude || !longitude) {
            res.status(400).json({ 
                message: "Location is required. Please enable GPS and allow location access.",
                code: "LOCATION_REQUIRED"
            });
            return;
        }

        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const currentTime = moment.tz("Asia/Karachi").format("HH:mm:ss");

        // Validation 2: Check if user is on leave
        const [leaveRows]: any = await pool.query(
            `SELECT id FROM leaves 
             WHERE userId = ? AND leaveStatus = 'Approved' 
             AND ? BETWEEN fromDate AND toDate LIMIT 1`,
            [userId, today],
        );

        if (leaveRows.length > 0) {
            res.status(400).json({
                message: "You are on leave today. Attendance cannot be marked.",
            });
            return;
        }

        // Validation 3: Check if today is a holiday
        const [holidayRows]: any = await pool.query(
            `SELECT holiday FROM holidays 
             WHERE ? BETWEEN fromDate AND toDate AND holidayStatus = 'Y' LIMIT 1`,
            [today],
        );

        if (holidayRows.length > 0) {
            res.status(400).json({
                message: `Today is a Holiday (${holidayRows[0].holiday}). Attendance cannot be marked.`,
            });
            return;
        }

        // Validation 4: Get attendance rules
        const [rules]: any = await pool.query(
            "SELECT * FROM attendance_rules WHERE status = 'Active' LIMIT 1",
        );
        if (!rules.length) {
            res.status(400).json({ message: "Attendance rules not configured" });
            return;
        }
        
        const { 
            startTime, 
            endTime, 
            lateTime, 
            halfLeave, 
            offDay, 
            officeLatitude, 
            officeLongitude, 
            allowedRadius = 100,
            shortLeaveThreshold = 120,
            allowWFH = true,
            wfhAllowedRadius = 0
        } = rules[0];

        const todayDayName = moment.tz("Asia/Karachi").format("dddd");

        if (offDay && todayDayName.toLowerCase() === offDay.toLowerCase()) {
            res.status(400).json({
                message: `${offDay} is configured as Off Day. Attendance cannot be marked.`,
            });
            return;
        }

        // ============================================================
        // 🆕 WFH VALIDATION
        // ============================================================
        let isWFH = false;
        let wfhRequestData = null;

        // Check if WFH is enabled in rules
        if (allowWFH) {
            // Check if user has approved WFH for today
            const [wfhRows]: any = await pool.query(
                `SELECT * FROM wfh_requests 
                 WHERE userId = ? 
                 AND wfhStatus = 'Approved'
                 AND ? BETWEEN fromDate AND toDate
                 LIMIT 1`,
                [userId, today]
            );

            if (wfhRows.length > 0) {
                wfhRequestData = wfhRows[0];
                isWFH = true;
            }
        }

        // ============================================================
        // LOCATION VALIDATION
        // ============================================================
        let locationValid = false;
        let locationMessage = "";

        if (isWFH) {
            // WFH - Location is always valid
            locationValid = true;
            
            if (wfhAllowedRadius === 0) {
                locationMessage = "WFH approved - No location restriction";
            } else if (officeLatitude && officeLongitude) {
                const distance = calculateDistance(
                    latitude, 
                    longitude, 
                    officeLatitude, 
                    officeLongitude
                );
                
                if (distance <= wfhAllowedRadius) {
                    locationMessage = `WFH approved - Within ${wfhAllowedRadius} meters of office`;
                } else {
                    locationMessage = `WFH approved - Working from home (${Math.round(distance)}m from office)`;
                }
            } else {
                locationMessage = "WFH approved - Working from home";
            }
        } else {
            // NOT WFH - Must be in office
            if (officeLatitude && officeLongitude) {
                const distance = calculateDistance(
                    latitude, 
                    longitude, 
                    officeLatitude, 
                    officeLongitude
                );
                
                if (distance <= allowedRadius) {
                    locationValid = true;
                    locationMessage = `Within office radius (${Math.round(distance)}m)`;
                } else {
                    locationValid = false;
                    locationMessage = `You are ${Math.round(distance)}m away. Must be within ${allowedRadius}m`;
                }
            } else {
                // No office location configured - allow (fallback)
                locationValid = true;
                locationMessage = "Office location not configured - location check skipped";
            }
        }

        // Reject if location invalid
        if (!locationValid) {
            res.status(400).json({
                message: locationMessage,
                code: "LOCATION_INVALID",
                requiresWFH: true,
                isWFH: false
            });
            return;
        }

        // Check if attendance already exists
        const [rows]: any = await pool.query(
            "SELECT * FROM attendance WHERE userId = ? AND date = ? AND status = 'Y'",
            [userId, today],
        );

        // ============================================================
        // CLOCK IN
        // ============================================================
        if (!rows.length) {
            let attendanceStatus = currentTime <= lateTime ? "Present" : "Late";
            
            // If WFH, update status
            if (isWFH) {
                attendanceStatus = "Present (Remote)";
            }

            const [result] = await pool.query(
                `INSERT INTO attendance 
                 (userId, clockIn, date, attendanceStatus, status, 
                  latitude, longitude, clockInLatitude, clockInLongitude,
                  isWFH, wfhRequestId) 
                 VALUES (?, ?, ?, ?, 'Y', ?, ?, ?, ?, ?, ?)`,
                [
                    userId, 
                    currentTime, 
                    today, 
                    attendanceStatus,
                    latitude,
                    longitude,
                    latitude,
                    longitude,
                    isWFH ? 1 : 0,
                    isWFH ? wfhRequestData?.id : null
                ],
            );

            // Log WFH location if applicable
            if (isWFH) {
                await pool.query(
                    `INSERT INTO wfh_location_tracking 
                     (userId, attendanceId, latitude, longitude, isVerified) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [userId, (result as any).insertId, latitude, longitude, true]
                );
            }

            res.status(200).json({
                message: `Clock In successful`,
                status: attendanceStatus,
                isWFH: isWFH,
                locationVerified: locationValid,
                locationMessage: locationMessage,
                wfhDetails: isWFH ? {
                    requestId: wfhRequestData?.id,
                    fromDate: wfhRequestData?.fromDate,
                    toDate: wfhRequestData?.toDate
                } : null
            });
            return;
        }

        // ============================================================
        // CLOCK OUT
        // ============================================================
        const record = rows[0];

        if (record.clockOut) {
            res.status(400).json({ 
                message: "You have already clocked out for today." 
            });
            return;
        }

        // Minimum time check - Prevent clocking out immediately
        const clockInMoment = moment(record.clockIn, "HH:mm:ss");
        const clockOutMoment = moment(currentTime, "HH:mm:ss");
        const durationMinutes = clockOutMoment.diff(clockInMoment, "minutes");

        if (durationMinutes < 2) {
            res.status(400).json({ 
                message: "You just clocked in. Please wait at least 2 minutes before clocking out.",
                code: "MINIMUM_TIME_NOT_MET"
            });
            return;
        }

        // Calculate working hours
        const durationMilliseconds = clockOutMoment.diff(clockInMoment);
        const diff = moment.utc(durationMilliseconds).format("HH:mm:ss");

        // Determine final attendance status
        let finalStatus;
        if (isWFH) {
            // If WFH, keep as Present (Remote)
            finalStatus = "Present (Remote)";
        } else {
            finalStatus = determineAttendanceStatus(
                record.clockIn,
                currentTime,
                startTime,
                endTime,
                lateTime,
                halfLeave,
                shortLeaveThreshold,
                record.attendanceStatus
            );
        }

        // Update attendance
        await pool.query(
            `UPDATE attendance 
             SET clockOut = ?, 
                 workingHours = ?, 
                 attendanceStatus = ?,
                 clockOutLatitude = ?,
                 clockOutLongitude = ?,
                 isWFH = ?,
                 wfhRequestId = ?
             WHERE id = ?`,
            [
                currentTime, 
                diff, 
                finalStatus,
                latitude,
                longitude,
                isWFH ? 1 : 0,
                isWFH ? wfhRequestData?.id : null,
                record.id
            ],
        );

        // Log WFH location on clock out
        if (isWFH) {
            await pool.query(
                `INSERT INTO wfh_location_tracking 
                 (userId, attendanceId, latitude, longitude, isVerified) 
                 VALUES (?, ?, ?, ?, ?)`,
                [userId, record.id, latitude, longitude, true]
            );
        }

        res.status(200).json({
            message: "Clock Out successful",
            status: finalStatus,
            isWFH: isWFH,
            duration: `${durationMinutes} mins`,
            locationVerified: locationValid,
            locationMessage: locationMessage
        });

    } catch (error) {
        console.error("Mark Attendance Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Internal server error" });
        }
    }
};

// ============================================================
// UPDATED: Get Attendance for Admin
// ============================================================
export const getAttendanceForAdmin = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

        const [rows]: any = await pool.query(
            `SELECT id, userId, clockIn, clockOut, workingHours, date, attendanceStatus, 
                    latitude, longitude, clockInLatitude, clockInLongitude, 
                    clockOutLatitude, clockOutLongitude, status, isWFH, wfhRequestId
             FROM attendance 
             WHERE userId = ? AND date = ?`,
            [userId, today],
        );

        if (!rows || rows.length === 0) {
            res.status(200).json({
                userId: userId,
                date: today,
                attendanceStatus: "Absent",
                message: "No attendance records found.",
            });
            return;
        }

        const record = rows[0];
        if (record && record.date) {
            record.date = moment.tz(record.date, "Asia/Karachi").format("YYYY-MM-DD");
        }

        res.status(200).json(record);
    } catch (error) {
        console.error("Get Attendance Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};