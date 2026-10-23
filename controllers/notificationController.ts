import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/middleware";
import pool from "../database/db";
import { RowDataPacket } from "mysql2";
import { ensureNotificationDismissalsTable, markAllAsRead, markAsRead } from "../services/notificationService";

export const getNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        id, 
        referenceId, 
        type, title, message, module, targetUrl, readAt, recipientRole,
        isRead, 
        DATE_FORMAT(createdAt, '%Y-%m-%dT%H:%i:%s.000Z') as createdAt
       FROM notifications
       WHERE userId = ?
       AND (dedupeKey IS NULL OR (dedupeKey NOT LIKE 'attendance:%:in:%' AND dedupeKey NOT LIKE 'progress:%:submitted:%'))
       ORDER BY createdAt DESC, id DESC
       LIMIT 50`,
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

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM notifications WHERE id = ? AND userId = ?`,
      [id, req.user.id]
    );

    if (existing.length === 0) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    await markAsRead(Number(id), req.user.id);

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

    await markAllAsRead(req.user.id);

    res.status(200).json({ message: "All marked as read" });
  } catch (error) {
    console.error("Error marking all read:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteNotification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ message: "Invalid notification ID" });
    return;
  }

  try {
    await ensureNotificationDismissalsTable();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT dedupeKey, type, referenceId, DATE_FORMAT(createdAt, '%Y-%m-%d') AS createdDay
         FROM notifications WHERE id=? AND userId=? FOR UPDATE`,
        [id, req.user.id],
      );
      if (rows.length === 0) {
        await connection.rollback();
        res.status(404).json({ message: "Notification not found" });
        return;
      }
      const notice = rows[0];
      const dismissalKey = notice.dedupeKey
        ? `dedupe:${notice.dedupeKey}`
        : `legacy:${notice.type}:${notice.referenceId}:${notice.createdDay}`;
      await connection.query(
        "INSERT IGNORE INTO notification_dismissals (userId, dismissalKey) VALUES (?, ?)",
        [req.user.id, dismissalKey],
      );
      await connection.query("DELETE FROM notifications WHERE id=? AND userId=?", [id, req.user.id]);
      await connection.commit();
      res.status(200).json({ message: "Notification deleted" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ message: "Server error" });
  }
};