import { Router } from "express";
import {
  getAllProjects,
  getProjectById,
  addProject,
  updateProject,
  updateCompletionStatus,
  deleteProject,
} from "../controllers/projects.controller";
import { authenticateToken } from "../middleware/middleware";
import { uploadMultiple } from "../middleware/upload";
import { projectReadAccess } from "../middleware/projectReadAccess";
import { listProjectFiles, uploadProjectFiles, getProjectFile, deleteProjectFile } from "../controllers/projectFiles.controller";

const router = Router();

router.get("/getProjects", getAllProjects);
router.get("/projects/:id/files", projectReadAccess, listProjectFiles);
router.post("/projects/:id/files", uploadMultiple, uploadProjectFiles);
router.get("/projects/:id/files/:fileId", projectReadAccess, getProjectFile);
router.get("/projects/:id", projectReadAccess, getProjectById);
router.delete("/projects/:id/files/:fileId", deleteProjectFile);
router.post("/addProject", addProject);
router.put("/updateProject/:id", updateProject);
router.patch(
  "/updateProjectStatus/:id",
  authenticateToken,
  updateCompletionStatus,
);
router.patch("/deleteProject/:id", deleteProject);

export default router;
