import { Request, Response } from "express";
import pool from "../database/db";
import { AuthenticatedRequest } from "../middleware/middleware";

export const getAllRejoinRequests = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM rejoin WHERE is_deleted = 0 ORDER BY id DESC",
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch rejoin requests" });
  }
};

export const getMyRejoinRequests = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM rejoin WHERE employee_id = ? AND is_deleted = 0 ORDER BY id DESC",
      [userId],
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch your rejoin requests" });
  }
};

export const getUsersWithAcceptedResignation = async (
  req: Request,
  res: Response,
) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.id, l.name, r.designation, r.resignation_date
       FROM resignation r
       JOIN tbl_users l ON r.employee_id = l.id
       WHERE r.approval_status = 'Accepted' AND l.loginStatus = 'N'`,
    );

    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to fetch users with accepted resignation" });
  }
};

export const getMyLifeLine = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM employee_lifeline WHERE employee_id = ? ORDER BY date DESC",
      [userId],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch lifeline" });
  }
};

export const getMyResignation = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM resignation WHERE employee_id = ? ORDER BY resignation_date DESC LIMIT 1",
      [userId],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch resignation" });
  }
};

export const addRejoinRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id, note, rejoin_date } = req.body;

  if (!id || !rejoin_date) {
    res.status(400).json({ message: "Employee and rejoin date are required" });
    return;
  }

  try {
    const [employeeRows] = await pool.query(
      "SELECT employee_name, position AS designation FROM employee_lifeline WHERE employee_id = ?",
      [id],
    );

    if (!Array.isArray(employeeRows) || employeeRows.length === 0)
      res.status(404).json({ message: "Employee not found" });

    const employee = (employeeRows as any)[0];

    const [resignationRows] = await pool.query(
      "SELECT resignation_date FROM resignation WHERE employee_id = ? ORDER BY resignation_date DESC LIMIT 1",
      [id],
    );

    const resignation_date =
      Array.isArray(resignationRows) && resignationRows.length > 0
        ? (resignationRows as any)[0].resignation_date
        : null;

    const [joinRows]: any = await pool.query(
      "SELECT date FROM tbl_users WHERE id = ?",
      [id],
    );

    if (!joinRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(joinRows[0].date);
    const rejoinDateObj = new Date(rejoin_date);

    if (rejoinDateObj < joiningDate) {
      res.status(400).json({
        message: "Rejoin date cannot be before employee joining date",
      });
      return;
    }

    await pool.query(
      `INSERT INTO rejoin 
      (employee_id, employee_name, designation, resignation_date, rejoinRequest_date, note) 
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        employee.employee_name,
        employee.designation,
        resignation_date,
        rejoin_date,
        note,
      ],
    );

    res.json({ message: "Rejoin request added successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add rejoin request" });
  }
};

export const updateRejoinRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const { rejoin_date, note, approval_status } = req.body;

  try {
    const [rejoinRows] = await pool.query(
      "SELECT employee_id FROM rejoin WHERE id = ? AND is_deleted = 0",
      [id],
    );

    if (!Array.isArray(rejoinRows) || rejoinRows.length === 0) {
      res.status(404).json({ message: "Rejoin request not found" });
      return;
    }

    const employee_id = (rejoinRows as any)[0].employee_id;

    const [employeeRows] = await pool.query(
      "SELECT position AS designation FROM employee_lifeline WHERE employee_id = ?",
      [employee_id],
    );

    const designation =
      Array.isArray(employeeRows) && employeeRows.length > 0
        ? (employeeRows as any)[0].designation
        : null;

    const [resignationRows] = await pool.query(
      "SELECT resignation_date FROM resignation WHERE employee_id = ? ORDER BY resignation_date DESC LIMIT 1",
      [employee_id],
    );

    const resignation_date =
      Array.isArray(resignationRows) && resignationRows.length > 0
        ? (resignationRows as any)[0].resignation_date
        : null;

    const [joinRows]: any = await pool.query(
      "SELECT date FROM tbl_users WHERE id = ?",
      [employee_id],
    );

    if (!joinRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(joinRows[0].date);
    const rejoinDateObj = new Date(rejoin_date);

    if (rejoinDateObj < joiningDate) {
      res.status(400).json({
        message: "Rejoin date cannot be before employee joining date",
      });
      return;
    }

    await pool.query(
      `UPDATE rejoin SET 
      designation = ?, 
      resignation_date = ?, 
      rejoinRequest_date = ?, 
      note = ?, 
      approval_status = ? 
      WHERE id = ? AND is_deleted = 0`,
      [designation, resignation_date, rejoin_date, note, approval_status, id],
    );

    const newLoginStatus = approval_status === "Accepted" ? "Y" : "N";

    await pool.query(`UPDATE tbl_users SET loginStatus = ? WHERE id = ?`, [
      newLoginStatus,
      employee_id,
    ]);

    // A resignation-acceptance now writes a withdrawals row (see
    // resignation.controller.ts) — close it out on rejoin, same as
    // reActiveEmployee already does for the Withdraw-button path, so this
    // person stops showing up as withdrawn.
    if (approval_status === "Accepted") {
      await pool.query(
        `UPDATE withdrawals SET withdrawStatus = 'N' WHERE employee_id = ? AND withdrawStatus = 'Y'`,
        [employee_id],
      );
    }

    res.json({ message: "Rejoin request updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update rejoin request" });
  }
};

export const deleteRejoinRequest = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query("UPDATE rejoin SET is_deleted = 1 WHERE id = ?", [id]);
    res.json({ message: "Rejoin request deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete rejoin request" });
  }
};

export const getActiveUsers = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      "SELECT employee_id AS id, employee_name AS name, position AS designation FROM employee_lifeline WHERE loginStatus = 'Y'",
    );

    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
};
