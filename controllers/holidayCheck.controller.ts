import { Request, Response } from "express";
import pool from "../database/db";
import moment from "moment-timezone";

export const checkHoliday = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { date } = req.query;

    if (!date) {
      res.status(400).json({ message: "Date is required" });
      return;
    }

    const formattedDate = typeof date === 'string' ? date : date.toString();
    const checkDate = moment.tz(formattedDate, "Asia/Karachi");
    const dayName = checkDate.format("dddd");

    // ✅ Check if date is a holiday in holidays table
    const [holidayRows]: any = await pool.query(
      `SELECT holiday FROM holidays 
       WHERE ? BETWEEN fromDate AND toDate AND holidayStatus = 'Y' LIMIT 1`,
      [formattedDate],
    );

    if (holidayRows.length > 0) {
      res.status(200).json({
        isHoliday: true,
        message: `This date is a Holiday: ${holidayRows[0].holiday}`,
      });
      return;
    }

    // ✅ Check if date is a weekly off day
    const [rules]: any = await pool.query(
      "SELECT offDay FROM attendance_rules WHERE status = 'Active' LIMIT 1",
    );

    if (rules.length > 0) {
      const offDays = rules[0].offDay.split(',').map((day: string) => day.trim().toLowerCase());
      
      if (offDays.includes(dayName.toLowerCase())) {
        res.status(200).json({
          isHoliday: true,
          message: `${dayName} is configured as a Weekly Off Day`,
        });
        return;
      }
    }

    // ✅ Not a holiday
    res.status(200).json({
      isHoliday: false,
      message: "This date is not a holiday",
    });
  } catch (error) {
    console.error("Check Holiday Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};