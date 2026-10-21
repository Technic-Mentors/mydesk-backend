import { Request, Response } from "express";
import pool from "../database/db";

export const getAssets = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.asset_name, a.category_id, a.description, a.date, a.status, c.category_name
       FROM assets a
       JOIN asset_categories c ON a.category_id = c.id
       WHERE a.status = 'Y'`, // Only fetch active assets
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const addAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { asset_name, category_id, description, date } = req.body;

    const [existing]: any = await pool.query(
      `SELECT id FROM assets WHERE LOWER(asset_name) = LOWER(?)`,
      [asset_name],
    );

    if (existing.length > 0) {
      res.status(400).json({ message: "Asset name already exists" });
      return;
    }

    const [result] = await pool.query(
  `INSERT INTO assets (asset_name, category_id, description, date) VALUES (?, ?, ?, ?)`,
  [asset_name, category_id, description, date],
);
    res.json({ message: "Asset added", id: (result as any).insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { asset_name, category_id, description, date } = req.body;

    const [existing]: any = await pool.query(
      `SELECT id FROM assets WHERE LOWER(asset_name) = LOWER(?) AND id != ?`,
      [asset_name, id],
    );

    if (existing.length > 0) {
      res.status(400).json({ message: "Asset name already exists" });
      return;
    }

    await pool.query(
  `UPDATE assets SET asset_name = ?, category_id = ?, description = ?, date = ? WHERE id = ?`,
  [asset_name, category_id, description, date, id],
);
    res.json({ message: "Asset updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Instead of DELETE, we UPDATE the status to 'N'
    await pool.query(`UPDATE assets SET status = 'N' WHERE id = ?`, [id]);
    res.json({ message: "Asset moved to trash" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getCategories = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM asset_categories WHERE category_status='Y'`,
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
