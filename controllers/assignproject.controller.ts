import { Request, Response } from "express";
import pool from "../database/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { projectAssignmentEvent } from "../services/projectTodoEvents";
import { nonCriticalNotification } from "../services/notificationEvents";
import { syncProjectChatSafely } from "../services/chatProjects";

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
  ap.assigned_by,
  assigner.name AS assignedByName,
  u.name,
  u.status as userStatus,  -- ✅ ADD THIS
  p.projectName,
  p.description,
  p.completionStatus
FROM assignedprojects ap
JOIN tbl_users u ON u.id = ap.employee_id
LEFT JOIN tbl_users assigner ON assigner.id = ap.assigned_by
JOIN projects p ON p.id = ap.projectId
WHERE ap.assignStatus = 'Y'
  AND u.status = 'Active'   -- ✅ EXCLUDE WITHDRAWN EMPLOYEES
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
  ap.assigned_by,
  assigner.name AS assignedByName,
  u.name,
  u.status as userStatus,  -- ✅ ADD THIS
  p.projectName,
  p.description,
  p.completionStatus
FROM assignedprojects ap
JOIN tbl_users u ON u.id = ap.employee_id
LEFT JOIN tbl_users assigner ON assigner.id = ap.assigned_by
JOIN projects p ON p.id = ap.projectId
WHERE ap.assignStatus = 'Y'
  AND ap.employee_id = ?
  AND u.status = 'Active'   -- ✅ EXCLUDE WITHDRAWN EMPLOYEES
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
    const assignerId = Number((req as any).user?.id);
    if (!Number.isSafeInteger(assignerId) || assignerId <= 0) {
      res.status(401).json({ message: "Sign in to assign a project" });
      return;
    }

    if (!employee_id || !projectId) {
      res
        .status(400)
        .json({ message: "employeeId and projectId are required" });
      return;
    }

    // Check if employee exists and is ACTIVE
    const [userRows]: any = await pool.query(
      "SELECT id, status FROM tbl_users WHERE id = ?",
      [employee_id],
    );

    if (userRows.length === 0) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    // ✅ Check if employee is active (not withdrawn)
    if (userRows[0].status !== 'Active') {
      res.status(400).json({ 
        message: "Cannot assign project to withdrawn employee" 
      });
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

    const dateString = date ? date : new Date().toISOString().split("T")[0];
    const lockName = `project-assign:${employee_id}:${projectId}`;
    const connection = await pool.getConnection();
    let assignmentId: number;
    try {
      const [locks]: any = await connection.query("SELECT GET_LOCK(?,5) AS acquired",[lockName]);
      if (locks[0]?.acquired !== 1) {
        res.status(409).json({ message:"Project assignment is being processed" });
        return;
      }
      const [existingAssignment]: any = await connection.query(
        "SELECT id FROM assignedprojects WHERE employee_id = ? AND projectId = ? AND assignStatus = 'Y'",
        [employee_id, projectId],
      );
      if (existingAssignment.length > 0) {
        res.status(400).json({ message:"Employee is already assigned to this project" });
        return;
      }
      const [result] = await connection.query<ResultSetHeader>(
        "INSERT INTO assignedprojects (employee_id, projectId, date, assignStatus, assigned_by) VALUES (?, ?, ?, 'Y', ?)",
        [employee_id,projectId,dateString,assignerId],
      );
      assignmentId = result.insertId;
    } finally {
      try { await connection.query("SELECT RELEASE_LOCK(?)",[lockName]); }
      finally { connection.release(); }
    }

    await nonCriticalNotification(() => projectAssignmentEvent(assignmentId, Number(projectId), Number(employee_id), "assigned", (req as any).user?.id));
    await syncProjectChatSafely(Number(projectId), (req as any).user?.id);

    res.status(201).json({
      id: assignmentId,
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
      "SELECT id, employee_id, projectId FROM assignedprojects WHERE id = ? AND assignStatus = 'Y'",
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
      SET employee_id = ?, projectId = ?, date = ?,
          assigned_by = CASE WHEN ? THEN ? ELSE assigned_by END
      WHERE id = ?
    `;

    await pool.query<ResultSetHeader>(query, [
      employee_id,
      projectId,
      dateString,
      Number(assignmentExists[0].employee_id) !== Number(employee_id) || Number(assignmentExists[0].projectId) !== Number(projectId),
      (req as any).user?.id ?? null,
      id,
    ]);

    const previous = assignmentExists[0];
    if (Number(previous.employee_id) !== Number(employee_id) || Number(previous.projectId) !== Number(projectId)) {
      await nonCriticalNotification(async () => {
        await projectAssignmentEvent(Number(id),Number(previous.projectId),Number(previous.employee_id),"removed",(req as any).user?.id);
        await projectAssignmentEvent(Number(id),Number(projectId),Number(employee_id),"assigned",(req as any).user?.id);
      });
    }
    await syncProjectChatSafely(Number(previous.projectId), (req as any).user?.id);
    if (Number(previous.projectId) !== Number(projectId)) await syncProjectChatSafely(Number(projectId), (req as any).user?.id);

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
      "SELECT id, employee_id, projectId FROM assignedprojects WHERE id = ? AND assignStatus = 'Y'",
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
    await nonCriticalNotification(() => projectAssignmentEvent(Number(id),Number(assignmentExists[0].projectId),Number(assignmentExists[0].employee_id),"removed",(req as any).user?.id));
    await syncProjectChatSafely(Number(assignmentExists[0].projectId), (req as any).user?.id);
    res.json({ 
      message: "Assigned project deleted successfully" 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
// Unassign a specific project (soft delete - sets assignStatus to 'N'--)
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
    await nonCriticalNotification(() => projectAssignmentEvent(Number(id),Number(assignmentExists[0].projectId),Number(assignmentExists[0].employee_id),"removed",(req as any).user?.id));
    await syncProjectChatSafely(Number(assignmentExists[0].projectId), (req as any).user?.id);

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
