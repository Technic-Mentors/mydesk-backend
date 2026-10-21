import { Request, Response } from "express";
import pool from "../database/db";
import { ResultSetHeader } from "mysql2";

const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthIndex = (value: unknown) => months.findIndex(m => m.toLowerCase() === String(value || "").trim().toLowerCase());
const validYear = (value: unknown) => Number.isInteger(Number(value)) && Number(value) >= 1900 && Number(value) <= 9999;

export const getAllCalendarSessions = async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      "SELECT cs.*, CASE WHEN EXISTS (SELECT 1 FROM salarycycle sc WHERE sc.calendar_session_id = cs.id) " +
      "THEN 'Processed' WHEN cs.calendarStatus = 'Active' THEN 'Ready' ELSE 'Not Run' END AS salaryCycleStatus " +
      "FROM calendarsession cs ORDER BY cs.year, FIELD(cs.month, 'January','February','March','April','May','June'," +
      "'July','August','September','October','November','December'), cs.id");
    res.json(rows);
  } catch (error) {
    console.error(error); res.status(500).json({ message: "Error fetching calendar sessions" });
  }
};

export const addCalendarSession = async (req: Request, res: Response): Promise<void> => {
  const { session_name, year, month } = req.body;
  const name = String(session_name || "").trim();
  const startIndex = monthIndex(month);
  if (!name || !validYear(year) || startIndex < 0) {
    res.status(400).json({ message: "Valid session name, year, and month are required" }); return;
  }
  const rows = Array.from({ length: 12 }, (_, i) => {
    const index = startIndex + i;
    return [name, Number(year) + Math.floor(index / 12), months[index % 12], "InActive"];
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing]: any = await connection.query(
      "SELECT id FROM calendarsession WHERE LOWER(TRIM(session_name)) = LOWER(?) LIMIT 1 FOR UPDATE", [name]);
    if (existing.length) {
      await connection.rollback();
      res.status(409).json({ message: "Calendar session name already exists" }); return;
    }
    for (const row of rows) {
      const [duplicate]: any = await connection.query(
        "SELECT id FROM calendarsession WHERE year = ? AND LOWER(month) = LOWER(?) LIMIT 1 FOR UPDATE",
        [row[1], row[2]]);
      if (duplicate.length) {
        await connection.rollback();
        res.status(409).json({ message: "A calendar month already exists for " + row[2] + " " + row[1] }); return;
      }
    }
    await connection.query(
      "INSERT INTO calendarsession (session_name, year, month, calendarStatus) VALUES ?", [rows]);
    await connection.commit();
    res.status(201).json({ message: "Calendar session added successfully", insertedCount: 12 });
  } catch (error) {
    await connection.rollback(); console.error(error);
    res.status((error as { code?: string }).code === "ER_DUP_ENTRY" ? 409 : 500)
      .json({ message: (error as { code?: string }).code === "ER_DUP_ENTRY" ? "Calendar session or month already exists" : "Error adding calendar session" });
  } finally { connection.release(); }
};

export const activateCalendarSession = async (req: Request, res: Response): Promise<void> => {
  const { session_name, year, month } = req.body;
  const name = String(session_name || "").trim();
  const index = monthIndex(month);
  if (!name || !validYear(year) || index < 0) {
    res.status(400).json({ message: "Valid session, year, and month are required" }); return;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [selected]: any = await connection.query(
      "SELECT cs.id, cs.calendarStatus, sc.id AS cycle_id FROM calendarsession cs " +
      "LEFT JOIN salarycycle sc ON sc.calendar_session_id = cs.id " +
      "WHERE LOWER(TRIM(cs.session_name)) = LOWER(?) AND cs.year = ? AND LOWER(cs.month) = LOWER(?) FOR UPDATE",
      [name, Number(year), months[index]]);
    if (selected.length !== 1) {
      await connection.rollback(); res.status(404).json({ message: "Calendar month not found or duplicated" }); return;
    }
    if (selected[0].cycle_id || selected[0].calendarStatus === "Processing") {
      await connection.rollback(); res.status(409).json({ message: "Processed months cannot be activated again" }); return;
    }
    await connection.query(
      "UPDATE calendarsession SET calendarStatus = 'InActive' WHERE calendarStatus = 'Active' AND id <> ?",
      [selected[0].id]);
    await connection.query("UPDATE calendarsession SET calendarStatus = 'Active' WHERE id = ?", [selected[0].id]);
    const [updated]: any = await connection.query(
      "SELECT * FROM calendarsession WHERE LOWER(TRIM(session_name)) = LOWER(?)", [name]);
    await connection.commit();
    res.json({ message: "Calendar month activated", data: updated });
  } catch (error) {
    await connection.rollback(); console.error(error);
    res.status(500).json({ message: "Error activating calendar month" });
  } finally { connection.release(); }
};

export const updateCalendarSession = async (req: Request, res: Response): Promise<void> => {
  const { session_name, year, month } = req.body;
  const name = String(session_name || "").trim();
  const startIndex = monthIndex(month);
  if (!name || !validYear(year) || startIndex < 0) {
    res.status(400).json({ message: "Valid session name, year, and starting month are required" }); return;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [selected]: any = await connection.query(
      "SELECT session_name FROM calendarsession WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!selected.length) {
      await connection.rollback(); res.status(404).json({ message: "Session not found" }); return;
    }
    const oldName = selected[0].session_name;
    const [records]: any = await connection.query(
      "SELECT id, calendarStatus FROM calendarsession WHERE session_name = ? ORDER BY id FOR UPDATE", [oldName]);
    const [processed]: any = await connection.query(
      "SELECT sc.id FROM salarycycle sc JOIN calendarsession cs ON cs.id = sc.calendar_session_id " +
      "WHERE cs.session_name = ? LIMIT 1", [oldName]);
    if (records.length !== 12 || processed.length || records.some((r: any) => r.calendarStatus !== "InActive")) {
      await connection.rollback();
      res.status(409).json({ message: "Only complete, inactive, unprocessed sessions can be edited" }); return;
    }
    const [sameName]: any = await connection.query(
      "SELECT id FROM calendarsession WHERE LOWER(TRIM(session_name)) = LOWER(?) AND session_name <> ? LIMIT 1",
      [name, oldName]);
    if (sameName.length) {
      await connection.rollback(); res.status(409).json({ message: "Session name already exists" }); return;
    }
    const generated = Array.from({ length: 12 }, (_, i) => {
      const index = startIndex + i;
      return { year: Number(year) + Math.floor(index / 12), month: months[index % 12] };
    });
    for (const target of generated) {
      const [duplicate]: any = await connection.query(
        "SELECT id FROM calendarsession WHERE session_name <> ? AND year = ? AND LOWER(month) = LOWER(?) LIMIT 1 FOR UPDATE",
        [oldName, target.year, target.month]);
      if (duplicate.length) {
        await connection.rollback();
        res.status(409).json({ message: "Calendar month already exists for " + target.month + " " + target.year }); return;
      }
    }
    for (let i = 0; i < records.length; i++) {
      await connection.query(
        "UPDATE calendarsession SET session_name = ?, year = ?, month = ? WHERE id = ?",
        [name, generated[i].year, generated[i].month, records[i].id]);
    }
    await connection.commit();
    res.json({ message: "Calendar session updated", updatedCount: 12 });
  } catch (error) {
    await connection.rollback(); console.error(error);
    res.status((error as { code?: string }).code === "ER_DUP_ENTRY" ? 409 : 500)
      .json({ message: (error as { code?: string }).code === "ER_DUP_ENTRY" ? "Calendar month already exists" : "Error updating calendar session" });
  } finally { connection.release(); }
};
export const deleteCalendarSession = async (req: Request, res: Response): Promise<void> => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.query(
      "SELECT session_name FROM calendarsession WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!rows.length) {
      await connection.rollback(); res.status(404).json({ message: "Session not found" }); return;
    }
    const name = rows[0].session_name;
    const [months]: any = await connection.query(
      "SELECT id, calendarStatus FROM calendarsession WHERE session_name = ? FOR UPDATE", [name]);
    if (months.some((item: any) => item.calendarStatus !== "InActive")) {
      await connection.rollback();
      res.status(409).json({ message: "Only inactive, unprocessed sessions can be deleted" }); return;
    }
    const [inUse]: any = await connection.query(
      "SELECT id FROM salarycycle WHERE calendar_session_id IN " +
      "(SELECT id FROM calendarsession WHERE session_name = ?) LIMIT 1 FOR UPDATE", [name]);
    if (inUse.length) {
      await connection.rollback();
      res.status(409).json({ message: "A processed calendar session cannot be deleted" }); return;
    }
    const [result] = await connection.query<ResultSetHeader>(
      "DELETE FROM calendarsession WHERE session_name = ?", [name]);
    await connection.commit();
    res.json({ message: "Calendar session deleted", deletedCount: result.affectedRows });
  } catch (error) {
    await connection.rollback(); console.error(error);
    res.status(500).json({ message: "Error deleting calendar session" });
  } finally { connection.release(); }
};
