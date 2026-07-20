import { Request, Response } from "express";
import pool from "../database/db";
import { AuthenticatedRequest } from "../middleware/middleware";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ResignationRow extends RowDataPacket {
  id: number;
  employee_name: string;
  designation: string;
  resignation_date: string;
  note: string;
  approval_status: string;
}

interface EmployeeLifeLineRow extends RowDataPacket {
  current_designation: string;
}

export const getResignations = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const [rows] = await pool.query<ResignationRow[]>(
      `SELECT r.id, l.name AS employee_name, r.designation, 
              DATE_FORMAT(r.resignation_date, '%Y-%m-%d') AS resignation_date, 
              r.note, r.approval_status
       FROM resignation r
       JOIN tbl_users l ON r.employee_id = l.id
       WHERE r.is_deleted = 0  -- Added this line
       ORDER BY r.id DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch resignations" });
  }
};

export const getMyResignations = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  const userId = req.user.id;

  try {
    const [rows] = await pool.query<ResignationRow[]>(
      `SELECT r.id, l.name AS employee_name, r.designation, r.resignation_date, r.note, r.approval_status
       FROM resignation r
       JOIN tbl_users l ON r.employee_id = l.id
       WHERE r.employee_id = ? AND r.is_deleted = 0`, // Added is_deleted filter
      [userId],
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch your resignations" });
  }
};

export const addResignation = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { id, designation, note, resignation_date } = req.body;

  if (!id || !designation || !note || !resignation_date) {
    res.status(400).json({ message: "All fields are required" });
    return;
  }

  const isAdmin = req.user.role === "admin";

  const [userRows]: any = await pool.query(
    "SELECT name, date FROM tbl_users WHERE id = ?",
    [id],
  );

  if (userRows.length === 0) {
    res.status(404).json({ message: "Employee not found" });
    return;
  }

  const employeeName = userRows[0].name || "Employee";
  const joiningDate = new Date(userRows[0].date);
  const selectedResignationDate = new Date(resignation_date);

  if (selectedResignationDate < joiningDate) {
    res.status(400).json({
      message: `Resignation date cannot be before joining date (${userRows[0].date})`,
    });
    return;
  }

  try {
    const [existingResignation]: any = await pool.query(
      "SELECT id FROM resignation WHERE employee_id = ?",
      [id],
    );

    if (existingResignation.length > 0) {
      res
        .status(400)
        .json({ message: "Resignation already submitted for this employee" });
      return;
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO resignation (employee_id, designation, note, resignation_date)
       VALUES (?, ?, ?, ?)`,
      [id, designation, note, resignation_date],
    );

    const resignationId = result.insertId;

    // ✅ CREATE NOTIFICATIONS (never notify the actor themselves)
    try {
      if (!isAdmin) {
        // Employee submitted their own resignation → notify all admins
        const [adminUsers]: any = await pool.query(
          "SELECT id FROM tbl_users WHERE role = 'admin'"
        );

        for (const admin of adminUsers) {
          if (admin.id !== id) {
            await pool.query(
              `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
               VALUES (?, ?, 'resignation', ?, false, NOW(), NOW())`,
              [
                admin.id,
                resignationId,
                `${employeeName} submitted a resignation request`
              ]
            );
          }
        }
      } else {
        // Admin submitted on behalf of the employee → notify that employee
        if (Number(id) !== req.user.id) {
          await pool.query(
            `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
             VALUES (?, ?, 'resignation', ?, false, NOW(), NOW())`,
            [
              id,
              resignationId,
              `A resignation request has been submitted for you`
            ]
          );
        }
      }
    } catch (notifError) {
      console.error("Notification error (non-critical):", notifError);
    }

    res.json({ message: "Resignation added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add resignation" });
  }
};

export const updateResignation = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { id } = req.params; // resignation ID
  let { designation, note, resignation_date, approval_status } = req.body;

  const ALLOWED_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"];

  if (!ALLOWED_STATUSES.includes(approval_status)) {
    approval_status = "PENDING";
  }

  if (!designation || !note || !resignation_date) {
    res.status(400).json({ message: "All fields are required" });
    return;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // ✅ STEP 1: Get resignation first (IMPORTANT FIX)
    const [[resignation]]: any = await connection.query(
      `SELECT employee_id FROM resignation WHERE id = ?`,
      [id],
    );

    if (!resignation) {
      await connection.rollback();
      res.status(404).json({ message: "Resignation not found" });
      return;
    }

    const employeeId = resignation.employee_id;

    // ✅ STEP 2: Validate employee
    const [userRows]: any = await connection.query(
      "SELECT date FROM tbl_users WHERE id = ?",
      [employeeId],
    );

    if (userRows.length === 0) {
      await connection.rollback();
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDate = new Date(userRows[0].date);
    const selectedResignationDate = new Date(resignation_date);

    if (selectedResignationDate < joiningDate) {
      await connection.rollback();
      res.status(400).json({
        message: `Resignation date cannot be before joining date (${userRows[0].date})`,
      });
      return;
    }

    // ✅ STEP 3: Update resignation
    await connection.query(
      `UPDATE resignation
       SET designation = ?, note = ?, resignation_date = ?, approval_status = ?
       WHERE id = ?`,
      [designation, note, resignation_date, approval_status, id],
    );

    // ✅ STEP 4: If accepted → deactivate user
    if (approval_status === "ACCEPTED") {
      await connection.query(
        `UPDATE tbl_users
         SET loginStatus = 'N', status = 'Inactive'
         WHERE id = ?`,
        [employeeId],
      );
    }

    await connection.commit();

    // ✅ Notify employee about approval/rejection decision (admin is the actor here)
    if (approval_status === "ACCEPTED" || approval_status === "REJECTED") {
      try {
        if (employeeId !== req.user.id) {
          await pool.query(
            `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
             VALUES (?, ?, 'resignation', ?, false, NOW(), NOW())`,
            [
              employeeId,
              id,
              `Your resignation request has been ${approval_status === "ACCEPTED" ? "Approved" : "Rejected"}`
            ]
          );
        }
      } catch (notifError) {
        console.error("Notification error (non-critical):", notifError);
      }
    }

    res.json({
      message:
        approval_status === "ACCEPTED"
          ? "Resignation accepted and user deactivated"
          : "Resignation updated successfully",
    });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to update resignation" });
  } finally {
    connection.release();
  }
};

export const deleteResignation = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  try {
    // We update the flag instead of removing the row
    await pool.query<ResultSetHeader>(
      `UPDATE resignation SET is_deleted = 1 WHERE id = ?`,
      [id],
    );
    res.json({ message: "Resignation moved to trash successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete resignation" });
  }
};

export const getEmployeeLifeLine = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query<EmployeeLifeLineRow[]>(
      `SELECT position AS current_designation 
       FROM employee_lifeline 
       WHERE employee_id = ? 
       ORDER BY date DESC 
       LIMIT 1`,
      [id],
    );

    res.json(rows[0] || { current_designation: "" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch employee designation" });
  }
};

export const getMyLifeLine = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  try {
    const [rows] = await pool.query<EmployeeLifeLineRow[]>(
      `SELECT id, employee_id, position, date 
       FROM employee_lifeline 
       WHERE employee_id = ? 
       ORDER BY date DESC`,
      [userId],
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch your lifeline data" });
  }
};