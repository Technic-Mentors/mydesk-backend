import { Router } from "express";
import { getRoles, addRole, updateRole, deleteRole } from "../controllers/role.controller";
import { authenticateToken } from "../middleware/middleware";

const router = Router();
router.get("/getRoles", authenticateToken, getRoles);
router.post("/createRole", authenticateToken, addRole);
router.put("/updateRole/:id", authenticateToken, updateRole);
router.delete("/deleteRole/:id", authenticateToken, deleteRole);

export default router;