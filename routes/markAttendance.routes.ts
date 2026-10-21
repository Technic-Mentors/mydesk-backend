import { Router } from "express";
import { getAttendance, getGeofenceStatus, markAttendance } from "../controllers/markAttendance.controller";
import { authenticateToken, isAdmin } from "../middleware/middleware";
import { readMobileClockSettings, updateMobileClockSettings } from "../controllers/attendanceMobileSettings.controller";

const router = Router();


router.get("/mobile-clock-settings", authenticateToken, readMobileClockSettings);
router.put("/mobile-clock-settings", authenticateToken, isAdmin, updateMobileClockSettings);
router.get("/getAttendance/:id", authenticateToken, getAttendance);
router.get("/geofence-status", authenticateToken, getGeofenceStatus);
router.post("/markAttendance/:id", authenticateToken, markAttendance);

export default router;
