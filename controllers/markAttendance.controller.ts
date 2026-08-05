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
// GET ATTENDANCE (Employee) - WITH LEAVE CHECK
// ============================================================
export const getAttendance = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

        // ============================================================
        // 1️⃣ CHECK FOR APPROVED LEAVE TODAY
        // ============================================================
        const [leaveRows]: any = await pool.query(
            `SELECT id, fromDate, toDate, leaveType, leaveSubject, leaveReason, leaveStatus
             FROM leaves 
             WHERE userId = ? 
             AND ? BETWEEN fromDate AND toDate 
             AND leaveStatus = 'Approved'
             AND status = 'Y'
             LIMIT 1`,
            [userId, today]
        );

        if (leaveRows.length > 0) {
            const leave = leaveRows[0];
            const leaveTypeUpper = (leave.leaveType || leave.leaveSubject || "").toUpperCase();
            const isShortLeave = leaveTypeUpper === "SHORT LEAVE";
            const isHalfDay = leaveTypeUpper === "HALF DAY";
            const maxClockIns = isShortLeave ? 2 : isHalfDay ? 1 : 0;

            // ✅ FETCH ALL attendance rows for today (ALL cycles)
            const [attRows]: any = await pool.query(
                `SELECT id, clockIn, clockOut, workingHours, type, attendanceStatus,
                        latitude, longitude, clockInLatitude, clockInLongitude,
                        clockOutLatitude, clockOutLongitude
                 FROM attendance
                 WHERE userId = ? AND date = ? AND status = 'Y'
                 ORDER BY id ASC`,
                [userId, today]
            );

            const totalClockIns = attRows.filter((r: any) => r.clockIn !== null).length;
            const openRecord = attRows.find((r: any) => r.clockIn !== null && r.clockOut === null) || null;
            const latestRecord = attRows.length > 0 ? attRows[attRows.length - 1] : null;
            const activeRecord = openRecord || latestRecord;

            // ✅ RETURN ALL CYCLES in the response
            res.status(200).json({
                // Active/current record
                id: activeRecord?.id || null,
                clockIn: activeRecord?.clockIn || null,
                clockOut: activeRecord?.clockOut || null,
                workingHours: activeRecord?.workingHours || null,
                type: activeRecord?.type || null,
                attendanceStatus: activeRecord?.attendanceStatus || `Leave (${leave.leaveType || leave.leaveSubject})`,
                latitude: activeRecord?.latitude || null,
                longitude: activeRecord?.longitude || null,
                clockInLatitude: activeRecord?.clockInLatitude || null,
                clockInLongitude: activeRecord?.clockInLongitude || null,
                clockOutLatitude: activeRecord?.clockOutLatitude || null,
                clockOutLongitude: activeRecord?.clockOutLongitude || null,
                date: today,
                
                // Leave info
                leaveReason: leave.leaveReason,
                leaveStatus: leave.leaveStatus,
                leaveType: leave.leaveType || leave.leaveSubject,
                isLeave: true,
                isLeaveApproved: true,
                message: `User is on approved ${leave.leaveType || leave.leaveSubject} leave today.`,
                fromDate: leave.fromDate,
                toDate: leave.toDate,
                
                // ✅ ALL CYCLES for this day
                totalClockIns,
                maxClockIns,
                canClockInMore: (isShortLeave || isHalfDay) && totalClockIns < maxClockIns,
                cycles: attRows  // ✅ Returns ALL records (1st and 2nd clock in/out)
            });
            return;
        }

        // ============================================================
        // 2️⃣ CHECK FOR PENDING LEAVE TODAY
        // ============================================================
        const [pendingLeaveRows]: any = await pool.query(
            `SELECT id, fromDate, toDate, leaveType, leaveSubject, leaveReason, leaveStatus
             FROM leaves 
             WHERE userId = ? 
             AND ? BETWEEN fromDate AND toDate 
             AND leaveStatus = 'Pending'
             AND status = 'Y'
             LIMIT 1`,
            [userId, today]
        );

        if (pendingLeaveRows.length > 0) {
            const leave = pendingLeaveRows[0];

            // ✅ FETCH ALL attendance rows for today
            const [attRows]: any = await pool.query(
                `SELECT id, clockIn, clockOut, workingHours, type, attendanceStatus,
                        latitude, longitude, clockInLatitude, clockInLongitude,
                        clockOutLatitude, clockOutLongitude
                 FROM attendance
                 WHERE userId = ? AND date = ? AND status = 'Y'
                 ORDER BY id ASC`,
                [userId, today]
            );

            const openRecord = attRows.find((r: any) => r.clockIn !== null && r.clockOut === null) || null;
            const latestRecord = attRows.length > 0 ? attRows[attRows.length - 1] : null;
            const activeRecord = openRecord || latestRecord;

            res.status(200).json({
                id: activeRecord?.id || null,
                clockIn: activeRecord?.clockIn || null,
                clockOut: activeRecord?.clockOut || null,
                workingHours: activeRecord?.workingHours || null,
                type: activeRecord?.type || null,
                attendanceStatus: activeRecord?.attendanceStatus || "Present",
                latitude: activeRecord?.latitude || null,
                longitude: activeRecord?.longitude || null,
                clockInLatitude: activeRecord?.clockInLatitude || null,
                clockInLongitude: activeRecord?.clockInLongitude || null,
                clockOutLatitude: activeRecord?.clockOutLatitude || null,
                clockOutLongitude: activeRecord?.clockOutLongitude || null,
                date: today,
                leavePending: true,
                leaveType: leave.leaveType || leave.leaveSubject,
                leaveReason: leave.leaveReason,
                message: `You have a pending ${leave.leaveType || leave.leaveSubject} leave request for today.`,
                isLeave: false,
                cycles: attRows  // ✅ Returns all records
            });
            return;
        }

        // ============================================================
        // 3️⃣ Check if user is on leave (backward compatibility)
        // ============================================================
        const [oldLeaveRows]: any = await pool.query(
            `SELECT leaveReason FROM leaves 
             WHERE userId = ? AND leaveStatus = 'Approved' 
             AND ? BETWEEN fromDate AND toDate LIMIT 1`,
            [userId, today],
        );

        if (oldLeaveRows.length > 0) {
            // ✅ Still check for attendance records
            const [attRows]: any = await pool.query(
                `SELECT id, clockIn, clockOut, workingHours, type, attendanceStatus,
                        latitude, longitude, clockInLatitude, clockInLongitude,
                        clockOutLatitude, clockOutLongitude
                 FROM attendance
                 WHERE userId = ? AND date = ? AND status = 'Y'
                 ORDER BY id ASC`,
                [userId, today]
            );
            
            const latestRecord = attRows.length > 0 ? attRows[attRows.length - 1] : null;
            
            res.status(200).json({
                attendanceStatus: "Leave",
                message: `User is on Approved Leave: ${oldLeaveRows[0].leaveReason}`,
                ...(latestRecord || {}),
                cycles: attRows
            });
            return;
        }

        // ============================================================
        // 4️⃣ Check if today is a holiday
        // ============================================================
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

        // ============================================================
        // 5️⃣ Check attendance rules for weekly off
        // ============================================================
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

        // ============================================================
        // 6️⃣ Get attendance with remote fields (ALL records for today)
        // ============================================================
        const [rows]: any = await pool.query(
            `SELECT id, userId, clockIn, clockOut, workingHours, date, attendanceStatus, 
                    latitude, longitude, clockInLatitude, clockInLongitude, 
                    clockOutLatitude, clockOutLongitude, status,
                    type, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, 
                    remoteReason, remoteApprovedBy, remoteApprovedAt, remoteRejectedReason
             FROM attendance 
             WHERE userId = ? AND date = ? AND status = 'Y'
             ORDER BY id ASC`,
            [userId, today],
        );

        if (!rows || rows.length === 0) {
            res.status(200).json({
                userId: userId,
                date: today,
                attendanceStatus: "Absent",
                message: "User has not clocked in today.",
                cycles: []
            });
            return;
        }

        // ✅ Get the latest record for the "current" state
        const latestRecord = rows[rows.length - 1];
        const openRecord = rows.find((r: any) => r.clockIn !== null && r.clockOut === null) || null;
        const activeRecord = openRecord || latestRecord;

        // ✅ Return ALL records with cycles
        const record = {
            ...activeRecord,
            cycles: rows,  // ✅ ALL records for today
            date: activeRecord?.date ? moment.tz(activeRecord.date, "Asia/Karachi").format("YYYY-MM-DD") : today
        };

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
// ============================================================
// MARK ATTENDANCE - WITH LEAVE CHECKS
// ============================================================
export const markAttendance = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.params.id;
        const { latitude, longitude, isRemote } = req.body;

        if (!latitude || !longitude) {
            res.status(400).json({
                message: "Location is required",
                code: "LOCATION_REQUIRED"
            });
            return;
        }

        const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
        const currentTime = moment.tz("Asia/Karachi").format("HH:mm:ss");

        // ============================================================
        // 1️⃣ CHECK FOR APPROVED LEAVE TODAY
        // ============================================================
        const [leaveRows]: any = await pool.query(
            `SELECT id, fromDate, toDate, leaveType, leaveSubject, leaveReason, leaveStatus
             FROM leaves 
             WHERE userId = ? 
             AND ? BETWEEN fromDate AND toDate 
             AND leaveStatus = 'Approved'
             AND status = 'Y'
             LIMIT 1`,
            [userId, today]
        );

        const hasApprovedLeave = leaveRows.length > 0;
        const leaveData = hasApprovedLeave ? leaveRows[0] : null;
        const leaveType = hasApprovedLeave ? (leaveData.leaveType || leaveData.leaveSubject || '').toUpperCase() : null;
        const leaveReason = hasApprovedLeave ? leaveData.leaveReason : null;

        // ============================================================
        // 2️⃣ CHECK EXISTING ATTENDANCE FOR TODAY
        // ============================================================
        const [attendanceRows]: any = await pool.query(
            "SELECT * FROM attendance WHERE userId = ? AND date = ? AND status = 'Y' ORDER BY id ASC",
            [userId, today]
        );

        // ✅ Check if user has any clockIn today
        const hasClockIn = attendanceRows.some((r: any) => r.clockIn !== null);
        const hasOpenClockIn = attendanceRows.some((r: any) => r.clockIn !== null && r.clockOut === null);
        const openRecord = attendanceRows.find((r: any) => r.clockIn !== null && r.clockOut === null);
        const totalClockIns = attendanceRows.filter((r: any) => r.clockIn !== null).length;

        // ============================================================
        // 3️⃣ DETERMINE MAX CLOCK INS BASED ON LEAVE TYPE
        // ============================================================
        let maxClockInsPerDay = 1; // Default for no leave
        let leaveTypeName = "No Leave";
        let canClockIn = true;
        let canClockOut = true;

        if (hasApprovedLeave) {
            if (leaveType === 'SHORT LEAVE') {
                maxClockInsPerDay = 2;
                leaveTypeName = 'Short Leave';
                canClockIn = true;
                canClockOut = true;
            } else if (leaveType === 'HALF DAY') {
                maxClockInsPerDay = 1;
                leaveTypeName = 'Half Day';
                canClockIn = true;
                canClockOut = true;
            } else {
                // FULL DAY, CASUAL, SICK, ANNUAL, FAMILY RESPONSIBILITY
                maxClockInsPerDay = 0;
                leaveTypeName = leaveType || 'Leave';
                canClockIn = false;
                canClockOut = false;
            }
        }

        // ============================================================
        // 4️⃣ CLOCK OUT LOGIC - Check if user has open clockIn
        // ============================================================
        if (hasOpenClockIn && openRecord) {
            // ✅ User is trying to clock out
            
            // ❌ If leave type doesn't allow clock out (Full Day, etc.)
            if (hasApprovedLeave && !canClockOut) {
                res.status(400).json({
                    message: `You have approved ${leaveTypeName} leave today. Cannot clock out.`,
                    leaveType: leaveTypeName,
                    leaveReason: leaveReason,
                    isLeave: true,
                    code: "LEAVE_BLOCK"
                });
                return;
            }

            const record = openRecord;
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

            // ✅ Determine final status
    // ✅ Keep the status already stored at clock-in / leave approval time.
            // Do NOT recalculate/override with duration-based logic (was wrongly marking "Absent").
            let finalStatus = record.attendanceStatus || "Present";

            if (hasApprovedLeave && leaveType === 'SHORT LEAVE') {
                finalStatus = "Short Leave";
            } else if (hasApprovedLeave && leaveType === 'HALF DAY') {
                finalStatus = "Half Leave";
            }
            // else: finalStatus stays as record.attendanceStatus (e.g. "Present" / "Late")

            // ✅ UPDATE clockOut
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
                isLeave: hasApprovedLeave,
                leaveType: leaveTypeName,
                duration: `${durationMinutes} mins`,
                clockOutNumber: totalClockIns,
                maxClockIns: maxClockInsPerDay,
                locationVerified: true
            });
            return;
        }

        // ============================================================
        // 5️⃣ CLOCK IN LOGIC - User is trying to clock in
        // ============================================================
        
        // ❌ If user has completed max clock ins
        if (hasApprovedLeave && totalClockIns >= maxClockInsPerDay) {
            res.status(400).json({
                message: `You have already reached maximum clock ins (${maxClockInsPerDay}) for today.`,
                maxClockIns: maxClockInsPerDay,
                totalClockIns: totalClockIns,
                leaveType: leaveTypeName,
                isLeave: true,
                code: "MAX_CLOCK_INS_REACHED"
            });
            return;
        }

        // ❌ If user has completed all clock ins (no leave)
        if (!hasApprovedLeave && totalClockIns >= 1) {
            res.status(400).json({
                message: "You have already clocked in for today.",
                code: "ALREADY_CLOCKED_IN"
            });
            return;
        }

        // ❌ If leave type doesn't allow clock in (Full Day, etc.)
        if (hasApprovedLeave && !canClockIn) {
            res.status(400).json({
                message: `You have approved ${leaveTypeName} leave today. Cannot clock in.`,
                leaveType: leaveTypeName,
                leaveReason: leaveReason,
                isLeave: true,
                code: "LEAVE_BLOCK"
            });
            return;
        }

        // ✅ CLOCK IN - Allowed
        let attendanceStatus = "Present";
        const type = isRemote ? "Remote" : "Onsite";

        if (hasApprovedLeave && leaveType === 'SHORT LEAVE') {
            attendanceStatus = "Short Leave";
        } else if (hasApprovedLeave && leaveType === 'HALF DAY') {
            attendanceStatus = "Present";
        } else {
            // Check for late
            const [rules]: any = await pool.query(
                "SELECT * FROM attendance_rules WHERE status = 'Active' LIMIT 1",
            );
            if (rules.length > 0 && currentTime > rules[0].lateTime) {
                attendanceStatus = "Late";
            } else {
                attendanceStatus = "Present";
            }
        }

        // ✅ INSERT new attendance record
        const [result] = await pool.query(
            `INSERT INTO attendance 
             (userId, date, clockIn, attendanceStatus, status, type,
              latitude, longitude, clockInLatitude, clockInLongitude) 
             VALUES (?, ?, ?, ?, 'Y', ?, ?, ?, ?, ?)`,
            [
                userId, today, currentTime, attendanceStatus,
                type,
                latitude, longitude, latitude, longitude
            ]
        );

        res.status(200).json({
            message: `Clock In successful`,
            status: attendanceStatus,
            type: type,
            isRemote: isRemote,
            isLeave: hasApprovedLeave,
            leaveType: leaveTypeName,
            clockInNumber: totalClockIns + 1,
            maxClockIns: maxClockInsPerDay,
            locationVerified: true
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