import { Router } from "express";
import { authenticateToken } from "../../middleware/middleware";
import {
  getPipelineData,
  updateLeadStatusFromPipeline,
  dragDropLead,
  updateLeadDealValue,
} from "../../controllers/crm/pipeline.controller";

const router = Router();

// ============================================
// PIPELINE ROUTES
// ============================================

// Get pipeline data (only qualified leads)
router.get("/pipeline", authenticateToken, getPipelineData);

// Update lead status from pipeline
router.patch("/pipeline/update-status/:id", authenticateToken, updateLeadStatusFromPipeline);

// Drag and drop lead between stages
router.patch("/pipeline/drag-drop/:id", authenticateToken, dragDropLead);

// Update deal value
router.patch("/pipeline/deal-value/:id", authenticateToken, updateLeadDealValue);

export default router;