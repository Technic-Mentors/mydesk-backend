import { Router } from "express";
import { authenticateToken } from "../../middleware/middleware";
import {
  getActivities,
  getActivityById,
  createActivity,
  updateActivity,
  deleteActivity,
  getActivityStats,
} from "../../controllers/crm/activity.controller";

const router = Router();

// ============================================
// ACTIVITY ROUTES
// ============================================

// Get activity stats
router.get("/activities/stats", authenticateToken, getActivityStats);

// Get activities by module and reference_id
router.get("/activities", authenticateToken, getActivities);

// Get single activity by ID
router.get("/activities/:id", authenticateToken, getActivityById);

// Create manual activity
router.post("/activities", authenticateToken, createActivity);

// Update activity
router.put("/activities/:id", authenticateToken, updateActivity);

// Delete activity (soft delete)
router.delete("/activities/:id", authenticateToken, deleteActivity);

export default router;