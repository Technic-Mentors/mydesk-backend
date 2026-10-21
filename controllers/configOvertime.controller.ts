import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// GET ALL OVERTIME CONFIG
export const getOvertimeConfig = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, overtimeType, amount FROM overtime_config ORDER BY id ASC",
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
    return;
  } catch (error) {
    console.error("Get Overtime Config Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch overtime configurations",
    });
    return;
  }
};

// CREATE OVERTIME CONFIG
export const createOvertimeConfig = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { overtimeType, amount } = req.body;

    if (!String(overtimeType || "").trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      res.status(400).json({
        success: false,
        message: "Overtime type and a positive rate are required",
      });
      return;
    }

    // Check duplicate
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM overtime_config WHERE overtimeType = ?",
      [overtimeType],
    );

    if (existing.length > 0) {
      res.status(400).json({
        success: false,
        message: "Overtime type already exists",
      });
      return;
    }

    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO overtime_config (overtimeType, amount) VALUES (?, ?)",
      [overtimeType, amount],
    );

    res.status(201).json({
      success: true,
      message: "Overtime config created successfully",
      id: result.insertId,
    });
    return;
  } catch (error) {
    console.error("Create Overtime Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create overtime config",
    });
    return;
  }
};

export const updateOvertimeConfig = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { overtimeType, amount } = req.body;

    if (!String(overtimeType || "").trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      res.status(400).json({
        success: false,
        message: "Overtime type and a positive rate are required",
      });
      return;
    }

    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM overtime_config WHERE overtimeType = ? AND id != ?",
      [overtimeType, id],
    );

    if (existing.length > 0) {
      res.status(400).json({
        success: false,
        message: "Overtime type already exists",
      });
      return;
    }

    await pool.query(
      "UPDATE overtime_config SET overtimeType = ?, amount = ? WHERE id = ?",
      [overtimeType, amount, id],
    );

    res.status(200).json({
      success: true,
      message: "Overtime config updated successfully",
    });
    return;
  } catch (error) {
    console.error("Update Overtime Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update overtime config",
    });
    return;
  }
};

export const deleteOvertimeConfig = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM overtime_config WHERE id = ?", [id]);

    res.status(200).json({
      success: true,
      message: "Overtime config deleted successfully",
    });
    return;
  } catch (error) {
    console.error("Delete Overtime Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete overtime config",
    });
    return;
  }
};

