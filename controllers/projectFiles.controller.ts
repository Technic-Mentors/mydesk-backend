import { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import pool from "../database/db";
import { projectChangeEvent } from "../services/projectTodoEvents";
import { nonCriticalNotification } from "../services/notificationEvents";

const uploadDir = path.resolve(process.env.PROJECT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "projects"));
const projectId = (value: string) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const storedPath = (name: string) => path.join(uploadDir, path.basename(name));

export const listProjectFiles = async (req: Request, res: Response): Promise<void> => {
  const id = projectId(req.params.id);
  if (!id) { res.status(400).json({ message: "Invalid project ID" }); return; }
  try {
    const [projects]: any = await pool.query("SELECT id FROM projects WHERE id = ? AND projectStatus = 'Y'", [id]);
    if (!projects.length) { res.status(404).json({ message: "Project not found" }); return; }
    const [rows]: any = await pool.query(
      "SELECT id, original_name AS name, mime_type AS mimeType, size_bytes AS size, created_at AS createdAt FROM project_files WHERE project_id = ? ORDER BY id DESC",
      [id],
    );
    res.json(rows);
  } catch (error) {
    console.error("Error listing project files:", error);
    res.status(500).json({ message: "Failed to list project files" });
  }
};

export const uploadProjectFiles = async (req: Request, res: Response): Promise<void> => {
  const id = projectId(req.params.id);
  if (!id) { res.status(400).json({ message: "Invalid project ID" }); return; }
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) { res.status(400).json({ message: "Choose at least one file" }); return; }
  const saved: string[] = [];
  try {
    const [projects]: any = await pool.query("SELECT id FROM projects WHERE id = ? AND projectStatus = 'Y'", [id]);
    if (!projects.length) { res.status(404).json({ message: "Project not found" }); return; }
    await fs.mkdir(uploadDir, { recursive: true });
    for (const file of files) {
      const storedName = crypto.randomUUID();
      await fs.writeFile(storedPath(storedName), file.buffer, { flag: "wx" });
      saved.push(storedName);
      await pool.query(
        "INSERT INTO project_files (project_id, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)",
        [id, path.basename(file.originalname).slice(0, 255), storedName, file.mimetype, file.size],
      );
    }
    const names = files.map((file) => path.basename(file.originalname).slice(0, 255));
    await nonCriticalNotification(() => projectChangeEvent(id, [`Files added: ${names.join(", ")}`], (req as any).user?.id));
    res.status(201).json({ message: "Files uploaded" });
  } catch (error) {
    console.error("Error uploading project files:", error);
    // A failed request must not leave file records pointing to missing files.
    if (saved.length) {
      await pool.query("DELETE FROM project_files WHERE project_id = ? AND stored_name IN (?)", [id, saved]).catch(console.error);
      await Promise.all(saved.map((name) => fs.unlink(storedPath(name)).catch(console.error)));
    }
    res.status(500).json({ message: "Failed to upload project files" });
  }
};

export const getProjectFile = async (req: Request, res: Response): Promise<void> => {
  const id = projectId(req.params.id);
  const fileId = projectId(req.params.fileId);
  if (!id || !fileId) { res.status(400).json({ message: "Invalid file ID" }); return; }
  try {
    const [rows]: any = await pool.query(
      "SELECT pf.original_name, pf.stored_name, pf.mime_type FROM project_files pf JOIN projects p ON p.id = pf.project_id AND p.projectStatus = 'Y' WHERE pf.project_id = ? AND pf.id = ?",
      [id, fileId],
    );
    if (!rows.length) { res.status(404).json({ message: "File not found" }); return; }
    const file = rows[0];
    const name = path.basename(file.original_name);
    const filePath = storedPath(file.stored_name);
    await fs.access(filePath);
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    const previewable = /^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/(plain|csv))$/.test(file.mime_type);
    res.setHeader("Content-Disposition", `${req.query.download === "1" || !previewable ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.sendFile(filePath);
  } catch (error) {
    console.error("Error serving project file:", error);
    res.status(404).json({ message: "File unavailable" });
  }
};

export const deleteProjectFile = async (req: Request, res: Response): Promise<void> => {
  const id = projectId(req.params.id);
  const fileId = projectId(req.params.fileId);
  if (!id || !fileId) { res.status(400).json({ message: "Invalid file ID" }); return; }
  try {
    const [rows]: any = await pool.query(
      "SELECT pf.stored_name, pf.original_name FROM project_files pf JOIN projects p ON p.id = pf.project_id AND p.projectStatus = 'Y' WHERE pf.project_id = ? AND pf.id = ?",
      [id, fileId],
    );
    if (!rows.length) { res.status(404).json({ message: "File not found" }); return; }
    await fs.unlink(storedPath(rows[0].stored_name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await pool.query("DELETE FROM project_files WHERE project_id = ? AND id = ?", [id, fileId]);
    await nonCriticalNotification(() => projectChangeEvent(id, [`File removed: ${rows[0].original_name}`], (req as any).user?.id));
    res.json({ message: "File deleted" });
  } catch (error) {
    console.error("Error deleting project file:", error);
    res.status(500).json({ message: "Failed to delete file" });
  }
};

