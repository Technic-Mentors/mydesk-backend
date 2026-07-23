import { Router } from "express";
import { authenticateToken } from "../../middleware/middleware";
import {
  getFollowUps,
  getFollowUpById,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
  getFollowUpsByLead,
  getFollowUpStats,
  checkAndCreateFollowUpNotifications,
  getPendingFollowUps,
  createFollowUpNotifications,
} from "../../controllers/crm/followUp.controller";

const router = Router();

// ============================================
// FOLLOW-UP ROUTES
// ============================================

// Get all follow-ups
router.get("/followups", authenticateToken, getFollowUps);

// Get follow-up stats
router.get("/followups/stats", authenticateToken, getFollowUpStats);

// Get follow-ups by lead
router.get("/followups/lead/:leadId", authenticateToken, getFollowUpsByLead);
router.get("/followups/pending", authenticateToken, getPendingFollowUps);
// Add this route
router.get("/followups/create-notifications", authenticateToken, createFollowUpNotifications);
// Get single follow-up
router.get("/followups/:id", authenticateToken, getFollowUpById);
router.get("/followups/check-notifications", authenticateToken, checkAndCreateFollowUpNotifications);
// Create follow-up
router.post("/followups", authenticateToken, createFollowUp);

// Update follow-up
router.put("/followups/:id", authenticateToken, updateFollowUp);

// Delete follow-up
router.delete("/followups/:id", authenticateToken, deleteFollowUp);

export default router;