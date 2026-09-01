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
    // ✅ No server-side pagination here: every caller (EmployeeWithdraw.tsx,
    // UserAttendance.tsx) fetches this once and does its own client-side
    // search/pagination/lookup. A LIMIT here silently dropped any withdrawal
    // past the cap (oldest-first), so recently-withdrawn employees could
    // appear "added" but never show up in the Withdrawn list.
    //
    // ✅ Driven by tbl_users.status/loginStatus (LEFT JOIN withdrawals),
    // not just the withdrawals table. An employee can end up
    // Inactive/loginStatus=N through paths other than the Withdraw button
    // (delete, resignation, admin deactivate) — those never insert a
    // withdrawals row, so an INNER JOIN silently hid them from this list.
    // Now: inactive/disabled-login employees always show up here, with
    // whatever withdrawal reason/date is on record if one exists.
    const [rows] = await pool.query(
      `
      SELECT
        w.id AS withdrawalId,
        l.id AS employeeId,
        COALESCE(w.withdrawReason, 'Not provided') AS withdrawReason,
        'Y' AS withdrawStatus,
        COALESCE(w.withdrawDate, DATE(l.updated_at)) AS withdrawDate,
        l.name AS name,
        l.email AS email,
        l.contact AS contact,
        l.date AS joiningDate
      FROM tbl_users l
      LEFT JOIN withdrawals w
        ON w.employee_id = l.id AND w.withdrawStatus = 'Y'
      WHERE LOWER(l.role) = 'user'
        AND (l.status != 'Active' OR l.loginStatus = 'N')
      ORDER BY l.id ASC
      `,
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

    // ✅ Reactivate based on the employee existing, not on there being a
    // withdrawals row for them. Someone deactivated via delete/resignation/
    // admin-deactivate (instead of the Withdraw button) has no withdrawals
    // row at all, so requiring one here made them impossible to reactivate
    // from the Withdrawn list.
    const [userRows]: any = await pool.query(
      "SELECT id FROM tbl_users WHERE id = ?",
      [employeeId],
    );

    if (userRows.length === 0) {
      res.status(404).json({ message: "Employee does not exist" });
      return;
    }

    // Close out any active withdrawal record, if one happens to exist.
    await pool.query(
      "UPDATE withdrawals SET withdrawStatus = 'N' WHERE employee_id = ? AND withdrawStatus = 'Y'",
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
