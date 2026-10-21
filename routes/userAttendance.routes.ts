import { Router } from "express";
import {
  getUsers,
  getAllAttendances,
  getMyAttendances,
  addAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceByUserAndDate,
} from "../controllers/userAttendance.controller";

import { authenticateToken, isAdmin } from "../middleware/middleware";

const router = Router();

router.get("/admin/getAttendanceUsers", authenticateToken, isAdmin, getUsers);
router.get(
  "/admin/getAllAttendances",
  authenticateToken,
  isAdmin,
  getAllAttendances
);
router.get("/user/getMyAttendances", authenticateToken, getMyAttendances);
router.post("/admin/addAttendance/:userId", authenticateToken, isAdmin, addAttendance);
router.patch("/admin/updateAttendance/:id", authenticateToken, isAdmin, updateAttendance);
router.patch("/admin/deleteAttendance/:id", authenticateToken, isAdmin, deleteAttendance);
// In your routes file
router.get('/admin/getAttendanceByUserAndDate', authenticateToken, isAdmin, getAttendanceByUserAndDate);

export default router;
