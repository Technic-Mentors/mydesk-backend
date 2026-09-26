import { Router } from "express";
import {
  addSupplier,
  updateSupplier,
  getAllSuppliers,
  getSupplier,
  deleteSupplier,
} from "../controllers/supplier.controller";
import { authenticateToken } from "../middleware/middleware";

const router = Router();

router.get("/getSuppliers", authenticateToken, getAllSuppliers);
router.get("/getSupplier/:supplierId", authenticateToken, getSupplier);
router.post("/addSupplier", authenticateToken, addSupplier);
router.post("/updateSupplier", authenticateToken, updateSupplier);
router.delete("/deleteSupplier/:supplierId", authenticateToken, deleteSupplier);

export default router;
