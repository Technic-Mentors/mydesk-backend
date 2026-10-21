import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/middleware";
import pool from "../database/db";
import { hasPermission, MODULE } from "../permissionModel";

export const getAllAdvanceSalary = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const [rows]: any = await pool.query(
      `SELECT a.id, a.employee_id, e.employee_name, 
              DATE_FORMAT(a.date, '%Y-%m-%d') as date, 
              a.amount, a.approvalStatus, a.description
       FROM advance_salaries a
       JOIN employee_lifeline e ON a.employee_id = e.employee_id
       ORDER BY a.id DESC`,
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching all advance salaries:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

export const getMyAdvanceSalary = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const [rows]: any = await pool.query(
      `SELECT a.id, a.employee_id, e.employee_name, a.date, a.amount, a.approvalStatus, a.description
       FROM advance_salaries a
       JOIN employee_lifeline e ON a.employee_id = e.employee_id
       WHERE a.employee_id = ?
       ORDER BY a.id DESC`,
      [userId],
    );
    res.json(rows);
  } catch (err) {
    console.error(`Error fetching advance salary for user ${userId}:`, err);
    res.status(500).json({ message: "Server Error" });
  }
};

export const createAdvanceSalary = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const { employee_id, date, amount, description } = req.body;

  if (!hasPermission(req.user, MODULE.Payroll) && Number(employee_id) !== req.user?.id) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  if (!employee_id || !date || !amount || !description) {
    res.status(400).json({ message: "All fields are required" });
    return;
  }

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ message: "Amount must be a positive number" });
    return;
  }

  try {
    const [employee]: any = await pool.query(
      `SELECT date FROM employee_lifeline WHERE employee_id = ?`,
      [employee_id],
    );

    if (!employee.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(employee[0].date);
    const requestedDate = new Date(date);

    if (requestedDate < joiningDate) {
      res.status(400).json({
        message: `Cannot add advance salary before the joining date (${joiningDate.toISOString().split("T")[0]})`,
      });
      return;
    }

    await pool.query(
      `INSERT INTO advance_salaries (employee_id, date, amount, description)
       VALUES (?, ?, ?, ?)`,
      [employee_id, date, amount, description],
    );
    res.json({ message: "Advance salary added successfully" });
  } catch (err) {
    console.error("Error creating advance salary:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

export const updateAdvanceSalary = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const { employee_id, date, amount, approvalStatus, description } = req.body;

  if (!employee_id || !date || !amount || !approvalStatus) {
    res.status(400).json({ message: "Required fields missing" });
    return;
  }

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ message: "Amount must be a positive number" });
    return;
  }

  try {
    const [employee]: any = await pool.query(
      `SELECT date FROM employee_lifeline WHERE employee_id = ?`,
      [employee_id],
    );

    if (!employee.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(employee[0].date);
    const requestedDate = new Date(date);

    if (requestedDate < joiningDate) {
      res.status(400).json({
        message: `Cannot update advance salary with date before the joining date (${joiningDate.toISOString().split("T")[0]})`,
      });
      return;
    }

    await pool.query(
      `UPDATE advance_salaries 
       SET employee_id = ?, date = ?, amount = ?, approvalStatus = ?, description = ? 
       WHERE id = ?`,
      [employee_id, date, amount, approvalStatus, description, id],
    );
    res.json({ message: "Advance salary updated successfully" });
  } catch (err) {
    console.error(`Error updating advance salary id ${id}:`, err);
    res.status(500).json({ message: "Server Error" });
  }
};

export const deleteAdvanceSalary = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  try {
    await pool.query(`DELETE FROM advance_salaries WHERE id = ?`, [id]);
    res.json({ message: "Advance salary deleted successfully" });
  } catch (err) {
    console.error(`Error deleting advance salary id ${id}:`, err);
    res.status(500).json({ message: "Server Error" });
  }
};
