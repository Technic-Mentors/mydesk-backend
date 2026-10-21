import { Request, Response } from "express";
import pool from "../database/db";
import { hasPermission, MODULE } from "../permissionModel";
import { promotionPositionOptions } from "../utils/promotionPositions";
import { promotionDecisionNotice } from "../services/employeeNotificationEvents";
import { AuthenticatedRequest } from "../middleware/middleware";

export const getPromotionPositions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const employeeId = hasPermission(req.user, MODULE.Dynamics) ? Number(req.query.employeeId) : req.user.id;
    if (!Number.isInteger(Number(employeeId)) || Number(employeeId) <= 0) {
      res.status(400).json({ message: "Select an employee first" });
      return;
    }

    const [users]: any = await pool.query(
      "SELECT role, roleId FROM tbl_users WHERE id = ? LIMIT 1",
      [employeeId]
    );
    if (!users.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    const [currentRows]: any = await pool.query(
      `SELECT position FROM employee_lifeline WHERE employee_id = ?
       ORDER BY date DESC, id DESC LIMIT 1`,
      [employeeId]
    );
    const currentPosition = String(currentRows[0]?.position || "").trim();
    const [positionRows]: any = await pool.query(
      `SELECT DISTINCT TRIM(el.position) AS title
       FROM employee_lifeline el JOIN tbl_users u ON u.id = el.employee_id
       WHERE u.role = ? AND u.roleId <=> ? AND u.loginStatus = 'Y'
         AND u.status IN ('Active', 'Y')
         AND el.position IS NOT NULL AND TRIM(el.position) != ''`,
      [users[0].role, users[0].roleId]
    );
    const [jobRows]: any = await pool.query(
      "SELECT job_title AS title FROM jobs WHERE status = 'Y' AND TRIM(job_title) != ''"
    );
    const titles = [...positionRows, ...jobRows].map((row: any) => String(row.title));
    const positions = promotionPositionOptions(currentPosition, titles);

    res.json({
      currentPosition,
      positions: positions.map((title) => ({ value: title, label: title })),
    });
  } catch (error) {
    console.error("Promotion Positions Error:", error);
    res.status(500).json({ message: "Failed to load promotion positions" });
  }
};

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
    const employee_id = hasPermission(req.user, MODULE.Dynamics) ? id : req.user.id;
    const isAdmin = hasPermission(req.user, MODULE.Dynamics);

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

    const canManage = hasPermission(req.user, MODULE.Dynamics);
    if (!canManage && existing[0].employee_id !== req.user.id) {
      res.status(403).json({ message: "Forbidden" });
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
        canManage ? approval : "PENDING",
        promotionId,
      ],
    );

    if (canManage && approval === "ACCEPTED") {
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

    if (canManage && (approval === "ACCEPTED" || approval === "REJECTED") &&
        existing[0].approval !== approval && Number(existing[0].employee_id) !== req.user.id) {
      const approved = approval === "ACCEPTED";
      const message = approved
        ? `Congratulations! Your designation has been updated from ${current_designation} to ${requested_designation}, effective ${date}.`
        : `Your promotion request from ${current_designation} to ${requested_designation} was rejected.`;
      try {
        await promotionDecisionNotice(Number(existing[0].employee_id), Number(promotionId), approved, message);
      } catch (notifError) {
        console.error("Promotion notification failed:", notifError);
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

    if (!hasPermission(req.user, MODULE.Dynamics) && existing[0].employee_id !== req.user.id) {
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
