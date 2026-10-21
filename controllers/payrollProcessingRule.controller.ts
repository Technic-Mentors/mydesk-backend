import { Request, Response } from "express";
import pool from "../database/db";
import { payrollToday, readPayrollProcessingRule, PayrollProcessingMode } from "../services/payrollProcessingRule";

export const getPayrollProcessingRule = async (_req: Request, res: Response): Promise<void> => {
  try {
    const connection = await pool.getConnection();
    try {
      const rule = await readPayrollProcessingRule(connection);
      res.json({ ...rule, today: payrollToday() });
    } finally { connection.release(); }
  } catch (error) {
    console.error("Could not load payroll processing rule:", error);
    res.status(500).json({ message: "Could not load payroll processing rule" });
  }
};

export const updatePayrollProcessingRule = async (req: Request, res: Response): Promise<void> => {
  const mode = req.body?.mode as PayrollProcessingMode;
  const cutoffDay = Number(req.body?.cutoffDay);
  if ((mode !== "AFTER_MONTH_END" && mode !== "AFTER_CUTOFF") || !Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 31) {
    res.status(400).json({ message: "Select a processing rule and a cutoff day from 1 to 31" }); return;
  }
  try {
    await pool.query(
      "INSERT INTO payroll_processing_settings (id,rule_mode,cutoff_day) VALUES (1,?,?) " +
      "ON DUPLICATE KEY UPDATE rule_mode=VALUES(rule_mode),cutoff_day=VALUES(cutoff_day)",
      [mode, cutoffDay]);
    res.json({ mode, cutoffDay, today: payrollToday() });
  } catch (error) {
    console.error("Could not save payroll processing rule:", error);
    res.status(500).json({ message: "Could not save payroll processing rule" });
  }
};
