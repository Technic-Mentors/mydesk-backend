import { Request, Response, NextFunction } from "express";
import pool from "../database/db";
import { AuthenticatedRequest } from "./middleware";
import { isEmployee } from "../permissionModel";

export async function projectReadAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    res.status(401).json({ message: "Sign in required" });
    return;
  }
  if (!isEmployee(user)) {
    next();
    return;
  }
  const projectId = Number(req.params.id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    res.status(400).json({ message: "Invalid project ID" });
    return;
  }
  try {
    const [rows]: any = await pool.query(
      `SELECT 1 FROM assignedprojects ap
       JOIN projects p ON p.id=ap.projectId AND p.projectStatus='Y'
       WHERE ap.projectId=? AND ap.employee_id=? AND ap.assignStatus='Y' LIMIT 1`,
      [projectId, user.id],
    );
    if (!rows.length) {
      res.status(403).json({ message: "Project is not assigned to you" });
      return;
    }
    next();
  } catch (error) {
    console.error("Error checking project assignment:", error);
    res.status(500).json({ message: "Unable to verify project access" });
  }
}
