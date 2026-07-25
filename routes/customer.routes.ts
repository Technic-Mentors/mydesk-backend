import { Router } from "express";
import {
  getAllCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  getSingleCustomer,
  convertLeadToCustomer, getCustomerByLeadId,getCustomerStats
} from "../controllers/customer.controller";
import { authenticateToken } from "../middleware/middleware";
const router = Router();

router.get("/getAllCustomers", getAllCustomers);

router.get("/getSingleCustomer/:id", getSingleCustomer);

router.post("/addCustomer", addCustomer);

router.patch("/updateCustomer/:id", updateCustomer);

router.patch("/deleteCustomer/:id", deleteCustomer);
router.post("/customers/convert/:leadId", authenticateToken, convertLeadToCustomer);
router.get("/customers/lead/:leadId", authenticateToken, getCustomerByLeadId);
router.get("/customers/stats", authenticateToken, getCustomerStats);


export default router;
