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
  getPipelineData,
  getLeadStats,
} from "../../controllers/crm/lead.controller";

const router = Router();

// Get all leads (with filters)
router.get("/leads", authenticateToken, getLeads);

// Get pipeline data
router.get("/leads/pipeline", authenticateToken, getPipelineData);

// Get lead stats
router.get("/leads/stats", authenticateToken, getLeadStats);

// Get single lead (includes history)
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

export default router;