import express from "express";
import { login } from "../controllers/login.controller";
import { forgotPassword, resetPassword, changePassword, adminResetPassword } from "../controllers/password.controller";
import { authenticateToken, AuthenticatedRequest, requirePermission } from "../middleware/middleware";
import { MODULE } from "../permissionModel";
const router = express.Router();

router.post("/login", login);
router.get("/me/permissions", authenticateToken, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  res.json({ role: user?.role, roleId: user?.roleId, permissions: user?.permissions || [] });
});
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.put("/changePassword", authenticateToken, changePassword);
router.post("/employees/:id/reset-password", authenticateToken, requirePermission(MODULE.People), adminResetPassword);

export default router;
