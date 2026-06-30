import { Request, Response } from "express";
import pool from "../database/db";
import { ResultSetHeader } from "mysql2";

export const getAllCalendarSessions = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        cs.*,
        CASE 
          WHEN sc.id IS NOT NULL THEN 'Processing'  -- Changed from 'Processed'
          WHEN cs.calendarStatus = 'Active' THEN 'Ready'
          ELSE 'Not Run'
        END as salaryCycleStatus
      FROM calendarsession cs
      LEFT JOIN salarycycle sc ON sc.calendar_session_id = cs.id
      ORDER BY cs.id ASC
    `);
    res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching calendar sessions" });
  }
};

export const addCalendarSession = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { session_name, year, month } = req.body;

    if (!session_name || !year || !month) {
      res.status(400).json({
        message: "Session name, year, and month are required",
      });
      return;
    }

    const startMonthIndex = new Date(`${month} 1, ${year}`).getMonth();
    const startYear = parseInt(year);

    const sessionsToInsert: any[] = [];

    for (let i = 0; i < 12; i++) {
      const targetDate = new Date(startYear, startMonthIndex + i, 1);

      const targetMonthName = targetDate.toLocaleString("default", {
        month: "long",
      });

      const targetYearNum = targetDate.getFullYear();

      sessionsToInsert.push([
        session_name,
        targetYearNum.toString(),
        targetMonthName,
        "InActive",
      ]);
    }

    await pool.query(
      "INSERT INTO calendarsession (session_name, year, month, calendarStatus) VALUES ?",
      [sessionsToInsert],
    );

    res.status(201).json({
      message: "Calendar session added successfully",
      insertedCount: sessionsToInsert.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding calendar session" });
  }
};

export const updateCalendarSession = async (req: Request, res: Response) => {
  try {
    const { session_name, year, month } = req.body;
    const { id } = req.params;

    if (!session_name || !year || !month) {
      res
        .status(400)
        .json({ message: "Session name, year, and month are required" });
      return;
    }

    const [result] = await pool.query(
      "UPDATE calendarsession SET session_name = ?, year = ?, month = ? WHERE id = ?",
      [session_name, year, month, id],
    );

    res.status(200).json({ message: "Calendar session updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating calendar session" });
  }
};

export const activateCalendarSession = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { session_name, year, month } = req.body;

    //  REMOVED: Current month/year restriction
    // Now any month can be activated

    //  Validate that the session exists for the given month/year
    const [sessionExists]: any = await pool.query(
      `SELECT id FROM calendarsession 
       WHERE LOWER(session_name) = LOWER(?) 
       AND year = ? 
       AND LOWER(month) = LOWER(?)`,
      [session_name, parseInt(year), month]
    );

    if (sessionExists.length === 0) {
      res.status(400).json({
        message: `Calendar session not found for ${month} ${year}`,
      });
      return;
    }

    //  Deactivate all other sessions for this session_name (except 'Processing')
    await pool.query(
      `UPDATE calendarsession 
       SET calendarStatus = 'InActive' 
       WHERE LOWER(session_name) = LOWER(?) 
       AND calendarStatus NOT IN ('Processing')`,
      [session_name],
    );

    //  Activate the selected month
    await pool.query(
      `UPDATE calendarsession
       SET calendarStatus = 'Active'
       WHERE LOWER(TRIM(session_name)) = LOWER(?)
       AND year = ?
       AND LOWER(TRIM(month)) = LOWER(?)`,
      [session_name.trim(), parseInt(year), month.trim()],
    );

    //  Return all rows for that session so frontend shows correct status
    const [updatedRows]: any = await pool.query(
      `SELECT * FROM calendarsession WHERE LOWER(session_name) = LOWER(?)`,
      [session_name],
    );

    res.status(200).json({
      message: `Session activated successfully for ${month} ${year}`,
      data: updatedRows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error activating session" });
  }
};

export const deleteCalendarSession = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows]: any = await pool.query(
      "SELECT session_name FROM calendarsession WHERE id = ?",
      [id],
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Session not found" });
      return;
    }

    const session_name = rows[0].session_name;

    const [result] = await pool.query<ResultSetHeader>(
      "DELETE FROM calendarsession WHERE session_name = ?",
      [session_name],
    );

    res.status(200).json({
      message: "Calendar session deleted",
      deletedCount: result.affectedRows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting calendar session" });
  }
};
