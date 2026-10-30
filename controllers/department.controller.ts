import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import pool from "../database/db";

const normalizeDepartmentName = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export const getDepartments = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, departmentName FROM departments ORDER BY departmentName ASC, id ASC",
    );
    res.json({ departments: rows });
  } catch (error) {
    console.error("Failed to fetch departments:", error);
    res.status(500).json({ message: "Failed to fetch departments" });
  }
};

export const createDepartment = async (req: Request, res: Response): Promise<void> => {
  const departmentName = normalizeDepartmentName(req.body?.departmentName);
  if (!departmentName) {
    res.status(400).json({ message: "Department name is required" });
    return;
  }
  if (departmentName.length > 120) {
    res.status(400).json({ message: "Department name must be 120 characters or fewer" });
    return;
  }

  try {
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM departments WHERE LOWER(TRIM(departmentName)) = LOWER(?) LIMIT 1",
      [departmentName],
    );
    if (existing.length) {
      res.status(409).json({ message: "Department already exists" });
      return;
    }
    const [result]: any = await pool.query(
      "INSERT INTO departments (departmentName) VALUES (?)",
      [departmentName],
    );
    res.status(201).json({
      message: "Department added successfully",
      department: { id: result.insertId, departmentName },
    });
  } catch (error: any) {
    console.error("Failed to add department:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ message: "Department already exists" });
      return;
    }
    res.status(500).json({ message: "Failed to add department" });
  }
};

export const updateDepartment = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const departmentName = normalizeDepartmentName(req.body?.departmentName);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid department" });
    return;
  }
  if (!departmentName) {
    res.status(400).json({ message: "Department name is required" });
    return;
  }
  if (departmentName.length > 120) {
    res.status(400).json({ message: "Department name must be 120 characters or fewer" });
    return;
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT id, departmentName FROM departments WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!existing.length) {
      await connection.rollback();
      res.status(404).json({ message: "Department not found" });
      return;
    }
    const [duplicate] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM departments WHERE LOWER(TRIM(departmentName)) = LOWER(?) AND id <> ? LIMIT 1",
      [departmentName, id],
    );
    if (duplicate.length) {
      await connection.rollback();
      res.status(409).json({ message: "Department already exists" });
      return;
    }
    const oldName = String(existing[0].departmentName);
    await connection.query("UPDATE departments SET departmentName = ? WHERE id = ?", [departmentName, id]);
    await connection.query(
      "UPDATE tbl_users SET department = ? WHERE LOWER(TRIM(department)) = LOWER(TRIM(?))",
      [departmentName, oldName],
    );
    await connection.commit();
    res.json({ message: "Department updated successfully", department: { id, departmentName } });
  } catch (error: any) {
    if (connection) await connection.rollback();
    console.error("Failed to update department:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      res.status(409).json({ message: "Department already exists" });
      return;
    }
    res.status(500).json({ message: "Failed to update department" });
  } finally {
    connection?.release();
  }
};

export const deleteDepartment = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid department" });
    return;
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT departmentName FROM departments WHERE id = ? LIMIT 1",
      [id],
    );
    if (!rows.length) {
      res.status(404).json({ message: "Department not found" });
      return;
    }
    const departmentName = String(rows[0].departmentName);
    const [assigned] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM tbl_users WHERE LOWER(TRIM(department)) = LOWER(TRIM(?)) LIMIT 1",
      [departmentName],
    );
    if (assigned.length) {
      res.status(409).json({ message: "This department is assigned to employees. Reassign them before deleting it." });
      return;
    }
    await pool.query("DELETE FROM departments WHERE id = ?", [id]);
    res.json({ message: "Department deleted successfully" });
  } catch (error) {
    console.error("Failed to delete department:", error);
    res.status(500).json({ message: "Failed to delete department" });
  }
};