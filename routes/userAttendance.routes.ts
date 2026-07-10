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

router.get("/admin/getUsers", getUsers);
router.get(
  "/admin/getAllAttendances",
  authenticateToken,
  isAdmin,
  getAllAttendances
);
router.get("/user/getMyAttendances", authenticateToken, getMyAttendances);
router.post("/admin/addAttendance/:userId", addAttendance);
router.patch("/admin/updateAttendance/:id", updateAttendance);
router.patch("/admin/deleteAttendance/:id",deleteAttendance);
// In your routes file
router.get('/admin/getAttendanceByUserAndDate', authenticateToken, isAdmin, getAttendanceByUserAndDate);

export default router;
