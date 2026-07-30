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
// GET ATTENDANCE (Employee)
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

        // ✅ Get attendance with remote fields
        const [rows]: any = await pool.query(
            `SELECT id, userId, clockIn, clockOut, workingHours, date, attendanceStatus, 
                    latitude, longitude, clockInLatitude, clockInLongitude, 
                    clockOutLatitude, clockOutLongitude, status,
                    type, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, 
                    remoteReason, remoteApprovedBy, remoteApprovedAt, remoteRejectedReason
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
// MARK ATTENDANCE (Single Table - Remote)
// ============================================================
// ============================================================
// MARK ATTENDANCE - With "Late (Remote)" Support
// ============================================================
// ============================================================
// MARK ATTENDANCE - Fixed Remote Clock In
// ============================================================
export const markAttendance = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { latitude, longitude } = req.body;

        if (!latitude || !longitude) {
            res.status(400).json({
                message: "Location is required",
                code: "LOCATION_REQUIRED"
            });
            return;
        }

        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const currentTime = moment.tz("Asia/Karachi").format("HH:mm:ss");

        // Check leave
        const [leaveRows]: any = await pool.query(
            `SELECT id FROM leaves 
             WHERE userId = ? AND leaveStatus = 'Approved' 
             AND ? BETWEEN fromDate AND toDate LIMIT 1`,
            [userId, today],
        );
        if (leaveRows.length > 0) {
            res.status(400).json({ message: "You are on leave today" });
            return;
        }

        // Check holiday
        const [holidayRows]: any = await pool.query(
            `SELECT holiday FROM holidays 
             WHERE ? BETWEEN fromDate AND toDate AND holidayStatus = 'Y' LIMIT 1`,
            [today],
        );
        if (holidayRows.length > 0) {
            res.status(400).json({ message: `Today is Holiday: ${holidayRows[0].holiday}` });
            return;
        }

        // Get attendance rules
        const [rules]: any = await pool.query(
            "SELECT * FROM attendance_rules WHERE status = 'Active' LIMIT 1",
        );
        if (!rules.length) {
            res.status(400).json({ message: "Attendance rules not configured" });
            return;
        }

        const {
            startTime, endTime, lateTime, halfLeave, offDay,
            officeLatitude, officeLongitude, allowedRadius = 100,
            shortLeaveThreshold = 120, allowWFH = true
        } = rules[0];

        const todayDayName = moment.tz("Asia/Karachi").format("dddd");
        if (offDay && todayDayName.toLowerCase() === offDay.toLowerCase()) {
            res.status(400).json({ message: `${offDay} is Weekly Off` });
            return;
        }

        // ============================================================
        // ✅ CHECK FOR REMOTE APPROVAL
        // ============================================================
   let isRemote = false;
        let remoteRecordId = null;
        let remoteReason = null;
        let remoteFromDateOriginal = null;
        let remoteToDateOriginal = null;
        let remoteRequestDateOriginal = null;

        if (allowWFH) {
            const [remoteRows]: any = await pool.query(
                `SELECT id, remoteStatus, remoteFromDate, remoteToDate, remoteReason, remoteRequestDate
                 FROM attendance 
                 WHERE userId = ? 
                 AND remoteStatus = 'Approved'
                 AND remoteFromDate <= ? AND remoteToDate >= ?
                 AND status = 'Y'
                 LIMIT 1`,
                [userId, today, today]
            );

            if (remoteRows.length > 0) {
                isRemote = true;
                remoteRecordId = remoteRows[0].id;
                remoteReason = remoteRows[0].remoteReason;
                remoteFromDateOriginal = remoteRows[0].remoteFromDate;
                remoteToDateOriginal = remoteRows[0].remoteToDate;
                remoteRequestDateOriginal = remoteRows[0].remoteRequestDate;
                console.log("✅ Found approved remote record ID:", remoteRecordId);
            }
        }
        // ============================================================
        // LOCATION VALIDATION
        // ============================================================
        let locationValid = false;
        let locationMessage = "";

        if (isRemote) {
            locationValid = true;
            locationMessage = "Remote work approved - No location restriction";
        } else {
            if (officeLatitude && officeLongitude) {
                const distance = calculateDistance(latitude, longitude, officeLatitude, officeLongitude);
                if (distance <= allowedRadius) {
                    locationValid = true;
                    locationMessage = `Within office radius (${Math.round(distance)}m)`;
                } else {
                    locationValid = false;
                    locationMessage = `You are ${Math.round(distance)}m away. Must be within ${allowedRadius}m`;
                }
            } else {
                locationValid = true;
                locationMessage = "Office location not configured - location check skipped";
            }
        }

        if (!locationValid) {
            res.status(400).json({
                message: locationMessage,
                code: "LOCATION_INVALID",
                requiresRemote: true,
                isRemote: false
            });
            return;
        }

        // ============================================================
        // ✅ CHECK FOR EXISTING ATTENDANCE RECORD WITH clockIn
        // ============================================================
        const [rows]: any = await pool.query(
            "SELECT * FROM attendance WHERE userId = ? AND date = ? AND status = 'Y'",
            [userId, today],
        );

        // ✅ Check if there's a record with clockIn already
        const existingClockInRecord = rows.find((r: any) => r.clockIn !== null);

        // ============================================================
        // CLOCK IN
        // ============================================================
        if (!rows.length || !existingClockInRecord) {
            let attendanceStatus = "Present";
            const type = isRemote ? "Remote" : "Onsite";

            if (isRemote) {
                // ✅ Remote - Check for late
                if (currentTime > lateTime) {
                    attendanceStatus = "Late (Remote)";
                } else {
                    attendanceStatus = "Present (Remote)";
                }
            } else {
                // ✅ Onsite - Check for late
                if (currentTime > lateTime) {
                    attendanceStatus = "Late";
                } else {
                    attendanceStatus = "Present";
                }
            }

            // ✅ Check if there's a remote record WITHOUT clockIn to update
            let existingRecord = null;
            if (isRemote && remoteRecordId) {
                const [remoteRecord]: any = await pool.query(
                    "SELECT * FROM attendance WHERE id = ? AND status = 'Y' AND clockIn IS NULL",
                    [remoteRecordId]
                );
                if (remoteRecord.length > 0) {
                    existingRecord = remoteRecord[0];
                }
            }

            if (existingRecord) {
                // ✅ UPDATE existing remote record with clockIn (NOT clockOut!)
                await pool.query(
                    `UPDATE attendance 
                     SET clockIn = ?, 
                         attendanceStatus = ?,
                         latitude = ?,
                         longitude = ?,
                         clockInLatitude = ?,
                         clockInLongitude = ?
                     WHERE id = ?`,
                    [
                        currentTime,
                        attendanceStatus,
                        latitude,
                        longitude,
                        latitude,
                        longitude,
                        existingRecord.id
                    ]
                );

                res.status(200).json({
                    message: `Clock In successful`,
                    status: attendanceStatus,
                    type: type,
                    isRemote: isRemote,
                    locationVerified: locationValid,
                    locationMessage: locationMessage,
                    recordId: existingRecord.id
                });
                return;
         } else {
                // ✅ INSERT new record (fallback)
                // NOTE: this is just a daily attendance row against an already-approved
                // remote request — NOT a new WFH request. remoteStatus stays NULL so it
                // never shows up as a separate "Approved" request in admin/employee lists.
                const [result] = await pool.query(
                    `INSERT INTO attendance 
                     (userId, date, clockIn, attendanceStatus, status, 
                      type, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, remoteReason,
                      parentRequestId,
                      latitude, longitude, clockInLatitude, clockInLongitude) 
                     VALUES (?, ?, ?, ?, 'Y', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        userId, today, currentTime, attendanceStatus,
                        type,
                        null,
                        isRemote ? remoteRequestDateOriginal : null,
                        isRemote ? remoteFromDateOriginal : null,
                        isRemote ? remoteToDateOriginal : null,
                        isRemote ? remoteReason || "Remote work" : null,
                        isRemote ? remoteRecordId : null,
                        latitude, longitude, latitude, longitude
                    ]
                );


                res.status(200).json({
                    message: `Clock In successful`,
                    status: attendanceStatus,
                    type: type,
                    isRemote: isRemote,
                    locationVerified: locationValid,
                    locationMessage: locationMessage
                });
                return;
            }
        }

        // ============================================================
        // CLOCK OUT
        // ============================================================
        const record = existingClockInRecord || rows[0];

        if (record.clockOut) {
            res.status(400).json({ 
                message: "You have already clocked out for today." 
            });
            return;
        }

        const clockInMoment = moment(record.clockIn, "HH:mm:ss");
        const clockOutMoment = moment(currentTime, "HH:mm:ss");
        const durationMinutes = clockOutMoment.diff(clockInMoment, "minutes");

        if (durationMinutes < 2) {
            res.status(400).json({
                message: "Please wait 2 minutes before clocking out",
                code: "MINIMUM_TIME"
            });
            return;
        }

        const durationMilliseconds = clockOutMoment.diff(clockInMoment);
        const diff = moment.utc(durationMilliseconds).format("HH:mm:ss");

        // ✅ Keep remote status (whether Late (Remote) or Present (Remote))
        let finalStatus;
        if (record.type === "Remote") {
            finalStatus = record.attendanceStatus;
        } else {
            finalStatus = determineAttendanceStatus(
                record.clockIn, currentTime, startTime, endTime,
                lateTime, halfLeave, shortLeaveThreshold, record.attendanceStatus
            );
        }

        // ✅ UPDATE clockOut (NOT clockIn!)
        await pool.query(
            `UPDATE attendance 
             SET clockOut = ?, 
                 workingHours = ?, 
                 attendanceStatus = ?,
                 clockOutLatitude = ?,
                 clockOutLongitude = ?
             WHERE id = ?`,
            [currentTime, diff, finalStatus, latitude, longitude, record.id]
        );

        res.status(200).json({
            message: "Clock Out successful",
            status: finalStatus,
            type: record.type,
            isRemote: record.type === "Remote",
            duration: `${durationMinutes} mins`,
            locationVerified: locationValid,
            locationMessage: locationMessage
        });

    } catch (error) {
        console.error("Mark Attendance Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ============================================================
// GET ATTENDANCE FOR ADMIN
// ============================================================
export const getAttendanceForAdmin = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

        const [rows]: any = await pool.query(
            `SELECT id, userId, clockIn, clockOut, workingHours, date, attendanceStatus, 
                    latitude, longitude, clockInLatitude, clockInLongitude, 
                    clockOutLatitude, clockOutLongitude, status,
                    type, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, 
                    remoteReason, remoteApprovedBy, remoteApprovedAt, remoteRejectedReason
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