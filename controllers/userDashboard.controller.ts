import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket } from "mysql2";
import moment from "moment-timezone";
import { attendanceStartDate, countAttendanceWindow } from "../utils/attendanceEligibility";
import { isRecordedAttendanceOverride, normalizeAttendanceStatus } from "../utils/attendanceStatus";

export const getUserDashboard = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return; // ✅ FIX: return missing tha
    }

    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(COALESCE(date, created_at), '%Y-%m-%d') AS joiningDate
       FROM tbl_users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!userRows.length || !userRows[0].joiningDate) {
      res.status(404).json({ message: "Employee joining date not found" });
      return;
    }

    // ============================================================
    // 0️⃣ ACTIVE RULE (lateTime + offDay)
    // ============================================================
    const [ruleRows] = await pool.query<RowDataPacket[]>(
      `SELECT offDay, lateTime FROM attendance_rules WHERE status = 'Active' LIMIT 1`
    );
    const offDays: string[] = (ruleRows[0]?.offDay || "")
      .split(",")
      .map((d: string) => d.trim())
      .filter(Boolean);
    const lateTime: string = ruleRows[0]?.lateTime || "23:59:59";

    // Aaj (Asia/Karachi) — markAttendance bhi isi timezone mein save karta hai
    const todayStr = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
    const monthStart = moment.tz("Asia/Karachi").startOf("month").format("YYYY-MM-DD");
    const startDate = attendanceStartDate(monthStart, userRows[0].joiningDate);
    const nowTimeStr = moment.tz("Asia/Karachi").format("HH:mm:ss");
    const isPastLateThreshold = nowTimeStr >= lateTime;

    // ============================================================
    // 1️⃣ ATTENDANCE — current month till today
    // ============================================================
    const [attendanceRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT
        DATE_FORMAT(date, '%Y-%m-%d') AS d,
        attendanceStatus, type, remoteStatus
      FROM attendance
      WHERE userId = ?
        AND status = 'Y'
        AND DATE(date) >= ?
        AND DATE(date) <= ?
      ORDER BY id ASC
      `,
      [userId, startDate, todayStr]
    );

    // ✅ Dedupe: same date par multiple rows (short leave cycles) ko
    // ek priority-based final status do.
    const dailyStatus = new Map<string, string>();
    attendanceRows.forEach((row) => {
      const status = normalizeAttendanceStatus(row.attendanceStatus);
      const existing = dailyStatus.get(row.d);
      if (status && (isRecordedAttendanceOverride(status) || !isRecordedAttendanceOverride(existing))) {
        dailyStatus.set(row.d, status);
      }
    });

    // ============================================================
    // 2️⃣ APPROVED LEAVES — PEHLE fetch karo (counters ko chahiye)
    // ============================================================
    const [leaveRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT DATE_FORMAT(fromDate, '%Y-%m-%d') AS fromDate,
             DATE_FORMAT(toDate, '%Y-%m-%d') AS toDate, leaveType
      FROM leaves
      WHERE userId = ?
        AND status = 'Y'
        AND LOWER(leaveStatus) = 'approved'
        AND fromDate <= ?
        AND toDate >= ?
        AND ? <= ?
      `,
      [userId, todayStr, startDate, startDate, todayStr]
    );

    const leaveRanges = leaveRows.map((l) => ({
      from: l.fromDate as string,
      to: l.toDate as string,
    }));

    const isOnApprovedLeave = (dayStr: string) =>
      !isRecordedAttendanceOverride(dailyStatus.get(dayStr)) &&
      leaveRanges.some((r) => dayStr >= r.from && dayStr <= r.to);

    const [remoteRows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(remoteFromDate, '%Y-%m-%d') AS fromDate,
              DATE_FORMAT(remoteToDate, '%Y-%m-%d') AS toDate
       FROM attendance
       WHERE userId = ? AND status = 'Y'
         AND LOWER(type) = 'remote' AND LOWER(remoteStatus) = 'approved'
         AND remoteFromDate <= ? AND remoteToDate >= ?`,
      [userId, todayStr, startDate]
    );
    const remoteRanges = remoteRows.map((r) => ({ from: r.fromDate as string, to: r.toDate as string }));
    const isApprovedRemote = (dayStr: string) =>
      remoteRanges.some((r) => dayStr >= r.from && dayStr <= r.to);

    // ============================================================
    // 3️⃣ ATTENDANCE COUNTERS (ab isOnApprovedLeave available hai)
    // ============================================================
    let presents = 0;
    let lateCount = 0;
    const explicitAbsentDates: string[] = [];
    let shortLeave = 0;
    let halfLeave = 0;
    let attendanceLeaveDays = 0;

    dailyStatus.forEach((s, dayStr) => {
      if (s === "present") {
        presents++;
      } else if (s === "late") {
        presents++; // ✅ Late bhi present hai
        lateCount++; // ✅ Alag se track
      } else if (s === "absent") {
        // ✅ FIX: agar us din approved leave hai to absent count NA karo
        // (leave already leaves table se count ho rahi hai)
        if (!isOnApprovedLeave(dayStr)) {
          explicitAbsentDates.push(dayStr);
        }
      } else if (s === "short leave") {
        shortLeave++;
      } else if (s === "half leave") {
        halfLeave++;
      } else if (s === "leave") {
        attendanceLeaveDays++; // kisi bucket mein nahi
      }
    });

    // ============================================================
    // 4️⃣ TYPE-WISE LEAVE COUNTERS
    // ============================================================
    let leaveShortCount = 0;
    let leaveHalfCount = 0;
    let leaveFullCount = 0;

    leaveRows.forEach((l) => {
      const type = (l.leaveType || "").toUpperCase().trim();
      if (type === "SHORT LEAVE") leaveShortCount++;
      else if (type === "HALF DAY") leaveHalfCount++;
      else leaveFullCount++; // FULL DAY, CASUAL, SICK, ANNUAL, FAMILY RESPONSIBILITY
    });

    const totalApprovedLeaves = leaveRows.length;

    // ============================================================
    // 5️⃣ HOLIDAYS — this month (range-overlap query)
    // ============================================================
    const [holidayRangeRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT DATE_FORMAT(fromDate, '%Y-%m-%d') AS fromDate,
             DATE_FORMAT(toDate, '%Y-%m-%d') AS toDate
      FROM holidays
      WHERE holidayStatus = 'Y'
        AND fromDate <= ?
        AND toDate >= ?
        AND ? <= ?
      `,
      [todayStr, startDate, startDate, todayStr]
    );
    const holidayRanges = holidayRangeRows.map((h) => ({
      from: h.fromDate as string,
      to: h.toDate as string,
    }));
    const isHoliday = (dayStr: string) =>
      holidayRanges.some((h) => dayStr >= h.from && dayStr <= h.to);

    const explicitAbsents = explicitAbsentDates.filter((dayStr) => {
      const dayName = moment.tz(dayStr, "YYYY-MM-DD", "Asia/Karachi").format("dddd");
      return !offDays.includes(dayName) && !isHoliday(dayStr) &&
        (dayStr !== todayStr || isPastLateThreshold);
    }).length;

    // ============================================================
    // 6️⃣ WORKING DAYS + MISSING DAY ABSENTS
    // ============================================================
    const { workingDays, missingDayAbsents, approvedRemoteDays } = countAttendanceWindow({
      monthStart,
      today: todayStr,
      joiningDate: userRows[0].joiningDate,
      offDays,
      isHoliday,
      attendanceStatus: (day) => dailyStatus.get(day),
      isOnApprovedLeave,
      isApprovedRemote,
      isPastLateThreshold,
    });

    presents += approvedRemoteDays;
    const absents = explicitAbsents + missingDayAbsents;

    // ============================================================
    // 7️⃣ TODO / PROGRESS / HOLIDAY COUNT
    // ============================================================
    const [todos] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS totalTodos FROM todo WHERE employee_id = ? AND todoStatus != 'N'`,
      [userId]
    );

    const [progress] = await pool.query<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS totalProgress
      FROM progress
      WHERE employee_id = ?
        AND progressStatus = 'Y'
        AND MONTH(date) = MONTH(CURRENT_DATE())
        AND YEAR(date) = YEAR(CURRENT_DATE())
        AND DATE(date) <= CURRENT_DATE()
      `,
      [userId]
    );
    const [progressTrend] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, COUNT(*) AS count
       FROM progress
       WHERE employee_id = ? AND progressStatus = 'Y'
         AND DATE(date) BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(date, '%Y-%m-%d')
       ORDER BY DATE_FORMAT(date, '%Y-%m-%d')`,
      [userId, moment.tz("Asia/Karachi").subtract(6, "days").format("YYYY-MM-DD"), todayStr]
    );

    const [holidays] = await pool.query<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS holidays
      FROM holidays
      WHERE holidayStatus = 'Y'
        AND fromDate <= ?
        AND toDate >= ?
        AND ? <= ?
      `,
      [todayStr, startDate, startDate, todayStr]
    );

    // ============================================================
    // 8️⃣ RESPONSE
    // ============================================================
    res.json({
      workingDays,
      presents, // Late included
      late: lateCount, // alag se
      absents, // explicit + missing (leaves excluded)
      shortLeave,
      halfLeave,

      leaves: {
        // type-wise
        total: totalApprovedLeaves,
        short: leaveShortCount,
        half: leaveHalfCount,
        full: leaveFullCount,
      },

      totalTodos: todos[0].totalTodos || 0,
      totalProgress: progress[0].totalProgress || 0,
      progressTrend,
      holidays: holidays[0]?.holidays || 0,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
};
