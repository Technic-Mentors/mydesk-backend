import { Router } from "express";
import {
    requestWFH,
    getMyWFHRequests,
    checkWFHStatusForToday,
    cancelWFHRequest,
    getAllWFHRequests,
    getWFHRequestById,
    approveWFHRequest,
    rejectWFHRequest,
    getWFHStatistics, adminAddWFHRequest,deleteWFHRequest
} from "../controllers/wfhController";

const router = Router();

// ============================================================
// EMPLOYEE ROUTES
// ============================================================

// Request WFH
router.post("/:id/request", requestWFH);
// Admin: Delete WFH request
router.delete("/admin/:id", deleteWFHRequest);
// Get my WFH requests
router.get("/:id/my-requests", getMyWFHRequests);

// Check WFH status for today
router.get("/:id/status", checkWFHStatusForToday);

// Cancel WFH request
router.delete("/:id/cancel/:requestId", cancelWFHRequest);

// ============================================================
// ADMIN ROUTES
// ============================================================

// Get all WFH requests (Admin)
router.get("/admin/all", getAllWFHRequests);

// Get WFH request by ID (Admin)
router.get("/admin/:requestId", getWFHRequestById);

// Approve WFH request (Admin)
router.put("/admin/:requestId/approve", approveWFHRequest);

// Reject WFH request (Admin)
router.put("/admin/:requestId/reject", rejectWFHRequest);

// Get WFH statistics (Admin)
router.get("/admin/statistics", getWFHStatistics);
// Admin: Add WFH request for employee (Auto-Approved)
router.post("/admin/add-request", adminAddWFHRequest);

export default router;