import { Router } from "express";
import {
  getAllConfigTime,
  addConfigTime,
  updateConfigTime,
  deleteConfigTime,
} from "../controllers/attendanceRule.controller";
import { checkHoliday } from "../controllers/holidayCheck.controller";
import { authenticateToken, isAdmin } from "../middleware/middleware";
import {
  listAttendanceProfiles,
  createAttendanceProfile,
  updateAttendanceProfile,
  deleteAttendanceProfile,
} from "../controllers/attendanceProfiles.controller";

const router = Router();


router.get("/getTimeConfigured", getAllConfigTime);
router.post("/configureTime", addConfigTime);
router.put("/updateTime/:id", updateConfigTime);
router.delete("/deleteTime/:id", deleteConfigTime);
router.get("/attendance-profiles", listAttendanceProfiles);
router.post("/attendance-profiles", createAttendanceProfile);
router.put("/attendance-profiles/:id", updateAttendanceProfile);
router.delete("/attendance-profiles/:id", deleteAttendanceProfile);
router.get("/admin/checkHoliday", authenticateToken, isAdmin, checkHoliday);
export default router;
