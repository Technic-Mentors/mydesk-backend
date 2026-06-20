import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

const normalizeDate = (date: string | null | undefined) => {
  if (!date) return null;
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const checkBlockedDates = async (
  userId: number,
  startDate: string,
  endDate: string,
) => {
  const [rows]: any = await pool.query(
    `
    SELECT date FROM attendance
    WHERE userId = ?
      AND date BETWEEN ? AND ?
      AND status = 'Y'
      AND (
        attendanceStatus = 'Absent'
        OR leaveStatus = 'Approved'
      )
    `,
    [userId, startDate, endDate],
  );

  return rows;
};

export interface RequestWithUser extends Request {
  user?: {
    id: number;
    role: string;
    [key: string]: any;
  };
}

export const getAllTodos = async (req: Request, res: Response) => {
  try {
    const query = `
SELECT 
  t.id,
  t.employee_id,
  u.name AS employeeName,
  u.email,
  t.task,
  t.note,
  DATE_FORMAT(t.startDate, '%Y-%m-%d') AS startDate,
  DATE_FORMAT(t.endDate, '%Y-%m-%d') AS endDate,
  DATE_FORMAT(t.deadline, '%Y-%m-%d') AS deadline,
  t.todoStatus,
  t.completionStatus,
  t.created_by,
  t.created_by_role,
  creator.name AS createdByName
FROM todo t
JOIN tbl_users u ON u.id = t.employee_id
LEFT JOIN tbl_users creator ON creator.id = t.created_by
WHERE t.todoStatus != 'N'
ORDER BY t.id DESC
`;

    const [rows] = await pool.query<RowDataPacket[]>(query);
    res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch todos" });
  }
};

export const getUserTodos = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ message: "User ID is required" });
      return;
    }

    const query = `
      SELECT 
        t.id,
        t.employee_id,
        u.name AS employeeName,
        u.email,
        t.task,
        t.note,
        DATE_FORMAT(t.startDate, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(t.endDate, '%Y-%m-%d') AS endDate,
        DATE_FORMAT(t.deadline, '%Y-%m-%d') AS deadline,
        t.todoStatus,
        t.completionStatus,
        t.created_by,
        t.created_by_role,
        creator.name AS createdByName
      FROM todo t
      INNER JOIN tbl_users u ON u.id = t.employee_id
      LEFT JOIN tbl_users creator ON creator.id = t.created_by
      WHERE t.employee_id = ?
        AND t.todoStatus != 'N'
      ORDER BY t.id DESC
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [id]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("getUserTodos error:", error);
    res.status(500).json({ message: "Failed to fetch user todos" });
  }
};

export const addTodo = async (
  req: RequestWithUser,
  res: Response,
): Promise<void> => {
  try {
    const {
      employee_id,
      task,
      note,
      startDate,
      endDate,
      deadline,
      todoStatus,
      completionStatus,
    } = req.body;

    const user = req.user;

    // Quick validation first
    if (!task || !startDate || !endDate || !deadline) {
      res.status(400).json({ message: "Task and dates are required" });
      return;
    }

    let finalEmployeeId: number;
    let createdByRole: string;
    
    if (user?.role === "admin") {
      if (!employee_id) {
        res.status(400).json({ message: "employee_id is required for admin" });
        return;
      }
      finalEmployeeId = Number(employee_id);
      createdByRole = "admin";
    } else {
      finalEmployeeId = user?.id ?? 0;
      createdByRole = "employee";
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Check if user exists
      const [userRows]: any = await connection.query(
        "SELECT date FROM tbl_users WHERE id = ?",
        [finalEmployeeId],
      );

      if (!userRows.length) {
        await connection.rollback();
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      // Check for existing task
      const [existing]: any = await connection.query(
        `
        SELECT id FROM todo 
        WHERE employee_id = ?
          AND task = ?
          AND DATE(startDate) <= DATE(?)
          AND DATE(endDate) >= DATE(?)
          AND completionStatus != 'Deleted'
        LIMIT 1
        `,
        [
          finalEmployeeId,
          task,
          normalizeDate(endDate),
          normalizeDate(startDate),
        ],
      );

      if (existing.length > 0) {
        await connection.rollback();
        res.status(400).json({
          message: "This task already exists for this date range",
        });
        return;
      }

      // Insert todo with created_by and created_by_role
      const query = `
        INSERT INTO todo
        (employee_id, task, note, startDate, endDate, deadline, todoStatus, completionStatus, created_by, created_by_role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.query(query, [
        finalEmployeeId,
        task,
        note ?? "",
        normalizeDate(startDate),
        normalizeDate(endDate),
        normalizeDate(deadline),
        todoStatus ?? "Y",
        completionStatus ?? "Pending",
        user?.id ?? null, // created_by - the user who is creating this todo
        createdByRole, // created_by_role - admin or employee
      ]);

      await connection.commit();
      res.status(201).json({
        message: "Todo added successfully",
        data: {
          created_by: user?.id ?? null,
          created_by_role: createdByRole,
        },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Add todo failed" });
  }
};

export const updateTodo = async (
  req: RequestWithUser, // Changed from Request to RequestWithUser
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      employee_id,
      task,
      note,
      startDate,
      endDate,
      deadline,
      completionStatus,
    } = req.body;

    const user = req.user; // Get the logged-in user

    if (!id) {
      res.status(400).json({ message: "Todo ID is required" });
      return;
    }

    if (!employee_id || !task || !startDate || !endDate || !deadline) {
      res.status(400).json({
        message: "employee_id, task, startDate, endDate, and deadline are required",
      });
      return;
    }

    // FIRST: Get the todo to check who created it
    const [todoRows]: any = await pool.query(
      "SELECT created_by, created_by_role FROM todo WHERE id = ?",
      [id]
    );

    if (!todoRows.length) {
      res.status(404).json({ message: "Todo not found" });
      return;
    }

    const todo = todoRows[0];

    // CHECK PERMISSION: Can this user edit this todo?
    if (todo.created_by_role === 'admin') {
      // Admin-created todo: Only admin can edit
      if (user?.role !== 'admin') {
        res.status(403).json({ 
          message: "Access denied. This todo was created by admin and can only be modified by admin." 
        });
        return;
      }
    } else {
      // Employee-created todo: Only the creator can edit (or admin)
      if (user?.role !== 'admin' && user?.id !== todo.created_by) {
        res.status(403).json({ 
          message: "Access denied. You can only edit todos you created." 
        });
        return;
      }
    }

    // Date validations
    if (new Date(startDate) > new Date(endDate)) {
      res.status(400).json({ message: "Start Date cannot be later than End Date" });
      return;
    }

    if (new Date(endDate) > new Date(deadline)) {
      res.status(400).json({ message: "End Date cannot be later than Deadline" });
      return;
    }

    if (new Date(startDate) > new Date(deadline)) {
      res.status(400).json({ message: "Start Date cannot be later than Deadline" });
      return;
    }

    // Check employee exists
    const [userRows]: any = await pool.query(
      "SELECT date FROM tbl_users WHERE id = ?",
      [employee_id],
    );

    if (!userRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const joiningDateRaw = normalizeDate(userRows[0].date);
    if (!joiningDateRaw) {
      res.status(400).json({ message: "Employee joining date not found" });
      return;
    }

    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);
    const normalizedDeadline = normalizeDate(deadline);

    if (!normalizedStart || !normalizedEnd || !normalizedDeadline) {
      res.status(400).json({ message: "Invalid date format" });
      return;
    }

    if (
      normalizedStart < joiningDateRaw ||
      normalizedEnd < joiningDateRaw ||
      normalizedDeadline < joiningDateRaw
    ) {
      res.status(400).json({
        message: "Todo dates cannot be earlier than employee joining date",
      });
      return;
    }

    // Check for approved leaves
    const [approvedLeaves]: any = await pool.query(
      `SELECT id FROM leaves
      WHERE userId = ?
        AND leaveStatus = 'Approved'
        AND ((fromDate <= ? AND toDate >= ?) OR (fromDate <= ? AND toDate >= ?))`,
      [
        employee_id,
        normalizedEnd,
        normalizedStart,
        normalizedEnd,
        normalizedStart,
      ],
    );

    if (approvedLeaves.length > 0) {
      res.status(400).json({
        message: "Cannot update todo. User has approved leave on one or more selected dates.",
      });
      return;
    }

    // Perform the update
    const query = `
      UPDATE todo
      SET
        employee_id = ?,
        task = ?,
        note = ?,
        startDate = ?,
        endDate = ?,
        deadline = ?,
        completionStatus = ?
      WHERE id = ?
    `;

    const [result] = await pool.query<ResultSetHeader>(query, [
      employee_id,
      task,
      note ?? "",
      normalizeDate(startDate),
      normalizeDate(endDate),
      normalizeDate(deadline),
      completionStatus || "Defer",
      id,
    ]);

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Todo not found" });
      return;
    }

    res.status(200).json({ 
      message: "Todo updated successfully",
      data: {
        created_by: todo.created_by,
        created_by_role: todo.created_by_role
      }
    });
  } catch (error) {
    console.error("Update Todo Error:", error);
    res.status(500).json({ message: "Failed to update todo" });
  }
};

export const deleteTodo = async (
  req: RequestWithUser, // Changed from Request to RequestWithUser
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!id) {
      res.status(400).json({ message: "Todo ID is required" });
      return;
    }

    // FIRST: Get the todo to check who created it
    const [todoRows]: any = await pool.query(
      "SELECT created_by, created_by_role FROM todo WHERE id = ?",
      [id]
    );

    if (!todoRows.length) {
      res.status(404).json({ message: "Todo not found" });
      return;
    }

    const todo = todoRows[0];

    // CHECK PERMISSION: Can this user delete this todo?
    if (todo.created_by_role === 'admin') {
      // Admin-created todo: Only admin can delete
      if (user?.role !== 'admin') {
        res.status(403).json({ 
          message: "Access denied. This todo was created by admin and can only be deleted by admin." 
        });
        return;
      }
    } else {
      // Employee-created todo: Only the creator can delete (or admin)
      if (user?.role !== 'admin' && user?.id !== todo.created_by) {
        res.status(403).json({ 
          message: "Access denied. You can only delete todos you created." 
        });
        return;
      }
    }

    const query = `
      UPDATE todo
      SET todoStatus = 'N'
      WHERE id = ?
    `;

    const [result] = await pool.query<ResultSetHeader>(query, [id]);

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Todo not found" });
      return;
    }

    res.status(200).json({ 
      message: "Todo deleted successfully",
      data: {
        created_by: todo.created_by,
        created_by_role: todo.created_by_role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete todo" });
  }
};
