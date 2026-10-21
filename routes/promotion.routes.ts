import { Router } from "express";
import {
  addPromotion,
  getAllPromotions,
  getMyPromotions,
  getEmployeeLifeLine,
  updatePromotion,
  deletePromotion,
  getEmployeePromotionHistory,
  getPromotionPositions
} from "../controllers/promotion.controller";
import { authenticateToken, isAdmin } from "../middleware/middleware";

const router = Router();

router.get("/admin/getPromotions", authenticateToken, isAdmin, getAllPromotions);
router.get("/user/getMyPromotions", authenticateToken, getMyPromotions);
router.get("/getPromotionHistory/:employeeId", authenticateToken, getEmployeePromotionHistory);
router.get("/promotion-positions", authenticateToken, getPromotionPositions);
router.post("/user/addPromotion", authenticateToken, addPromotion);
router.post("/admin/addPromotion", authenticateToken, isAdmin, addPromotion);
router.put("/admin/updatePromotion/:id", authenticateToken, isAdmin, updatePromotion);
router.get("/admin/getEmployeeLifeLine", authenticateToken, isAdmin, getEmployeeLifeLine);
router.put("/user/updatePromotion/:id", authenticateToken, updatePromotion);
router.patch("/user/deletePromotion/:id", authenticateToken,  deletePromotion);
router.patch("/admin/deletePromotion/:id", authenticateToken,  deletePromotion);



export default router;
