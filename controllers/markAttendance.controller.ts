import { Request, Response } from "express";
import pool from "../database/db";
import moment from "moment-timezone";

// Helper function to calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
};

// ✅ Helper function to determine attendance status based on shift percentage
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
  
  // Calculate total minutes worked
  const totalMinutesWorked = clockOutMoment.diff(clockInMoment, "minutes");
  
  // Calculate expected shift duration (from startTime to endTime)
  // This is the full working hours (e.g., 9:00 AM to 6:00 PM = 9 hours = 540 minutes)
  const expectedShiftMinutes = endMoment.diff(startMoment, "minutes");
  
  // Calculate percentage of shift completed
  const percentageCompleted = (totalMinutesWorked / expectedShiftMinutes) * 100;

  console.log(`📊 Shift Analysis:
    Clock In: ${clockIn}
    Clock Out: ${clockOut}
    Shift Start: ${startTime}
    Shift End: ${endTime}
    Total Minutes Worked: ${totalMinutesWorked}
    Expected Shift: ${expectedShiftMinutes} minutes (${(expectedShiftMinutes / 60).toFixed(1)} hours)
    Percentage Completed: ${percentageCompleted.toFixed(1)}%
  `);

  // ✅ NEW LOGIC: Determine status based on percentage of shift
  // 1. Less than 30 minutes - Absent
  if (totalMinutesWorked < 30) {
    return "Absent";
  }
  
  // 2. Less than shortLeaveThreshold (e.g., 2 hours) - Short Leave
  if (totalMinutesWorked < shortLeaveThresholdMinutes) {
    return "Short Leave";
  }
  
  // 3. 50% or less of shift - Half Leave
  if (percentageCompleted <= 50) {
    return "Half Leave";
  }
  
  // 4. More than 50% of shift - check if Late or Present
  // Check if clocked in after lateTime
  if (clockInMoment.isAfter(moment(lateTime, "HH:mm:ss"))) {
    return "Late";
  }
  
  // 5. More than 50% of shift and not late - Present
  return "Present";
};

// ✅ For Employee - gets ONLY active attendance (status = 'Y')
export const getAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
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

    // Only get active attendance (status = 'Y')
    const [rows]: any = await pool.query(
      `SELECT id, userId, clockIn, clockOut, workingHours, date, attendanceStatus, 
              latitude, longitude, clockInLatitude, clockInLongitude, 
              clockOutLatitude, clockOutLongitude, status 
       FROM attendance 
       WHERE userId = ? AND date = ? AND status = 'Y'`,
      [userId, today],
    );

    // If no active attendance exists - return "Absent" state
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

// ✅ For Admin - gets ALL attendance including deleted (status = 'N')
export const getAttendanceForAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.params.id;
    const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

    const [rows]: any = await pool.query(
      `SELECT id, userId, clockIn, clockOut, workingHours, date, attendanceStatus, 
              latitude, longitude, clockInLatitude, clockInLongitude, 
              clockOutLatitude, clockOutLongitude, status 
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

export const markAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.params.id;
    const { latitude, longitude } = req.body;

    // VALIDATION 1: Check if location is provided
    if (!latitude || !longitude) {
      res.status(400).json({ 
        message: "Location is required. Please enable GPS and allow location access.",
        code: "LOCATION_REQUIRED"
      });
      return;
    }

    const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
    const currentTime = moment.tz("Asia/Karachi").format("HH:mm:ss");

    // VALIDATION 2: Check if user is on leave
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

    // VALIDATION 3: Check if today is a holiday
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

    // VALIDATION 4: Get attendance rules
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
      allowedRadius,
      shortLeaveThreshold = 120 // Default 2 hours (120 minutes)
    } = rules[0];

    const todayDayName = moment.tz("Asia/Karachi").format("dddd");

    if (offDay && todayDayName.toLowerCase() === offDay.toLowerCase()) {
      res.status(400).json({
        message: `${offDay} is configured as Off Day. Attendance cannot be marked.`,
      });
      return;
    }

    // VALIDATION 5: Check if user is within allowed radius of office
    if (officeLatitude && officeLongitude) {
      const distance = calculateDistance(
        latitude, 
        longitude, 
        officeLatitude, 
        officeLongitude
      );
      
      const maxDistance = allowedRadius || 100; // Default 100 meters
      
      if (distance > maxDistance) {
        res.status(400).json({
          message: `You are ${Math.round(distance)} meters away from the office. You must be within ${maxDistance} meters to mark attendance.`,
          code: "OUT_OF_RANGE",
          distance: Math.round(distance),
          maxDistance: maxDistance
        });
        return;
      }
    }

    // Check if attendance already exists (only active records)
    const [rows]: any = await pool.query(
      "SELECT * FROM attendance WHERE userId = ? AND date = ? AND status = 'Y'",
      [userId, today],
    );

    // If no active attendance record exists - CLOCK IN
    if (!rows.length) {
      let attendanceStatus = currentTime <= lateTime ? "Present" : "Late";
      
      await pool.query(
        `INSERT INTO attendance 
         (userId, clockIn, date, attendanceStatus, status, 
          latitude, longitude, clockInLatitude, clockInLongitude) 
         VALUES (?, ?, ?, ?, 'Y', ?, ?, ?, ?)`,
        [
          userId, 
          currentTime, 
          today, 
          attendanceStatus,
          latitude,
          longitude,
          latitude,
          longitude
        ],
      );
      
      res
        .status(200)
        .json({ 
          message: `Clock In successful as ${attendanceStatus}`,
          locationVerified: true
        });
      return;
    }

    // If attendance exists - CLOCK OUT
    const record = rows[0];
    
    // VALIDATION 6: Check if already clocked out
    if (record.clockOut) {
      res.status(400).json({ 
        message: "You have already clocked out for today." 
      });
      return;
    }

    // VALIDATION 7: Minimum time check - Prevent clocking out immediately
    const clockInMoment = moment(record.clockIn, "HH:mm:ss");
    const clockOutMoment = moment(currentTime, "HH:mm:ss");
    const durationMinutes = clockOutMoment.diff(clockInMoment, "minutes");

    // If less than 2 minutes, treat as double-click and prevent clock out
    if (durationMinutes < 2) {
      res.status(400).json({ 
        message: "You just clocked in. Please wait at least 2 minutes before clocking out. This prevents accidental double-clicks.",
        code: "MINIMUM_TIME_NOT_MET"
      });
      return;
    }

    // Calculate working hours
    const durationMilliseconds = clockOutMoment.diff(clockInMoment);
    const diff = moment.utc(durationMilliseconds).format("HH:mm:ss");

    // ✅ NEW: Determine final attendance status using dynamic shift hours
    const finalStatus = determineAttendanceStatus(
      record.clockIn,
      currentTime,
      startTime,      // From attendance_rules
      endTime,        // From attendance_rules
      lateTime,
      halfLeave,
      shortLeaveThreshold,
      record.attendanceStatus
    );

    console.log(`✅ Final Status: ${finalStatus} (Worked ${durationMinutes} minutes, ${((durationMinutes / moment(endTime, "HH:mm:ss").diff(moment(startTime, "HH:mm:ss"), "minutes")) * 100).toFixed(1)}% of shift)`);

    // Update attendance with clock out and new status
    await pool.query(
      `UPDATE attendance 
       SET clockOut = ?, 
           workingHours = ?, 
           attendanceStatus = ?,
           clockOutLatitude = ?,
           clockOutLongitude = ?
       WHERE id = ?`,
      [
        currentTime, 
        diff, 
        finalStatus,
        latitude,
        longitude,
        record.id
      ],
    );

    res.status(200).json({
      message: "Clock Out successful",
      status: finalStatus,
      duration: `${durationMinutes} mins`,
      locationVerified: true
    });
  } catch (error) {
    console.error("Mark Attendance Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error" });
    }
  }
};