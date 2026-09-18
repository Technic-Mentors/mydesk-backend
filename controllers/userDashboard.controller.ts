import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket } from "mysql2";
import moment from "moment-timezone";

const toYMD = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

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
    const nowTimeStr = moment.tz("Asia/Karachi").format("HH:mm:ss");
    const isPastLateThreshold = nowTimeStr >= lateTime;

    // ============================================================
    // 1️⃣ ATTENDANCE — current month till today
    // ============================================================
    const [attendanceRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT
        DATE_FORMAT(date, '%Y-%m-%d') AS d,
        attendanceStatus
      FROM attendance
      WHERE userId = ?
        AND status = 'Y'
        AND MONTH(date) = MONTH(CURRENT_DATE())
        AND YEAR(date) = YEAR(CURRENT_DATE())
        AND DATE(date) <= CURRENT_DATE()
      ORDER BY id ASC
      `,
      [userId]
    );

    // ✅ Dedupe: same date par multiple rows (short leave cycles) ko
    // ek priority-based final status do.
    // Priority: Present > Late > Short Leave > Half Leave > Leave > Absent
    const statusPriority = [
      "present",
      "late",
      "short leave",
      "half leave",
      "leave",
      "absent",
    ];

    const dailyStatus = new Map<string, string>();
    attendanceRows.forEach((row) => {
      const dateKey = row.d;
      const s = (row.attendanceStatus || "").toLowerCase().trim();
      if (!s) return;

      const existing = dailyStatus.get(dateKey);
      if (!existing) {
        dailyStatus.set(dateKey, s);
      } else {
        const existingIdx = statusPriority.indexOf(existing);
        const newIdx = statusPriority.indexOf(s);
        if (newIdx !== -1 && (existingIdx === -1 || newIdx < existingIdx)) {
          dailyStatus.set(dateKey, s);
        }
      }
    });

    // ============================================================
    // 2️⃣ APPROVED LEAVES — PEHLE fetch karo (counters ko chahiye)
    // ============================================================
    const [leaveRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT fromDate, toDate, leaveType
      FROM leaves
      WHERE userId = ?
        AND status = 'Y'
        AND LOWER(leaveStatus) = 'approved'
        AND fromDate <= LAST_DAY(CURRENT_DATE())
        AND toDate >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')
      `,
      [userId]
    );

    const leaveRanges = leaveRows.map((l) => ({
      from: toYMD(new Date(l.fromDate)),
      to: toYMD(new Date(l.toDate)),
    }));

    const isOnApprovedLeave = (dayStr: string) =>
      leaveRanges.some((r) => dayStr >= r.from && dayStr <= r.to);

    // ============================================================
    // 3️⃣ ATTENDANCE COUNTERS (ab isOnApprovedLeave available hai)
    // ============================================================
    let presents = 0;
    let lateCount = 0;
    let explicitAbsents = 0;
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
          explicitAbsents++;
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
      SELECT fromDate, toDate
      FROM holidays
      WHERE holidayStatus = 'Y'
        AND fromDate <= LAST_DAY(CURRENT_DATE())
        AND toDate >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')
      `
    );
    const holidayRanges = holidayRangeRows.map((h) => ({
      from: toYMD(new Date(h.fromDate)),
      to: toYMD(new Date(h.toDate)),
    }));
    const isHoliday = (dayStr: string) =>
      holidayRanges.some((h) => dayStr >= h.from && dayStr <= h.to);

    // ============================================================
    // 6️⃣ WORKING DAYS + MISSING DAY ABSENTS
    // ============================================================
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const todayDate = now.getDate();

    let workingDays = 0;
    let missingDayAbsents = 0;

    for (let day = 1; day <= todayDate; day++) {
      const d = new Date(year, month, day);
      const dayName = d.toLocaleDateString("en-US", { weekday: "long" });
      if (offDays.includes(dayName)) continue;

      const dayStr = toYMD(d);
      if (isHoliday(dayStr)) continue;

      workingDays++;

      // 1. Attendance row maujood → skip
      if (dailyStatus.has(dayStr)) continue;

      // 2. Approved leave → skip (absent nahi)
      if (isOnApprovedLeave(dayStr)) continue;

      // 3. Aaj ka din + threshold nahi guzra → pending, absent nahi
      if (dayStr === todayStr && !isPastLateThreshold) continue;

      // 4. Warna: threshold guzar chuka, na attendance, na leave → Absent
      missingDayAbsents++;
    }

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

    const [holidays] = await pool.query<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS holidays
      FROM holidays
      WHERE holidayStatus = 'Y'
        AND fromDate <= LAST_DAY(CURRENT_DATE())
        AND toDate >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')
      `
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
      holidays: holidays[0]?.holidays || 0,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
};