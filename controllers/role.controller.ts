import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import pool from "../database/db";

const normalizeRoleName = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export const getRoles = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, roleName FROM roles ORDER BY id ASC",
    );
    res.json({ roles: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch positions and designations" });
  }
};

export const addRole = async (req: Request, res: Response): Promise<void> => {
  const roleName = normalizeRoleName(req.body?.roleName);
  if (!roleName) {
    res.status(400).json({ message: "Position & Designation is required" });
    return;
  }
  if (roleName.length > 50) {
    res.status(400).json({ message: "Position & Designation must be 50 characters or fewer" });
    return;
  }
  try {
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM roles WHERE LOWER(TRIM(roleName)) = LOWER(?) LIMIT 1",
      [roleName],
    );
    if (existing.length) {
      res.status(409).json({ message: "Position & Designation already exists" });
      return;
    }
    const [result]: any = await pool.query("INSERT INTO roles (roleName) VALUES (?)", [roleName]);
    const [chatModule] = await pool.query<RowDataPacket[]>("SELECT id FROM modules WHERE moduleName = 'Chat' LIMIT 1");
    if (chatModule.length) {
      await pool.query("INSERT IGNORE INTO access_control (roleId, moduleId, status) VALUES (?, ?, 1)", [result.insertId, chatModule[0].id]);
    }
    res.status(201).json({ message: "Position & Designation added successfully", id: result.insertId });
  } catch (err: any) {
    console.error(err);
    if (err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ message: "Position & Designation already exists" });
      return;
    }
    res.status(500).json({ message: "Failed to add Position & Designation" });
  }
};

export const updateRole = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const roleName = normalizeRoleName(req.body?.roleName);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid Position & Designation" });
    return;
  }
  if (!roleName) {
    res.status(400).json({ message: "Position & Designation is required" });
    return;
  }
  if (roleName.length > 50) {
    res.status(400).json({ message: "Position & Designation must be 50 characters or fewer" });
    return;
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>("SELECT id, roleName FROM roles WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) {
      await connection.rollback();
      res.status(404).json({ message: "Position & Designation not found" });
      return;
    }
    const [duplicates] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM roles WHERE LOWER(TRIM(roleName)) = LOWER(?) AND id <> ? LIMIT 1",
      [roleName, id],
    );
    if (duplicates.length) {
      await connection.rollback();
      res.status(409).json({ message: "Position & Designation already exists" });
      return;
    }
    const oldRoleName = String(rows[0].roleName);
    await connection.query("UPDATE roles SET roleName = ? WHERE id = ?", [roleName, id]);
    await connection.query("UPDATE employee_lifeline SET position = ? WHERE LOWER(TRIM(position)) = LOWER(TRIM(?))", [roleName, oldRoleName]);
    await connection.commit();
    res.json({ message: "Position & Designation updated successfully", role: { id, roleName } });
  } catch (err: any) {
    if (connection) await connection.rollback();
    console.error(err);
    if (err.code === "ER_DUP_ENTRY") {
      res.status(409).json({ message: "Position & Designation already exists" });
      return;
    }
    res.status(500).json({ message: "Failed to update Position & Designation" });
  } finally {
    connection?.release();
  }
};

export const deleteRole = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid Position & Designation" });
    return;
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT roleName FROM roles WHERE id = ? LIMIT 1", [id]);
    if (!rows.length) {
      res.status(404).json({ message: "Position & Designation not found" });
      return;
    }
    const roleName = String(rows[0].roleName);
    const [systemUser] = await pool.query<RowDataPacket[]>("SELECT id FROM tbl_users WHERE roleId = ? LIMIT 1", [id]);
    if (systemUser.length) {
      res.status(409).json({ message: "This position is assigned to a system user and cannot be deleted." });
      return;
    }
    const [employee] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM employee_lifeline WHERE LOWER(TRIM(position)) = LOWER(TRIM(?)) LIMIT 1",
      [roleName],
    );
    if (employee.length) {
      res.status(409).json({ message: "This designation is assigned to employees. Update their designation before deleting it." });
      return;
    }
    await pool.query("DELETE FROM roles WHERE id = ?", [id]);
    res.json({ message: "Position & Designation deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete Position & Designation" });
  }
};