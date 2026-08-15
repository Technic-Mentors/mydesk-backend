import { Request, Response } from "express";
import pool from "../database/db";

export const withdrawEmployee = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = req.params.id;
    const { withdrawReason } = req.body;

    console.log("Withdraw Request Received:", { id, withdrawReason });

    if (!withdrawReason) {
      res.status(400).json({ message: "Provide all required fields!" });
      return;
    }

    const [existingWithdrawal]: any = await pool.query(
      "SELECT * FROM withdrawals WHERE employee_id = ? AND withdrawStatus = 'Y'",
      [id],
    );

    if (existingWithdrawal.length > 0) {
      res.status(409).json({ message: "Employee is currently withdrawn!" });
      return;
    }

    const insertQuery = `
      INSERT INTO withdrawals (employee_id, withdrawDate, withdrawReason, withdrawStatus)
      VALUES (?, CURRENT_DATE, ?, 'Y')
    `;
    await pool.query(insertQuery, [id, withdrawReason]);

    // ✅ Updated to update both fields
    const updateQuery = `
      UPDATE tbl_users 
      SET 
        loginStatus = 'N',
        status = 'Inactive'
      WHERE id = ?
    `;
    await pool.query(updateQuery, [id]);

    res.status(201).json({
      status: 201,
      message: "Employee withdrawn successfully",
    });
  } catch (error) {
    console.error("Error withdrawing employee:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getWithdrawnEmployees = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    let { page = 1, limit = 10 } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      res.status(400).json({ message: "Invalid pagination values" });
      return;
    }

    const offset = (pageNum - 1) * limitNum;

    const [rows] = await pool.query(
      `
      SELECT 
        w.id AS withdrawalId,
        w.employee_id AS employeeId,
        w.withdrawReason,
        w.withdrawStatus,
        w.withdrawDate,
        l.name AS name,
        l.email AS email,
        l.contact AS contact,
        l.date AS joiningDate
      FROM withdrawals w
      INNER JOIN tbl_users l ON l.id = w.employee_id
      WHERE w.withdrawStatus = 'Y'
      ORDER BY w.id ASC
      LIMIT ? OFFSET ?
      `,
      [limitNum, offset],
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error Fetching Withdrawn Employees:", error);
    res.status(500).json({
      message: "Error fetching withdrawn employees",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const reActiveEmployee = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const employeeId = Number(req.params.id);

    if (!employeeId || isNaN(employeeId)) {
      res.status(400).json({ message: "Invalid or missing employee ID" });
      return;
    }

    const [existing]: any = await pool.query(
      "SELECT * FROM withdrawals WHERE employee_id = ? AND withdrawStatus = 'Y'",
      [employeeId],
    );

    if (existing.length === 0) {
      res
        .status(404)
        .json({ message: "Employee is not withdrawn or does not exist" });
      return;
    }

    await pool.query(
      "UPDATE withdrawals SET withdrawStatus = 'N' WHERE employee_id = ?",
      [employeeId],
    );

await pool.query(
  `UPDATE tbl_users 
   SET 
     loginStatus = 'Y',
     status = 'Active'
   WHERE id = ?`,
  [employeeId]
);

    res.status(200).json({ message: "Employee reactivated successfully" });
  } catch (error) {
    console.error("Error Re-activating employee:", error);
    res.status(500).json({
      message: "Error re-activating employee",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
