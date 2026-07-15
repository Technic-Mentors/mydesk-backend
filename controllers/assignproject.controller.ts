import { Request, Response } from "express";
import pool from "../database/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";

interface AssignedProject extends RowDataPacket {
  id: number;
  employee_id: number;
  projectId: number;
  name: string;
  projectName: string;
  description: string;
  completionStatus: string;
}

export const getAllAssignProjects = async (req: Request, res: Response) => {
  try {
    const query = `
SELECT
  ap.id,
  ap.employee_id,
  ap.projectId,
  ap.date,
  u.name,
  p.projectName,
  p.description,
  p.completionStatus
FROM assignedprojects ap
JOIN tbl_users u ON u.id = ap.employee_id
JOIN projects p ON p.id = ap.projectId
WHERE ap.assignStatus = 'Y'
ORDER BY ap.id DESC
`;
    const [rows] = await pool.query<AssignedProject[]>(query);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getMyAssignProjects = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const query = `
SELECT
  ap.id,
  ap.employee_id,
  ap.projectId,
  ap.date,
  u.name,
  p.projectName,
  p.description,
  p.completionStatus
FROM assignedprojects ap
JOIN tbl_users u ON u.id = ap.employee_id
JOIN projects p ON p.id = ap.projectId
WHERE ap.assignStatus = 'Y'
AND ap.employee_id = ?
ORDER BY ap.id DESC
`;

    const [rows] = await pool.query<AssignedProject[]>(query, [userId]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

export const addAssignProject = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { employee_id, projectId, date } = req.body;

    if (!employee_id || !projectId) {
      res
        .status(400)
        .json({ message: "employeeId and projectId are required" });
      return;
    }

    // Check if employee exists
    const [userRows]: any = await pool.query(
      "SELECT id FROM tbl_users WHERE id = ?",
      [employee_id],
    );

    if (userRows.length === 0) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    // Check if project exists and is active
    const [projectRows]: any = await pool.query(
      "SELECT id FROM projects WHERE id = ? AND projectStatus = 'Y'",
      [projectId],
    );

    if (projectRows.length === 0) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    // Check if employee is already assigned to this project
    const [existingAssignment]: any = await pool.query(
      "SELECT id FROM assignedprojects WHERE employee_id = ? AND projectId = ? AND assignStatus = 'Y'",
      [employee_id, projectId],
    );

    if (existingAssignment.length > 0) {
      res.status(400).json({ 
        message: "Employee is already assigned to this project" 
      });
      return;
    }

    const dateString = date ? date : new Date().toISOString().split("T")[0];

    const query = `
      INSERT INTO assignedprojects (employee_id, projectId, date, assignStatus)
      VALUES (?, ?, ?, 'Y')
    `;

    const [result] = await pool.query<ResultSetHeader>(query, [
      employee_id,
      projectId,
      dateString,
    ]);

    res.status(201).json({
      id: result.insertId,
      employee_id,
      projectId,
      date: dateString,
      assignStatus: "Y",
      message: "Project assigned successfully"
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Server error" });
    }
  }
};

export const editAssignProject = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { employee_id, projectId, date } = req.body;

    if (!employee_id || !projectId) {
      res
        .status(400)
        .json({ message: "employee_id and projectId are required" });
      return;
    }

    // Check if employee exists
    const [userRows]: any = await pool.query(
      "SELECT id FROM tbl_users WHERE id = ?",
      [employee_id],
    );

    if (userRows.length === 0) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    // Check if project exists and is active
    const [projectRows]: any = await pool.query(
      "SELECT id FROM projects WHERE id = ? AND projectStatus = 'Y'",
      [projectId],
    );

    if (projectRows.length === 0) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    // Check if assignment exists
    const [assignmentExists]: any = await pool.query(
      "SELECT id FROM assignedprojects WHERE id = ? AND assignStatus = 'Y'",
      [id],
    );

    if (assignmentExists.length === 0) {
      res.status(404).json({ message: "Assignment not found" });
      return;
    }

    // Check if employee is already assigned to this project (excluding current assignment)
    const [existingAssignment]: any = await pool.query(
      "SELECT id FROM assignedprojects WHERE employee_id = ? AND projectId = ? AND assignStatus = 'Y' AND id != ?",
      [employee_id, projectId, id],
    );

    if (existingAssignment.length > 0) {
      res.status(400).json({ 
        message: "Employee is already assigned to this project" 
      });
      return;
    }

    const dateString = date ? date : new Date().toISOString().split("T")[0];

    const query = `
      UPDATE assignedprojects
      SET employee_id = ?, projectId = ?, date = ?
      WHERE id = ?
    `;

    await pool.query<ResultSetHeader>(query, [
      employee_id,
      projectId,
      dateString,
      id,
    ]);

    res.json({ 
      message: "Assigned project updated successfully" 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteAssignProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if assignment exists
    const [assignmentExists]: any = await pool.query(
      "SELECT id FROM assignedprojects WHERE id = ? AND assignStatus = 'Y'",
      [id],
    );

    if (assignmentExists.length === 0) {
      res.status(404).json({ message: "Assignment not found" });
      return;
    }

    const query = `
      UPDATE assignedprojects
      SET assignStatus = 'N'
      WHERE id = ?
    `;

    await pool.query<ResultSetHeader>(query, [id]);
    res.json({ 
      message: "Assigned project deleted successfully" 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
// Unassign a specific project (soft delete - sets assignStatus to 'N')
export const unassignProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if assignment exists and is active
    const [assignmentExists]: any = await pool.query(
      "SELECT id, employee_id, projectId FROM assignedprojects WHERE id = ? AND assignStatus = 'Y'",
      [id],
    );

    if (assignmentExists.length === 0) {
      res.status(404).json({ 
        message: "Assignment not found or already unassigned" 
      });
      return;
    }

    // Soft delete - update assignStatus to 'N'
    // updated_at will auto-update if you have ON UPDATE CURRENT_TIMESTAMP
    const query = `
      UPDATE assignedprojects
      SET assignStatus = 'N'
      WHERE id = ?
    `;

    await pool.query<ResultSetHeader>(query, [id]);

    res.json({ 
      success: true,
      message: "Project unassigned successfully",
      data: {
        id: parseInt(id),
        employee_id: assignmentExists[0].employee_id,
        projectId: assignmentExists[0].projectId,
        assignStatus: "N"
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};