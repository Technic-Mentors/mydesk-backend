import { Router } from "express";
import {
  getMyProfile,
  getEmployeeProfileById,
  getAllEmployees,
  updateMyProfile,
  updateProfileImage
} from "../controllers/profile.controller";
import { authenticateToken, isAdmin } from "../middleware/middleware";

const router: Router = Router();

// User routes (authenticated users)
router.get("/user/getMyProfile", authenticateToken, getMyProfile);
router.put("/user/updateMyProfile", authenticateToken, updateMyProfile);
router.put("/user/updateProfileImage", authenticateToken, updateProfileImage);

// Admin routes
router.get("/admin/getEmployeeProfile/:id", authenticateToken, isAdmin, getEmployeeProfileById);
router.get("/admin/getAllEmployees", authenticateToken, isAdmin, getAllEmployees);

export default router;