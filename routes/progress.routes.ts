import { Router } from "express";
import {
  getAllProgress,
  getMyProgress,
  addProgress,
  updateProgress,
  deleteProgress,
  getProjectsByEmployee,
  getMyAssignedProjects,
} from "../controllers/progress.controller";
import { authenticateToken, isAdmin } from "../middleware/middleware";

const router = Router();

router.get("/admin/getProgress", authenticateToken, isAdmin, getAllProgress);
router.get("/user/getMyProgress", authenticateToken, getMyProgress);
router.post("/admin/addProgress", authenticateToken,addProgress);
router.put("/admin/updateProgress/:id", authenticateToken, updateProgress);
router.patch("/admin/deleteProgress/:id", authenticateToken, deleteProgress);
router.get("/admin/getAssignProjects/:employee_id", getProjectsByEmployee);
router.get("/user/getAssignProjects", authenticateToken, getMyAssignedProjects);

export default router;
