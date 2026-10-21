import { Router } from "express";
import {
  addLoan,
  getAllLoans,
  getMyLoans,
  updateLoan,
  deleteLoan,
} from "../controllers/loan.controller";
import { authenticateToken, isAdmin, requirePermission } from "../middleware/middleware";
import { MODULE } from "../permissionModel";

const router = Router();

router.get("/admin/getLoans", authenticateToken, isAdmin, getAllLoans);
router.get("/user/getMyLoans", authenticateToken, getMyLoans);
router.post("/addLoan", authenticateToken, requirePermission(MODULE.Payroll), addLoan);

router.put("/admin/loans/:id", authenticateToken, requirePermission(MODULE.Payroll), updateLoan);
router.delete("/admin/loans/:id", authenticateToken, requirePermission(MODULE.Payroll), deleteLoan);

export default router;
