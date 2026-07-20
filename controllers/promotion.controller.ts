import { Request, Response } from "express";
import pool from "../database/db";
import { AuthenticatedRequest } from "../middleware/middleware";

export const getAllPromotions = async (_: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM promotion 
   WHERE id IN (SELECT MAX(id) FROM promotion WHERE is_deleted = 0 GROUP BY employee_id)
   ORDER BY id DESC`,
    );
    res.json(rows);
  } catch {
    res.status(500).json({ message: "Failed to fetch promotions" });
  }
};

export const getMyPromotions = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [rows] = await pool.query(
      `SELECT * FROM promotion 
       WHERE employee_id = ? 
       AND is_deleted = 0
       ORDER BY id DESC`,
      [req.user.id],
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch promotions" });
  }
};

export const getEmployeeLifeLine = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        el.id,
        el.employee_id AS id,
        u.name AS employee_name,
        u.email,
        u.contact,
        el.position,
        el.date
      FROM employee_lifeline el
      JOIN tbl_users u ON u.id = el.employee_id
      ORDER BY el.date DESC
    `);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Employee LifeLine Error:", error);
    res.status(500).json({ message: "Failed to fetch employee lifeline" });
  }
};

export const getEmployeePromotionHistory = async (
  req: Request,
  res: Response,
) => {
  try {
    const { employeeId } = req.params;
    const [rows] = await pool.query(
      "SELECT * FROM promotion WHERE employee_id = ? AND is_deleted = 0 ORDER BY date DESC",
      [employeeId],
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch history" });
  }
};

export const addPromotion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id, current_designation, requested_designation, note } = req.body;
    const employee_id = req.user.role === "admin" ? id : req.user.id;
    const isAdmin = req.user.role === "admin";

    // Set date to today's date automatically
    const today = new Date().toISOString().split('T')[0];

    // 👇 FIX: Use 'date' instead of 'joining_date'
    const [userRows]: any = await pool.query(
      "SELECT name, date FROM tbl_users WHERE id = ?",
      [employee_id],
    );

    if (!userRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const employeeName = userRows[0].name || "Employee";

    // Check if joining date exists and validate
    if (userRows[0].date) {
      const joiningDate = new Date(userRows[0].date);
      const promotionDate = new Date(today);
      
      if (promotionDate < joiningDate) {
        res.status(400).json({
          message: `Promotion date cannot be before joining date (${userRows[0].date})`,
        });
        return;
      }
    }

    const [existingPromotion]: any = await pool.query(
      "SELECT id FROM promotion WHERE employee_id = ? AND is_deleted = 0",
      [employee_id],
    );

    let promotionId: number;

    if (existingPromotion.length > 0) {
      promotionId = existingPromotion[0].id;
      await pool.query(
        `UPDATE promotion SET 
          current_designation = ?, 
          requested_designation = ?, 
          note = ?, 
          date = ?, 
          approval = 'PENDING' 
         WHERE employee_id = ? AND is_deleted = 0`,
        [current_designation, requested_designation, note, today, employee_id],
      );
    } else {
      const [result]: any = await pool.query(
        `INSERT INTO promotion 
        (employee_id, employee_name, current_designation, requested_designation, note, date, approval)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          employee_id,
          userRows[0].name,
          current_designation,
          requested_designation,
          note,
          today,
        ],
      );
      promotionId = result.insertId;
    }

    // ✅ CREATE NOTIFICATIONS (never notify the actor themselves)
    try {
      if (!isAdmin) {
        // Employee submitted their own promotion request → notify all admins
        const [adminUsers]: any = await pool.query(
          "SELECT id FROM tbl_users WHERE role = 'admin'"
        );

        for (const admin of adminUsers) {
          if (admin.id !== employee_id) {
            await pool.query(
              `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
               VALUES (?, ?, 'promotion', ?, false, NOW(), NOW())`,
              [
                admin.id,
                promotionId,
                `${employeeName} requested promotion: ${current_designation} → ${requested_designation}`
              ]
            );
          }
        }
      } else {
        // Admin submitted on behalf of the employee → notify that employee
        if (employee_id !== req.user.id) {
          await pool.query(
            `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
             VALUES (?, ?, 'promotion', ?, false, NOW(), NOW())`,
            [
              employee_id,
              promotionId,
              `A promotion request (${current_designation} → ${requested_designation}) has been submitted for you`
            ]
          );
        }
      }
    } catch (notifError) {
      console.error("Notification error (non-critical):", notifError);
    }

    if (existingPromotion.length > 0) {
      res.status(200).json({ message: "Promotion request updated successfully" });
    } else {
      res.status(201).json({ message: "Promotion request added" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to process promotion request" });
  }
};

export const updatePromotion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const promotionId = req.params.id;
    const { current_designation, requested_designation, note, date, approval } =
      req.body;

    const [existing]: any = await pool.query(
      "SELECT * FROM promotion WHERE id = ? AND is_deleted = 0",
      [promotionId],
    );

    if (!existing.length) {
      res.status(404).json({ message: "Promotion not found" });
      return;
    }

    if (req.user.role !== "admin") {
      res.status(403).json({ message: "Only admin can approve promotions" });
      return;
    }

    if (existing[0].approval === "ACCEPTED") {
      res
        .status(400)
        .json({ message: "Accepted promotion cannot be modified" });
      return;
    }

    await pool.query(
      `UPDATE promotion SET
        current_designation = ?,
        requested_designation = ?,
        note = ?,
        date = ?,
        approval = ?
      WHERE id = ?`,
      [
        current_designation,
        requested_designation,
        note,
        date,
        approval,
        promotionId,
      ],
    );

    if (approval === "ACCEPTED") {
      const promotion = existing[0];
      const empId = promotion.employee_id;

      const [lifelineExists]: any = await pool.query(
        "SELECT id FROM employee_lifeline WHERE employee_id = ?",
        [empId],
      );

      if (lifelineExists.length > 0) {
        await pool.query(
          `UPDATE employee_lifeline 
           SET position = ?, date = ? 
           WHERE employee_id = ?`,
          [requested_designation, date, empId],
        );
      } else {
        const [userRows]: any = await pool.query(
          `SELECT name, email, contact FROM tbl_users WHERE id = ?`,
          [empId],
        );

        if (userRows.length) {
          const user = userRows[0];
          await pool.query(
            `INSERT INTO employee_lifeline
             (employee_id, employee_name, email, contact, position, date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              empId,
              user.name,
              user.email,
              user.contact,
              requested_designation,
              date,
            ],
          );
        }
      }
    }

    // ✅ Notify employee about approval/rejection decision (admin is the actor, so employee gets notified, not admin)
    if (approval === "ACCEPTED" || approval === "REJECTED") {
      try {
        const empId = existing[0].employee_id;
        if (empId !== req.user.id) {
          await pool.query(
            `INSERT INTO notifications (userId, referenceId, type, message, isRead, createdAt, updatedAt)
             VALUES (?, ?, 'promotion', ?, false, NOW(), NOW())`,
            [
              empId,
              promotionId,
              `Your promotion request (${requested_designation}) has been ${approval === "ACCEPTED" ? "Approved" : "Rejected"}`
            ]
          );
        }
      } catch (notifError) {
        console.error("Notification error (non-critical):", notifError);
      }
    }

    res.json({ message: "Promotion updated successfully and lifeline synced" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update promotion" });
  }
};

export const deletePromotion = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const promotionId = req.params.id;

    const [existing]: any = await pool.query(
      "SELECT * FROM promotion WHERE id = ? AND is_deleted = 0",
      [promotionId],
    );

    if (!existing.length) {
      res.status(404).json({ message: "Promotion not found" });
      return;
    }

    if (req.user.role !== "admin" && existing[0].employee_id !== req.user.id) {
      res.status(403).json({ message: "Unauthorized" });
      return;
    }

    await pool.query("UPDATE promotion SET is_deleted = 1 WHERE id = ?", [
      promotionId,
    ]);

    res.json({ message: "Promotion deleted successfully" });
  } catch {
    res.status(500).json({ message: "Failed to delete promotion" });
  }
};