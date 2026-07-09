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

export const getAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.params.id;
    const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");

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

export const markAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.params.id;
    const { latitude, longitude } = req.body;

    // ✅ VALIDATION 1: Check if location is provided
    if (!latitude || !longitude) {
      res.status(400).json({ 
        message: "Location is required. Please enable GPS and allow location access.",
        code: "LOCATION_REQUIRED"
      });
      return;
    }

    const today = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
    const currentTime = moment.tz("Asia/Karachi").format("HH:mm:ss");

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

    const [rules]: any = await pool.query(
      "SELECT * FROM attendance_rules WHERE status = 'Active' LIMIT 1",
    );
    if (!rules.length) {
      res.status(400).json({ message: "Attendance rules not configured" });
      return;
    }
    const { lateTime, halfLeave, offDay, officeLatitude, officeLongitude, allowedRadius } = rules[0];

    const todayDayName = moment.tz("Asia/Karachi").format("dddd");

    if (offDay && todayDayName.toLowerCase() === offDay.toLowerCase()) {
      res.status(400).json({
        message: `${offDay} is configured as Off Day. Attendance cannot be marked.`,
      });
      return;
    }

    // ✅ VALIDATION 2: Check if user is within allowed radius of office
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

    const [rows]: any = await pool.query(
      "SELECT * FROM attendance WHERE userId = ? AND date = ?",
      [userId, today],
    );

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

    const record = rows[0];
    if (record.clockOut) {
      res.status(400).json({ message: "Already clocked out" });
      return;
    }

    const clockInMoment = moment(record.clockIn, "HH:mm:ss");
    const clockOutMoment = moment(currentTime, "HH:mm:ss");

    const durationMinutes = clockOutMoment.diff(clockInMoment, "minutes");

    const durationMilliseconds = clockOutMoment.diff(clockInMoment);
    const diff = moment.utc(durationMilliseconds).format("HH:mm:ss");

    let finalStatus = record.attendanceStatus;

    if (durationMinutes < 1) {
      finalStatus = "Absent";
    } else if (durationMinutes <= 120) {
      finalStatus = "Short Leave";
    } else if (currentTime < halfLeave) {
      if (
        record.attendanceStatus !== "Late" &&
        record.attendanceStatus !== "Short Leave"
      ) {
        finalStatus = "Present";
      }
    }

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