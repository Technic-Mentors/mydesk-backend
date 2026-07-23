import { Router } from "express";
import { authenticateToken } from "../../middleware/middleware";
import {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  convertLeadToClient,
  getClientStats,
} from "../../controllers/crm/client.controller";

const router = Router();

// ============================================
// CLIENT ROUTES
// ============================================

// Get all clients
router.get("/clients", authenticateToken, getClients);

// Get client stats
router.get("/clients/stats", authenticateToken, getClientStats);

// Get single client
router.get("/clients/:id", authenticateToken, getClientById);

// Convert lead to client
router.post("/clients/convert/:leadId", authenticateToken, convertLeadToClient);

// Create client
router.post("/clients", authenticateToken, createClient);

// Update client
router.put("/clients/:id", authenticateToken, updateClient);

// Delete client
router.delete("/clients/:id", authenticateToken, deleteClient);

export default router;