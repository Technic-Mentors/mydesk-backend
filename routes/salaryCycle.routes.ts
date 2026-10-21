import { Router } from "express";
import { runSalaryCycle, getPayrollReport } from "../controllers/salaryCycle.controller";
import { getPayrollProcessingRule, updatePayrollProcessingRule } from "../controllers/payrollProcessingRule.controller";
import { authenticateToken, requirePermission } from "../middleware/middleware";

import { MODULE } from "../permissionModel";
import { listPayrollDocuments, retryPayrollDelivery, resendPayslip, resendSummary } from "../controllers/payrollDocuments.controller";

const router = Router();

router.get("/admin/payroll-processing-rule", authenticateToken, requirePermission(MODULE.Payroll), getPayrollProcessingRule);
router.put("/admin/payroll-processing-rule", authenticateToken, requirePermission(MODULE.Payroll), updatePayrollProcessingRule);
router.post("/admin/runSalaryCycle", authenticateToken, requirePermission(MODULE.Payroll), runSalaryCycle);
router.get("/admin/getPayrollReport", authenticateToken, requirePermission(MODULE.Reports), getPayrollReport);

router.get("/payroll/documents", authenticateToken, listPayrollDocuments);
router.post("/payroll/cycles/:id/retry-delivery", authenticateToken, requirePermission(MODULE.Payroll), retryPayrollDelivery);
router.post("/payroll/documents/:id/resend", authenticateToken, requirePermission(MODULE.Payroll), resendPayslip);
router.post("/payroll/cycles/:id/resend-summary", authenticateToken, requirePermission(MODULE.Payroll), resendSummary);
export default router;
