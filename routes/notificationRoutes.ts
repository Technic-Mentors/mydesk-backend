import { Router } from "express";
import { authenticateToken } from "../middleware/middleware";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notificationController";

const router = Router();

// ============================================
// NOTIFICATION ROUTES
// ============================================

router.get("/getNotifications", authenticateToken, getNotifications);
router.patch("/markRead/:id", authenticateToken, markNotificationRead);
router.patch("/markAllRead", authenticateToken, markAllNotificationsRead);

export default router;