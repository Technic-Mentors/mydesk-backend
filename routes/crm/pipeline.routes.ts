import { Router } from "express";
import { authenticateToken } from "../../middleware/middleware";
import {
  getPipelineData,
  updateLeadStatusFromPipeline,
} from "../../controllers/crm/pipeline.controller";

const router = Router();

// ============================================
// PIPELINE ROUTES
// ============================================

// Get pipeline data
router.get("/pipeline", authenticateToken, getPipelineData);

// Update lead status from pipeline
router.patch("/pipeline/update-status/:id", authenticateToken, updateLeadStatusFromPipeline);

export default router;