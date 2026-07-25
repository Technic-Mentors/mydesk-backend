import { Router } from "express";
import { authenticateToken } from "../../middleware/middleware";
import { uploadSingle } from "../../middleware/upload";
import {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  updateLeadStatus,
  addComment,
  deleteLead,
  getLeadHistory,
  getLeadStats,
  bulkDeleteLeads, bulkUpdatePriority,bulkUpdateStatus,exportLeads
} from "../../controllers/crm/lead.controller";

const router = Router();

// ============================================
// LEAD ROUTES
// ============================================
router.get("/leads/export", authenticateToken, exportLeads);
// Get all leads (with filters)
router.get("/leads", authenticateToken, getLeads);

// Get lead stats
router.get("/leads/stats", authenticateToken, getLeadStats);

// Get single lead
router.get("/leads/:id", authenticateToken, getLeadById);

// Get lead history
router.get("/leads/:id/history", authenticateToken, getLeadHistory);

// Create lead (with file upload)
router.post("/leads", authenticateToken, uploadSingle, createLead);

// Update lead (with file upload)
router.put("/leads/:id", authenticateToken, uploadSingle, updateLead);

// Update lead status only
router.patch("/leads/:id/status", authenticateToken, updateLeadStatus);

// Add comment only
router.post("/leads/:id/comment", authenticateToken, addComment);

// Delete lead
router.delete("/leads/:id", authenticateToken, deleteLead);

// Bulk Actions
router.post("/leads/bulk-delete", authenticateToken, bulkDeleteLeads);
router.post("/leads/bulk-status", authenticateToken, bulkUpdateStatus);
router.post("/leads/bulk-priority", authenticateToken, bulkUpdatePriority);



export default router;