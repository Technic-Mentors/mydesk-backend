import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

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
    if (!userId) res.status(401).json({ message: "Unauthorized" });

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
      `,
      [userId]
    );

    const attendanceByDate = new Map<string, string>();
    let presents = 0;
    let explicitAbsents = 0;
    let shortLeave = 0;
    let halfLeave = 0;
    attendanceRows.forEach((row) => {
      attendanceByDate.set(row.d, row.attendanceStatus);
      const s = (row.attendanceStatus || "").toLowerCase();
      if (s === "present") presents++;
      else if (s === "absent") explicitAbsents++;
      else if (s === "short leave") shortLeave++;
      else if (s === "half leave") halfLeave++;
    });

    // Approved leaves overlapping this month — a day covered by an approved
    // leave is not "missing", so it shouldn't be counted as absent.
    const [leaveRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT fromDate, toDate
      FROM leaves
      WHERE userId = ?
        AND status = 'Y'
        AND leaveStatus = 'Approved'
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

    // Working Days = calendar days from the 1st of the month to today,
    // excluding the active weekly off-day(s) and any declared holidays.
    const [ruleRows] = await pool.query<RowDataPacket[]>(
      `SELECT offDay FROM attendance_rules WHERE status = 'Active' LIMIT 1`
    );
    const offDays: string[] = (ruleRows[0]?.offDay || "")
      .split(",")
      .map((d: string) => d.trim())
      .filter(Boolean);

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

      // No attendance marked and no approved leave covering this working day.
      if (!attendanceByDate.has(dayStr) && !isOnApprovedLeave(dayStr)) {
        missingDayAbsents++;
      }
    }

    const absents = explicitAbsents + missingDayAbsents;

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
        AND (
          (MONTH(fromDate) = MONTH(CURRENT_DATE()) AND YEAR(fromDate) = YEAR(CURRENT_DATE()))
          OR
          (MONTH(toDate) = MONTH(CURRENT_DATE()) AND YEAR(toDate) = YEAR(CURRENT_DATE()))
        )
      `
    );

    res.json({
      workingDays,
      presents,
      absents,
      shortLeave,
      halfLeave,
      totalTodos: todos[0].totalTodos || 0,
      totalProgress: progress[0].totalProgress || 0,
      holidays: holidays[0]?.holidays || 0,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
};
