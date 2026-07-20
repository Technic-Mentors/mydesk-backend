import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/middleware";
import pool from "../database/db";
import { RowDataPacket } from "mysql2";

export const getNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, referenceId, type, message, isRead, createdAt
       FROM notifications
       WHERE userId = ? AND isRead = false
       ORDER BY createdAt DESC
       LIMIT 20`,
      [req.user.id]
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const markNotificationRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const { id } = req.params;

    await pool.query(
      `UPDATE notifications SET isRead = true, updatedAt = NOW()
       WHERE id = ? AND userId = ?`,
      [id, req.user.id]
    );

    res.status(200).json({ message: "Marked as read" });
  } catch (error) {
    console.error("Error marking notification read:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const markAllNotificationsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    await pool.query(
      `UPDATE notifications SET isRead = true, updatedAt = NOW()
       WHERE userId = ? AND isRead = false`,
      [req.user.id]
    );

    res.status(200).json({ message: "All marked as read" });
  } catch (error) {
    console.error("Error marking all read:", error);
    res.status(500).json({ message: "Server error" });
  }
};