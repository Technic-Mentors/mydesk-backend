import { Router } from "express";
import { authenticateToken } from "../middleware/middleware";
import { createDepartment, deleteDepartment, getDepartments, updateDepartment } from "../controllers/department.controller";

const router = Router();
router.get("/getDepartments", authenticateToken, getDepartments);
router.post("/createDepartment", authenticateToken, createDepartment);
router.put("/updateDepartment/:id", authenticateToken, updateDepartment);
router.delete("/deleteDepartment/:id", authenticateToken, deleteDepartment);

export default router;