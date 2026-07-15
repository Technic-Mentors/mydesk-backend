import { Router } from "express";
import {
  getAllAssignProjects,
  getMyAssignProjects,
  addAssignProject,
  editAssignProject,
  deleteAssignProject,
  unassignProject,
} from "../controllers/assignproject.controller";

import { authenticateToken } from "../middleware/middleware";

const router = Router();

router.get("/admin/getAssignProjects", getAllAssignProjects);
router.get("/user/getMyAssignProjects", authenticateToken, getMyAssignProjects);
router.post("/admin/assignProject", addAssignProject);
router.put("/admin/editAssignProject/:id", editAssignProject);
router.delete("/admin/deleteAssignProject/:id", deleteAssignProject);


router.patch("/admin/unassignProject/:id", unassignProject)
export default router;
