import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket } from "mysql2";

interface AuthenticatedRequest extends Request {
  user?: { id: number; email: string; role: "admin" | "user" };
}

export const getAllProgress = async (req: Request, res: Response) => {
  try {
    const query = `
SELECT 
  pr.id,
  pr.employee_id,
  COALESCE(e.employee_name, u.name) AS employeeName,
  COALESCE(e.email, u.email, '') AS email,
  pr.projectId,
  p.projectName,
  DATE_FORMAT(pr.date, '%Y-%m-%d') AS date,
  pr.note,
  pr.progressStatus,
  pr.created_by,
  pr.created_by_role,
  creator.name AS createdByName,
  pr.created_at,
  pr.updated_at
FROM progress pr
LEFT JOIN employee_lifeline e ON pr.employee_id = e.employee_id
LEFT JOIN tbl_users u ON pr.employee_id = u.id
LEFT JOIN projects p ON pr.projectId = p.id
LEFT JOIN tbl_users creator ON creator.id = pr.created_by
WHERE pr.progressStatus = 'Y'
ORDER BY pr.id ASC;
`;

    const [rows] = await pool.query<RowDataPacket[]>(query);
    res.status(200).json(rows);
  } catch (err) {
    console.error("Error fetching progress:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getMyProgress = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const query = `
      SELECT 
        p.id,
        p.employee_id,
        u.name AS employeeName,
        u.email AS email,
        p.projectId,
        pr.projectName,
        DATE_FORMAT(p.date, '%Y-%m-%d') AS date,
        p.note,
        p.progressStatus,
        p.created_by,
        p.created_by_role,
        creator.name AS createdByName,
        p.created_at,
        p.updated_at
      FROM progress p
      JOIN tbl_users u ON u.id = p.employee_id
      JOIN projects pr ON pr.id = p.projectId
      LEFT JOIN tbl_users creator ON creator.id = p.created_by
      WHERE p.employee_id = ? AND p.progressStatus = 'Y'
      ORDER BY p.id ASC
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [userId]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Get My Progress Error:", error);
    res.status(500).json({ message: "Failed to fetch progress" });
  }
};

export const getMyAssignedProjects = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const query = `
      SELECT 
        p.id AS projectId, 
        p.projectName, 
        p.projectCategory
      FROM assignedprojects ap
      JOIN projects p ON ap.projectId = p.id
      WHERE ap.employee_id = ? AND ap.assignStatus = 'Y'
    `;

    const [rows] = await pool.query(query, [userId]);
    res.status(200).json(rows);
  } catch (err) {
    console.error("Error fetching my projects:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getProjectsByEmployee = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { employee_id } = req.params;

  if (!employee_id) {
    res.status(400).json({ message: "Employee ID is required" });
    return;
  }

  try {
    const query = `
      SELECT 
        p.id AS projectId, 
        p.projectName, 
        p.projectCategory, 
        p.description, 
        p.startDate, 
        p.endDate
      FROM assignedprojects ap
      JOIN projects p ON ap.projectId = p.id
      WHERE ap.employee_id = ? AND ap.assignStatus = 'Y'
    `;
    const [rows] = await pool.query<RowDataPacket[]>(query, [employee_id]);
    res.status(200).json(rows);
  } catch (err) {
    console.error("Error fetching assigned projects:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const addProgress = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const { projectId, date, note, employee_id: bodyEmployeeId } = req.body;
  const user = req.user;

  const employee_id = user?.role === "admin" ? bodyEmployeeId : user?.id;

  if (!employee_id || !projectId || !date || !note) {
    res.status(400).json({ message: "Missing required fields" });
    return;
  }

  try {
    let createdByRole: string;
    let finalEmployeeId: number;

    if (user?.role === "admin") {
      if (!bodyEmployeeId) {
        res.status(400).json({ message: "employee_id is required for admin" });
        return;
      }
      finalEmployeeId = Number(bodyEmployeeId);
      createdByRole = "admin";
    } else {
      // Employee can only add progress for themselves
      if (Number(bodyEmployeeId) && Number(bodyEmployeeId) !== user?.id) {
        res.status(403).json({ 
          message: "You can only add progress for yourself" 
        });
        return;
      }
      finalEmployeeId = user?.id ?? 0;
      createdByRole = "employee";
    }

    // Check if employee exists
    const [userRows]: any = await pool.query(
      "SELECT id FROM tbl_users WHERE id = ?",
      [finalEmployeeId]
    );

    if (!userRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    // Check if project exists
    const [projectRows]: any = await pool.query(
      "SELECT id FROM projects WHERE id = ?",
      [projectId]
    );

    if (!projectRows.length) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    // Get email for the employee
    const [emailRows]: any = await pool.query(
      "SELECT email FROM tbl_users WHERE id = ?",
      [finalEmployeeId]
    );

    const email = emailRows.length ? emailRows[0].email : "";

    // Check for existing progress on same date for the SAME project
    const [existingProgress] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM progress 
       WHERE employee_id = ? AND date = ? AND projectId = ? AND progressStatus = 'Y'`,
      [finalEmployeeId, date, projectId],
    );

    if (Array.isArray(existingProgress) && existingProgress.length > 0) {
      res.status(409).json({
        message: "Progress already exists for this project on the selected date. Only one progress entry per project per day is allowed.",
      });
      return;
    }

    // Insert with created_by and created_by_role
    await pool.query(
      `INSERT INTO progress (employee_id, email, projectId, date, note, progressStatus, created_by, created_by_role)
       VALUES (?, ?, ?, ?, ?, 'Y', ?, ?)`,
      [finalEmployeeId, email, projectId, date, note, user?.id, createdByRole],
    );

    res.status(200).json({ 
      message: "Progress Added",
      data: {
        created_by: user?.id,
        created_by_role: createdByRole
      }
    });
  } catch (error) {
    console.error("Error adding progress:", error);
    res.status(500).json({ message: "Failed to add progress" });
  }
};

export const updateProgress = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const { employee_id, projectId, date, note, progressStatus } = req.body;
    const user = req.user;

    if (!id) {
      res.status(400).json({ message: "Progress ID is required" });
      return;
    }

    if (!employee_id || !projectId || !date || !note) {
      res.status(400).json({
        message: "employee_id, projectId, date, and note are required",
      });
      return;
    }

    // FIRST: Get the progress entry to check who created it
    const [progressRows]: any = await pool.query(
      "SELECT created_by, created_by_role FROM progress WHERE id = ?",
      [id]
    );

    if (!progressRows.length) {
      res.status(404).json({ message: "Progress entry not found" });
      return;
    }

    const progress = progressRows[0];

    // CHECK PERMISSION: Same logic as Todo
    if (progress.created_by_role === 'admin') {
      // Admin-created progress: Only admin can edit
      if (user?.role !== 'admin') {
        res.status(403).json({ 
          message: "Access denied. This progress was created by admin and can only be modified by admin." 
        });
        return;
      }
    } else {
      // Employee-created progress: Only the creator can edit (or admin)
      // This allows admin to edit employee-created progress (same as Todo)
      if (user?.role !== 'admin' && user?.id !== progress.created_by) {
        res.status(403).json({ 
          message: "Access denied. You can only edit progress you created." 
        });
        return;
      }
    }

    // Check if employee exists
    const [userRows]: any = await pool.query(
      "SELECT id FROM tbl_users WHERE id = ?",
      [employee_id]
    );

    if (!userRows.length) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    // Check if project exists
    const [projectRows]: any = await pool.query(
      "SELECT id FROM projects WHERE id = ?",
      [projectId]
    );

    if (!projectRows.length) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    // Check for existing progress on same date (excluding current entry)
    const [existingProgress] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM progress 
       WHERE employee_id = ? AND date = ? AND id != ? AND progressStatus = 'Y'`,
      [employee_id, date, id],
    );

    if (Array.isArray(existingProgress) && existingProgress.length > 0) {
      res.status(409).json({
        message: "Progress already exists for this user on the selected date.",
      });
      return;
    }

    // Get email for the employee
    const [emailRows]: any = await pool.query(
      "SELECT email FROM tbl_users WHERE id = ?",
      [employee_id]
    );

    const email = emailRows.length ? emailRows[0].email : "";

    const query = `
      UPDATE progress
      SET employee_id = ?, email = ?, projectId = ?, date = ?, note = ?, progressStatus = ?
      WHERE id = ?
    `;
    
    await pool.query(query, [
      employee_id,
      email,
      projectId,
      date,
      note,
      progressStatus || 'Y',
      id,
    ]);

    res.json({ 
      message: "Progress updated",
      data: {
        created_by: progress.created_by,
        created_by_role: progress.created_by_role
      }
    });
  } catch (err) {
    console.error("Error updating progress:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteProgress = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const user = req.user;

  if (!id) {
    res.status(400).json({ message: "Progress ID is required" });
    return;
  }

  try {
    // FIRST: Get the progress entry to check who created it
    const [progressRows]: any = await pool.query(
      "SELECT created_by, created_by_role FROM progress WHERE id = ?",
      [id]
    );

    if (!progressRows.length) {
      res.status(404).json({ message: "Progress entry not found" });
      return;
    }

    const progress = progressRows[0];

    // CHECK PERMISSION: Same logic as Todo
    if (progress.created_by_role === 'admin') {
      // Admin-created progress: Only admin can delete
      if (user?.role !== 'admin') {
        res.status(403).json({ 
          message: "Access denied. This progress was created by admin and can only be deleted by admin." 
        });
        return;
      }
    } else {
      // Employee-created progress: Only the creator can delete (or admin)
      // This allows admin to delete employee-created progress (same as Todo)
      if (user?.role !== 'admin' && user?.id !== progress.created_by) {
        res.status(403).json({ 
          message: "Access denied. You can only delete progress you created." 
        });
        return;
      }
    }

    const [result]: any = await pool.query(
      `
      UPDATE progress
      SET progressStatus = 'N'
      WHERE id = ?
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Progress not found" });
      return;
    }

    res.status(200).json({ 
      message: "Progress deleted successfully",
      data: {
        created_by: progress.created_by,
        created_by_role: progress.created_by_role
      }
    });
  } catch (error) {
    console.error("Error deleting progress:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteProject = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    await pool.query(
      `
      UPDATE projects
      SET projectStatus = 'N'
      WHERE id = ?
      `,
      [id],
    );

    res.status(200).json({ message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ message: "Failed to delete project" });
  }
};
