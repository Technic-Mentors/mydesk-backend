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
  COALESCE(e.email, u.email, '') AS email,  -- ✅ force value
  pr.projectId,
  p.projectName,
  DATE_FORMAT(pr.date, '%Y-%m-%d') AS date,
  pr.note,
  pr.progressStatus
FROM progress pr
LEFT JOIN employee_lifeline e ON pr.employee_id = e.employee_id
LEFT JOIN tbl_users u ON pr.employee_id = u.id
LEFT JOIN projects p ON pr.projectId = p.id
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
        p.date,
        p.note
      FROM progress p
      JOIN tbl_users u ON u.id = p.employee_id
      JOIN projects pr ON pr.id = p.projectId
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

  const employee_id =
    req.user?.role === "admin" ? bodyEmployeeId : req.user?.id;

  if (!employee_id || !projectId || !date || !note) {
    res.status(400).json({ message: "Missing required fields" });
    return;
  }

  try {
    // const [existingProgress] = await pool.query<RowDataPacket[]>(
    //   `SELECT id FROM progress 
    //    WHERE employee_id = ? AND date = ?`,
    //   [employee_id, date],
    // );

    // if (Array.isArray(existingProgress) && existingProgress.length > 0) {
    //   res.status(409).json({
    //     message:
    //       "Progress already exists for this user on the selected date. Only one progress entry per day is allowed.",
    //   });
    //   return;
    // }

    await pool.query(
      `INSERT INTO progress (employee_id, projectId, date, note, progressStatus)
       VALUES (?, ?, ?, ?, "Y")`,
      [employee_id, projectId, date, note],
    );

    res.status(200).json({ message: "Progress Added" });
  } catch (error) {
    console.error("Error adding progress:", error);
    res.status(500).json({ message: "Failed to add progress" });
  }
};

export const updateProgress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { employee_id, projectId, date, note, progressStatus } = req.body;

    const [existingProgress] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM progress 
       WHERE employee_id = ? AND date = ? AND id != ?`,
      [employee_id, date, id],
    );

    if (Array.isArray(existingProgress) && existingProgress.length > 0) {
      res.status(409).json({
        message: "Progress already exists for this user on the selected date.",
      });
      return;
    }

    const query = `
      UPDATE progress
      SET employee_id = ?, projectId = ?, date = ?, note = ?, progressStatus = ?
      WHERE id = ?
    `;
    await pool.query(query, [
      employee_id,
      projectId,
      date,
      note,
      progressStatus,
      id,
    ]);

    res.json({ message: "Progress updated" });
  } catch (err) {
    console.error("Error updating progress:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteProgress = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ message: "Progress ID is required" });
    return;
  }

  try {
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

    res.status(200).json({ message: "Progress deleted successfully" });
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
