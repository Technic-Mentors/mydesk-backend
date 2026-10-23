import { Request, Response } from "express";
import pool from "../database/db";
import { projectChangeEvent, projectStatusEvent } from "../services/projectTodoEvents";
import { nonCriticalNotification } from "../services/notificationEvents";
import { syncProjectChat, syncProjectChatSafely } from "../services/chatProjects";

export const getAllProjects = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rows]: any = await pool.query(
      `
      SELECT 
        id,
        projectName,
        projectCategory,
        description,
        completionStatus,
        isOnGoing,
        DATE_FORMAT(startDate, '%Y-%m-%d') as startDate,
        DATE_FORMAT(endDate, '%Y-%m-%d') as endDate,
        DATE_FORMAT(deadlineDate, '%Y-%m-%d') as deadlineDate
      FROM projects
      WHERE projectStatus = 'Y'
      ORDER BY id DESC
      `,
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ message: "Failed to fetch projects" });
  }
};

export const getProjectById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ message: "Invalid project ID" });
      return;
    }
    const [rows]: any = await pool.query(
      `SELECT id, projectName, projectCategory, description, completionStatus, isOnGoing,
        DATE_FORMAT(startDate, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(endDate, '%Y-%m-%d') AS endDate,
        DATE_FORMAT(deadlineDate, '%Y-%m-%d') AS deadlineDate
       FROM projects WHERE id=? AND projectStatus='Y'`, [id]);
    if (!rows.length) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    const [assignees]: any = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.image
       FROM assignedprojects ap
       JOIN tbl_users u ON u.id = ap.employee_id
       WHERE ap.projectId = ? AND ap.assignStatus = 'Y' AND u.status = 'Active'
       ORDER BY u.name ASC`,
      [id],
    );
    res.json({ ...rows[0], assignees });
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ message: "Failed to fetch project" });
  }
};

export const addProject = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      projectName,
      projectCategory,
      description,
      startDate,
      endDate,
      completionStatus,
    } = req.body;

    const safeEndDate = endDate ? endDate : null;

    if (typeof projectName !== "string" || !projectName.trim()) {
      res.status(400).json({ message: "Project name is required" });
      return;
    }
    if (!projectCategory || !startDate) {
      res.status(400).json({ message: "Required fields are missing" });
      return;
    }

    if (endDate && new Date(startDate) > new Date(endDate)) {
      res
        .status(400)
        .json({ message: "Start date cannot be greater than end date" });
      return;
    }

    const trimmedName = projectName.trim();
    const trimmedCategory = projectCategory.trim();

    const [existing]: any = await pool.query(
      `
      SELECT id 
      FROM projects 
      WHERE LOWER(projectName) = LOWER(?) 
        AND LOWER(projectCategory) = LOWER(?) 
        AND projectStatus = 'Y'
      `,
      [trimmedName, trimmedCategory],
    );

    if (existing.length > 0) {
      res.status(400).json({
        message: "Project with this name and category already exists",
      });
      return;
    }

    const [created]: any = await pool.query(
      `
  INSERT INTO projects 
  (projectName, projectCategory, description, startDate, endDate, projectStatus, completionStatus , isOnGoing)
  VALUES (?, ?, ?, ?, ?, 'Y', ?, ?)
  `,
      [
        trimmedName,
        trimmedCategory,
        description,
        startDate,
        safeEndDate, // ✅ important
        completionStatus,
        endDate ? 0 : 1,
      ],
    );
    await syncProjectChatSafely(Number(created.insertId), (req as any).user?.id);
    await nonCriticalNotification(() => projectChangeEvent(Number(created.insertId), [`Category: ${trimmedCategory}`, `Status: ${completionStatus || "New"}`], (req as any).user?.id, true));

    res.status(201).json({ message: "Project added successfully", id: Number(created.insertId) });
  } catch (error) {
    console.error("Error adding project:", error);
    res.status(500).json({ message: "Failed to add project" });
  }
};

export const updateProject = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      projectName,
      projectCategory,
      description,
      startDate,
      endDate,
      deadlineDate,
      completionStatus,
    } = req.body;

    const safeEndDate = endDate ? endDate : null;

    if (typeof projectName !== "string" || !projectName.trim()) {
      res.status(400).json({ message: "Project name is required" });
      return;
    }
    if (!projectCategory || !startDate) {
      res.status(400).json({ message: "Required fields are missing" });
      return;
    }

    if (endDate && new Date(startDate) > new Date(endDate)) {
      res.status(400).json({
        message: "Start date cannot be greater than end date",
      });
      return;
    }

    const trimmedName = projectName.trim();
    const trimmedCategory = projectCategory.trim();

    const [existing]: any = await pool.query(
      `
      SELECT id 
      FROM projects 
      WHERE LOWER(projectName) = LOWER(?) 
        AND LOWER(projectCategory) = LOWER(?) 
        AND projectStatus = 'Y'
        AND id != ?
      `,
      [trimmedName, trimmedCategory, id],
    );

    if (existing.length > 0) {
      res.status(400).json({
        message: "Another project with this name and category already exists",
      });
      return;
    }

    const [previousRows]: any = await pool.query(
      `SELECT projectName, projectCategory, description,
        DATE_FORMAT(startDate, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(endDate, '%Y-%m-%d') AS endDate,
        DATE_FORMAT(deadlineDate, '%Y-%m-%d') AS deadlineDate,
        completionStatus, isOnGoing
       FROM projects WHERE id=? AND projectStatus='Y'`, [id]);
    if (!previousRows.length) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    const previous = previousRows[0];
    const nextStatus = completionStatus || previous.completionStatus;
    const nextDeadline = deadlineDate || null;
    if (nextStatus === "Working" && ((safeEndDate && !nextDeadline) ||
        (nextDeadline && new Date(nextDeadline) < new Date(startDate)))) {
      res.status(400).json({ message: "A deadline on or after the start date is required for a working project" });
      return;
    }
    if (!["New", "Working", "Completed"].includes(nextStatus)) {
      res.status(400).json({ message: "Invalid completion status" });
      return;
    }
    const next = {
      projectName: trimmedName,
      projectCategory: trimmedCategory,
      description: description ?? "",
      startDate,
      endDate: safeEndDate,
      deadlineDate: deadlineDate || null,
      completionStatus: nextStatus,
      isOnGoing: safeEndDate ? 0 : 1,
    };
    const changes: string[] = [];
    const describe = (label: string, before: unknown, after: unknown) => {
      const oldValue = String(before ?? "").trim();
      const newValue = String(after ?? "").trim();
      if (oldValue !== newValue) changes.push(`${label}: ${oldValue || "none"} to ${newValue || "none"}`);
    };
    describe("Name", previous.projectName, next.projectName);
    describe("Category", previous.projectCategory, next.projectCategory);
    describe("Description", previous.description, next.description);
    describe("Start date", previous.startDate, next.startDate);
    describe("End date", previous.endDate, next.endDate);
    describe("Deadline", previous.deadlineDate, next.deadlineDate);
    describe("Status", previous.completionStatus, next.completionStatus);
    if (Number(previous.isOnGoing) !== next.isOnGoing) changes.push(`Ongoing: ${next.isOnGoing ? "yes" : "no"}`);

    await pool.query(
  `
  UPDATE projects
  SET
    projectName = ?,
    projectCategory = ?,
    description = ?,
    startDate = ?,
    endDate = ?,
    deadlineDate = ?,   -- 👈 NEW
    completionStatus = ?,
    isOnGoing = ?
  WHERE id = ?
  `,
  [
    next.projectName,
    next.projectCategory,
    next.description,
    next.startDate,
    next.endDate,
    next.deadlineDate,
    next.completionStatus,
    next.isOnGoing,
    id,
  ],
);
    await syncProjectChat(Number(id), (req as any).user?.id);

    if (changes.length) {
      await nonCriticalNotification(() => projectChangeEvent(Number(id), changes, (req as any).user?.id));
    }

    const [updatedRows]: any = await pool.query(
      `
      SELECT 
        id,
        projectName,
        projectCategory,
        description,
        DATE_FORMAT(startDate, '%Y-%m-%d') as startDate,
        DATE_FORMAT(endDate, '%Y-%m-%d') as endDate,
        DATE_FORMAT(deadlineDate, '%Y-%m-%d') as deadlineDate,
        completionStatus,
        isOnGoing
      FROM projects
      WHERE id = ?
      `,
      [id],
    );

    res.status(200).json({
      message: "Project updated successfully",
      project: updatedRows[0],
    });
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ message: "Failed to update project" });
  }
};

export const updateCompletionStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { completionStatus } = req.body;

    const allowedStatuses = ["New", "Working", "Completed"];
    if (!allowedStatuses.includes(completionStatus)) {
      res.status(400).json({ message: "Invalid completion status" });
      return;
    }

    const [previousRows]: any = await pool.query(
      "SELECT completionStatus, projectName, projectCategory, startDate, endDate, deadlineDate, isOnGoing " +
      "FROM projects WHERE id=? AND projectStatus='Y'", [id]);
    if (!previousRows.length) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    const project = previousRows[0];
    if (!project.projectName || !project.projectCategory || !project.startDate ||
        (project.endDate && new Date(project.startDate) > new Date(project.endDate))) {
      res.status(400).json({ message: "Complete valid project details before changing status" });
      return;
    }
    if (completionStatus === "Working" && ((!Number(project.isOnGoing) && !project.deadlineDate) ||
        (project.deadlineDate && new Date(project.deadlineDate) < new Date(project.startDate)))) {
      res.status(400).json({ message: "Set a deadline on or after the start date before moving this project to Working" });
      return;
    }

    const [result]: any = await pool.query(
      `UPDATE projects SET completionStatus = ? WHERE id = ? AND projectStatus='Y'`,
      [completionStatus, id],
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Project not found" });
      return;
    }

    await syncProjectChat(Number(id), (req as any).user?.id);

    if (previousRows.length && previousRows[0].completionStatus !== completionStatus) {
      await nonCriticalNotification(() => projectStatusEvent(Number(id),previousRows[0].completionStatus || "New",completionStatus,(req as any).user?.id));
    }

    res.status(200).json({ message: "Status updated successfully" });
  } catch (error) {
    console.error("Error updating project status:", error);
    res.status(500).json({ message: "Failed to update project status" });
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
    await syncProjectChat(Number(id), (req as any).user?.id);

    res.status(200).json({ message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ message: "Failed to delete project" });
  }
};
