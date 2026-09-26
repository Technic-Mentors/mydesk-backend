import express from "express";
import {
  getQuotations,
  getQuotation,
  addQuotation,
} from "../controllers/quotation.controller";
import { authenticateToken } from "../middleware/middleware";

const router = express.Router();

router.get("/getQuotations", authenticateToken, getQuotations);
router.get("/getQuotation/:id", authenticateToken, getQuotation);
router.post("/addQuotation", authenticateToken, addQuotation);

export default router;
